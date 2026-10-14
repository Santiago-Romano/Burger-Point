# Revisión independiente de seguridad — Burger Point

**Fecha:** 13 de octubre de 2026  
**Base:** `BurgerPoint.zip` (original) y `BurgerPoint-security-audit-final.zip` (resultado auditado)  
**Rama de correcciones:** `security-review/priority-fixes`

## Resumen ejecutivo

La revisión confirma dos riesgos altos en el checkout que el endurecimiento SQL incluido en el ZIP auditado no cerraba: el backend aceptaba importes enviados por el cliente sin compararlos con el catálogo y permitía al cliente enviar una pareja distancia/tarifa de delivery que solo debía pertenecer a una banda válida, sin probar que correspondiera a la dirección. Ambos eran alcanzables porque `anon` conservaba permiso para insertar pedidos directamente.

La rama independiente conserva la experiencia de compra, pero hace que el servidor y el trigger de base de datos normalicen los artículos e importes; elimina la inserción PostgREST pública; vuelve a cotizar el delivery al confirmar; y guarda subtotal y total calculados. Incluye pruebas unitarias y una prueba SQL transaccional. **No se aplicó la migración ni se desplegó ningún cambio en Supabase o Netlify.**

También hay 13 advisories de severidad alta en el lockfile de npm consultado, sin actualización correctiva que npm proponga. El lockfile de Bun fijado por Netlify sí se instaló en modo congelado y el build de producción pasó.

## Qué se comparó

El ZIP original y el ZIP auditado comparten el código de la aplicación y los manifiestos de dependencias. En el ZIP auditado se observan, principalmente, el informe `SECURITY_AUDIT.md`, una migración `20261013150000_security_hardening.sql` y cabeceras añadidas en `netlify.toml`; no se habían modificado allí el flujo cliente de checkout ni el módulo de envío de pedidos.

El ZIP original **incluye un archivo `.env`**. No leí ni imprimí su contenido; el archivo no está versionado en el `.git` incluido y no aparece en el historial por nombre. El ZIP auditado no contiene `.env`. La rama y los artefactos entregados se construyeron sin `.env`, `.git`, `node_modules`, `.netlify` ni `dist`.

## Hallazgos

| ID | Clasificación | Severidad | Hallazgo y evidencia | Estado |
|---|---|---|---|---|
| BP-01 | **Confirmado en código** | **Alta** | El trigger del ZIP auditado valida forma y límites básicos, y comprueba que el nombre exista si hay una fila de menú; **no compara `unit_price` enviado con el precio del catálogo**. Acepta `unit_price: null` y también el campo omitido. Si el menú aún no está persistido, la validación de catálogo se omite. Tampoco valida extras contra el artículo ni guarda un subtotal/total autoritativo. | Corregido en la rama; requiere desplegar en conjunto el servidor y la migración. |
| BP-02 | **Confirmado en código** | **Alta** | La restricción previa de delivery comprobaba que distancia y tarifa formaran una pareja de una banda aceptada, pero no que esa distancia procediera del domicilio enviado. El cliente podía saltarse la cotización de UI y llamar a PostgREST con una pareja válida inventada. | Se revoca el INSERT directo y el servidor vuelve a cotizar; la integración real con Geoapify queda pendiente. |
| BP-03 | **Confirmado en código** | **Media** | La interfaz mostraba precio en los adicionales, pero el subtotal del carrito sumaba solo el precio base. `orders` tampoco almacenaba subtotal ni total. | Servidor y trigger recalculan adicionales y persisten `items_subtotal` y `total_amount`; el importe cliente solo detecta cambios. |
| BP-04 | **Confirmado en código** | **Media** | El frontend restringía promociones por día, pero un insert directo no pasaba por esa regla. El trigger anterior tampoco rechazaba artículos deshabilitados. | Corregido en servidor y trigger con `promoDays` en `America/Argentina/Buenos_Aires` y `enabled`. |
| BP-05 | **Confirmado en el lockfile** | **Media** | `npm audit` encontró **13 high, 0 critical**; los 13 paquetes están marcados `dev=true` en `package-lock.json`, es decir, pertenecen al pipeline de build/desarrollo y no son dependencias normales de producción de la app. Versiones y rutas, debajo. | Ningún paquete se actualizó indiscriminadamente; `npm audit` informó `fixAvailable: false` para todos. |
| BP-06 | **Confirmado: archivo incluido; valores no inspeccionados** | **Alta — secreto** | El ZIP original contiene `.env`, aunque no está en Git. Credenciales reales allí deben tratarse como expuestas por la distribución. No se leyeron valores; el archivo no está en el ZIP auditado ni en los entregables de esta revisión. | Retirar `.env` de archivos compartidos y rotar credenciales reales/activas. |
| BP-07 | **Configuración confirmada; cobertura real no verificable** | **Media/operativa** | El endurecimiento añadió `nosniff`, `Referrer-Policy`, `Permissions-Policy` y HSTS. No hay CSP en la configuración del repositorio ni prueba de cabeceras en cada respuesta SSR/función. `includeSubDomains; preload` requiere que todos los subdominios soporten HTTPS. | Validar en staging/produción; añadir CSP con una política probada. |
| BP-08 | **Riesgo potencial; configuración del proveedor no verificable** | **Media — abuso** | No se encontró limitación de solicitudes en el código. El control de precios no evita spam de pedidos ni consumo de cuota Geoapify; una mitigación en WAF/Netlify puede existir fuera del ZIP. | Confirmar controles del proveedor y aplicar rate limit/alertas si no existen. |

**Detalle de pedidos/precios:** cantidades sí tenían un límite entero de 1–50; el fallo no era aceptar cantidades negativas. El trigger acepta nombres de variantes del JSON de catálogo, pero no compara el importe enviado con el importe de esa variante ni comprueba `enabled`. En adicionales y salsas valida principalmente tipo/forma, no que la selección y su importe correspondan al producto. La regla de día de promo estaba en cliente. Para delivery la BD comprobaba una banda de distancia/tarifa, no su vínculo con la dirección. Como `orders` no persistía un total canónico, el `unit_price` falsificado podía quedar almacenado sin una suma autoritativa que lo corrigiera.

**Paquetes y rutas en `package-lock.json` (npm audit del 13-10-2026):**

- `@netlify/vite-plugin-tanstack-start@1.3.19` → `@netlify/vite-plugin@3.0.1` → `@netlify/dev@5.1.6` → `@netlify/functions-dev@2.0.10` → `@netlify/zip-it-and-ship-it@16.2.3` → `fast-glob@3.3.3` → `micromatch@4.0.8` → `braces@3.0.3`.
- Ruta de imágenes/herramientas: `@netlify/dev@5.1.6` → `@netlify/images@2.0.3` → `ipx@3.1.1` → `listhen@1.10.1` → `node-forge@1.4.0`; `ipx` también trae `sharp@0.34.5`.
- Los avisos de `node-forge`, `braces` y `sharp` incluyen advisories específicos; los otros nombres aparecen como paquetes afectados por esa cadena. El lockfile no demuestra por sí solo alcanzabilidad de una ruta vulnerable durante producción.

### Regla promocional no codificada

Algunas descripciones del menú indican “Delivery: mínimo 2 unidades”, pero el límite no existe como campo estructurado ni como regla de carrito/servidor. No lo convertí en lógica leyendo texto libre ni agregué una regla nueva. Antes de implementarlo, conviene confirmar si sigue vigente y guardarlo como dato estructurado del menú.

## Controles que sí se sostienen en la evidencia revisada

- `has_role` ya tenía `EXECUTE` revocado para `PUBLIC`/`anon` y concedido a `authenticated`; sus comprobaciones RLS consultan la tabla de roles vigente.
- El flujo de aprobación de acceso evita que un usuario se autoconceda `admin`; el mecanismo `protected_admins` protege al owner contra los RPC de democión revisados.
- El seguimiento público devuelve estado, número y estimaciones del pedido, no nombre, teléfono, dirección ni contenido del pedido.
- La clave de service role no apareció como literal de credencial en el bundle cliente del build. Sí aparece el **nombre** de la variable en un mensaje de error de configuración; no equivale a revelar su valor.
- La dirección de la primera auditoría fue acertada al cerrar el reclamo público de primer admin, proteger explícitamente a los dueños y serializar las RPC de administración con locks. También identificó el lockfile de dependencias y las cabeceras faltantes; la parte de pedidos, sin embargo, no era suficiente.
- En el material estático revisado no se confirmó una nueva vía de escalada de privilegios o exposición de datos introducida por esas correcciones; no equivale a una certificación de seguridad del despliegue.
- No se modificaron roles reales. El procedimiento de alta/verificación de propietarios y retiro seguro del admin del desarrollador está en [OWNER_TRANSFER_RUNBOOK.md](OWNER_TRANSFER_RUNBOOK.md).

## Correcciones incluidas en `security-review/priority-fixes`

1. Revocar `INSERT` y el permiso de secuencia a `anon` y `authenticated`; quitar la política pública de inserción.
2. Sustituir el insert directo del navegador por una función de servidor que lee el catálogo con `SUPABASE_SERVICE_ROLE_KEY`, valida disponibilidad/variantes/adicionales/salsas/promos, vuelve a cotizar delivery y conserva idempotencia mediante `client_order_id`.
3. Recalcular y normalizar las líneas en el trigger SQL, rechazar pedido sin catálogo, validar zona/pago/longitudes, y descartar campos extra enviados por el cliente.
4. Agregar `items_subtotal` y `total_amount`; incluir los precios de adicionales configurados.
5. Corregir errores preexistentes de tipos en redirecciones al login y lectura del parámetro `reset`.
6. Agregar cinco pruebas de precios/disponibilidad y una regresión SQL transaccional para denegación de insert público, precio/total canónico, artículo desconocido y catálogo ausente.

### Despliegue coordinado (no ejecutado)

Antes de habilitar la nueva versión, configurar en el entorno servidor de Netlify `SUPABASE_SERVICE_ROLE_KEY` y `GEOAPIFY_API_KEY` con secretos vigentes, aplicar la migración `20261013160000_server_order_authority.sql` y desplegar el código de servidor. Deben publicarse como un cambio coordinado: al aplicar la migración, los inserts directos antiguos dejan de funcionar; la función de servidor nueva debe estar desplegada para mantener checkout.

## Validación realizada

- `bun install --frozen-lockfile` con Bun 1.4.2: **éxito**, 897 paquetes; los lockfiles no se alteraron.
- `bun run build`: **éxito**.
- `tsc --noEmit`: **éxito** después de corregir los errores de tipos heredados.
- `bun test tests/order-pricing.test.mjs`: **5/5 pruebas aprobadas**.
- PostgreSQL 16 local, esquema mínimo de prueba: migración aplicada y pruebas SQL aprobadas para anon/autenticado, recalculado del artículo y del total, rechazo de artículo desconocido y fallo cerrado sin catálogo. La transacción de prueba se revierte.
- Runbook de propietarios: los cuatro bloques SQL se ejecutaron con UUID ficticios en tablas mock locales; quedaron dos dueños protegidos con rol admin y se retiró al desarrollador de `protected_admins`, `user_roles` y la solicitud de acceso. No se tocó ninguna cuenta real.
- `npm audit` sobre el lockfile: **13 high, 0 critical**; sin corrección sugerida por npm.
- `npm ci` no pudo reproducirse desde `package-lock.json`; Netlify declara Bun 1.4.2 y `bun.lock`, que sí pasó la instalación congelada.

## Pruebas pendientes antes de desplegar

- En Supabase local/staging: probar como `anon` las RPC administrativas; como usuario normal intentar conceder/revocar `admin`; como admin no propietario intentar apropiarse de la administración; probar el owner protegido y el último admin. Incluir una prueba concurrente del flujo de revisión.
- En la misma instancia: comprobar RLS de lectura/actualización/borrado de pedidos y usuarios, Storage y revocación de permisos con sesiones existentes. El SQL local de esta revisión no cargó Supabase Auth ni reemplaza esas pruebas.
- End-to-end con datos ficticios para checkout, pago, WhatsApp, delivery, seguimiento, promociones y gestión de menú después de desplegar el cambio; validar recálculo Geoapify con direcciones de prueba y que el reintento idempotente confirme la orden existente.
- En staging de Netlify: confirmar las cabeceras efectivas en SSR y funciones, probar CSP, upload/transformación de imágenes, CSRF/XSS en navegador y rate limit de cotización/pedido. Nada de esto se verificó contra un dominio o proveedor real.

## Plan de atención

1. **Inmediato:** retirar el `.env` del ZIP original compartido y rotar cualquier clave real/activa que contenga; comprobar también la vigencia de los secretos de build.
2. Revisar los commits y desplegar en staging la función servidor y la migración coordinadamente; ejecutar las pruebas de roles, RLS y flujos listadas arriba antes de producción.
3. Confirmar límites de requests y cabeceras en el proveedor. Para las 13 dependencias `dev`, monitorear advisories y actualizar solo cuando haya versiones compatibles verificadas o cambiar la cadena afectada; repetir audit/build después.
4. Transferir control de la app siguiendo el runbook y revisar aparte GitHub, Netlify, Supabase Dashboard y llaves de despliegue.

**Límites:** no había conexión/credenciales a Supabase ni Geoapify; no se ejecutó la migración en el proyecto real, no se verificó el dominio desplegado y no se hizo prueba de penetración externa. El PostgreSQL local valida SQL y permisos en un esquema mínimo, no sustituye una prueba de integración completa con Supabase.
