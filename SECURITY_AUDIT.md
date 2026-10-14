# Auditoría de seguridad — Burger Point

**Fecha:** 13 de octubre de 2026  
**Rama:** `security-audit-20261013`  
**Alcance:** código fuente, migraciones Supabase, configuración de Netlify, dependencias y artefactos incluidos en `BurgerPoint.zip`.

> Esta auditoría se realizó sobre una copia aislada. No se modificó producción ni se ejecutaron acciones destructivas contra datos reales. No se puede afirmar que el sistema sea completamente seguro sin probar la instancia real de Supabase, Netlify, Storage y Auth.

## 1. Inventario de arquitectura y funcionalidades

- Aplicación React + TanStack Start + Vite + TypeScript.
- Supabase Auth para registro, login, recuperación de contraseña y sesiones persistentes.
- Supabase Postgres con RLS, RPC `SECURITY DEFINER`, triggers y Realtime.
- Página pública con catálogo, promociones, variantes, extras, salsas, carrito y checkout.
- Pedido anónimo o autenticado almacenado en `public.orders`.
- Idempotencia de pedidos mediante `client_order_id`.
- Delivery con geocodificación y routing de Geoapify; tarifas por distancia y atribución OpenStreetMap.
- Seguimiento público mediante UUID y RPC `get_order_tracking`.
- Panel autenticado para pedidos, cambios de estado, edición, impresión y configuración de demoras.
- Gestión del menú persistido en `public.menu_content` y fotos en Storage (`menu-images`).
- Roles `admin` y `operator`, solicitudes de acceso y administración de cuentas.
- Netlify para build/deploy; variables de entorno para Supabase, Geoapify y service role.

## 2. Hallazgos priorizados

### BP-SEC-001 — Bootstrap público del primer administrador

- **Severidad:** Alta.
- **Evidencia:** las versiones previas de `claim_admin()` insertaban automáticamente el rol `admin` si todavía no existía ningún administrador (`20261003002329...sql`, `20261005120000...sql`, `20261006130100...sql`).
- **Impacto:** el primer usuario autenticado podía convertirse en administrador. Aunque el mecanismo requería una cuenta autenticada, no establecía al propietario mediante un procedimiento controlado.
- **Corrección aplicada:** `20261013150000_security_hardening.sql` reemplaza `claim_admin()` para que nunca cree un administrador; si el usuario no tiene rol, solo crea una solicitud pendiente.
- **Riesgo residual:** la migración debe aplicarse en Supabase y un operador con `service_role` debe registrar explícitamente al propietario.

### BP-SEC-002 — Falta de jerarquía de propietario y RPC administrativa antigua

- **Severidad:** Alta.
- **Evidencia:** existía `set_admin_user_access(uuid, boolean)` con ejecución para usuarios autenticados y sin conocimiento de una cuenta propietaria protegida. También existía `review_admin_access_request(uuid, boolean)` como camino administrativo legado.
- **Impacto:** un administrador podía revocar el rol de otro administrador legítimo mediante una ruta antigua aunque la interfaz actual usara otras RPC.
- **Corrección aplicada:**
  - Nueva tabla privada `protected_admins`.
  - Las RPC nuevas impiden revocar un propietario protegido.
  - Conceder o revocar roles `admin` exige que el llamador sea propietario protegido.
  - Se revoca la ejecución para `set_admin_user_access` y `review_admin_access_request`.
  - La eliminación de una cuenta propietaria queda bloqueada por su rol administrativo y por la referencia protegida.
- **Riesgo residual:** ningún propietario actual se marca automáticamente. Eso requiere identificar sus UUID y aprobar la configuración manualmente.

### BP-SEC-003 — Pedido público confiaba demasiado en datos del navegador

- **Severidad:** Alta para integridad comercial; media para confidencialidad.
- **Evidencia:** el navegador construye `items`, `unit_price`, nombres y cantidades en `CartDrawer.tsx`; la política original permitía insertar a `anon` y solo comprobaba forma básica y cantidad de líneas.
- **Impacto:** una llamada directa a PostgREST podía enviar productos inexistentes, precios negativos o precios distintos del catálogo.
- **Corrección aplicada:** trigger `validate_order_insert()` en `20261013150000_security_hardening.sql`:
  - exige estado inicial `nuevo`;
  - valida nombre, teléfono, tipo de entrega, campos delivery/retiro y forma del JSON;
  - valida cantidades enteras entre 1 y 50;
  - rechaza precios negativos o excesivos;
  - limita extras y salsa a strings acotados;
  - si existe el menú persistido, exige que el nombre del producto/variante exista y que tenga precio en el catálogo.
- **Riesgo residual:** una instalación recién creada sin fila en `menu_content` usa la validación de forma, pero no puede validar el catálogo hasta que el menú se persista. Además, los extras se almacenan como etiquetas y no se recalcula un total monetario server-side porque el modelo actual no guarda un total definitivo. Esto debe resolverse en una fase posterior si se requiere contabilidad estricta.

### BP-SEC-004 — Cabeceras HTTP de seguridad ausentes

- **Severidad:** Media/baja.
- **Evidencia:** `netlify.toml` no tenía un bloque de headers.
- **Corrección aplicada:** se agregaron `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y HSTS.
- **Riesgo residual:** no se agregó CSP porque el proyecto usa Supabase, Geoapify, Realtime y recursos dinámicos; debe diseñarse y probarse contra el despliegue real para no romper funciones legítimas.

### BP-SEC-005 — Dependencias con vulnerabilidades reportadas

- **Severidad:** Alta en cadena de build; requiere triage.
- **Evidencia:** `npm audit --json` reportó 13 vulnerabilidades altas y ninguna crítica, principalmente en el árbol de herramientas Netlify, `sharp`, `ipx`, `fast-glob`, `micromatch`, `braces` y `node-forge`.
- **Corrección aplicada:** no se actualizaron versiones indiscriminadamente porque el proyecto fija Vite/Rolldown y requiere compatibilidad de Netlify.
- **Pendiente:** actualizar de forma controlada en una rama separada, revisar changelogs y ejecutar build/deploy staging. El entorno no permitió determinar una actualización segura automática mediante `npm audit fix --dry-run`.

## 3. Controles revisados sin hallazgo confirmado de escalamiento

- RLS de `orders`: usuarios anónimos solo insertan pedidos con estado `nuevo`; lectura, actualización y eliminación están restringidas por rol.
- Operadores no pueden eliminar pedidos según la política vigente.
- Acceso a solicitudes y lista de usuarios se comprueba dentro de funciones `SECURITY DEFINER`.
- La clave `SUPABASE_SERVICE_ROLE_KEY` se carga solo en `client.server.ts`; no se encontró en archivos rastreados por Git.
- `.env` está ignorado por `.gitignore`; el ZIP recibido sí contiene el archivo local, por lo que nunca debe subirse al repositorio ni compartirse.
- `get_order_tracking` expone únicamente número, estado y ETA, no nombre, teléfono ni domicilio.
- La página de seguimiento tiene `noindex`, `nofollow` y `no-referrer`.
- El bucket de imágenes es público intencionalmente; escritura y borrado requieren rol de staff.
- La cotización de Geoapify valida zona por enum, limita dirección, usa HTTPS y timeout de 12 segundos.
- El costo delivery se restringe mediante constraint SQL según distancia.
- Los reintentos de pedido usan `client_order_id` único para evitar duplicados.

## 4. Pruebas ejecutadas

| Prueba | Resultado |
|---|---|
| Build de producción con Vite después de las correcciones | **Pasó**: build cliente y SSR completados correctamente. |
| `npm audit --json` | **Ejecutada**: 13 altas, 0 críticas, 0 moderadas/bajas reportadas en el árbol instalado. |
| Revisión de archivos sensibles rastreados por Git | **Pasó**: no se encontró `.env`, `.pem`, `.key` ni archivo de secretos rastreado; `.env` está ignorado. |
| Revisión de permisos RPC, RLS y grants | **Ejecutada manualmente** sobre todas las migraciones incluidas. |
| TypeScript `tsc --noEmit` | **Falló por problemas preexistentes** en `CartDrawer.tsx`, rutas de auth y `index.tsx`; no corresponden a la migración de seguridad. |
| ESLint/formato completo | **No es un criterio limpio actualmente**: el proyecto recibido ya tiene cientos de errores de Prettier/formato. |
| Pruebas RLS contra Supabase real | **No ejecutadas**: no se usó una instancia externa ni credenciales reales. |
| Pruebas de concurrencia de bootstrap/roles | **No ejecutadas contra DB real**; se dejó bloqueo transaccional en RPC de roles. |
| Prueba de headers en Netlify publicado | **No ejecutada**: no se accedió al sitio/Netlify real. |

## 5. Plan seguro de transferencia a los dueños

1. Aplicar migraciones en un proyecto de staging y verificar build.
2. Identificar los UUID de las cuentas de los dueños en `auth.users` sin compartir contraseñas ni tokens.
3. Con una conexión de administración segura, ejecutar para cada dueño:

```sql
insert into public.user_roles(user_id, role)
values ('OWNER_UUID', 'admin')
on conflict (user_id, role) do nothing;

insert into public.protected_admins(user_id)
values ('OWNER_UUID')
on conflict (user_id) do nothing;
```

4. Probar con una cuenta ficticia que el primer registro solo queda pendiente.
5. Probar que un admin no propietario puede administrar operadores, pero no conceder/revocar `admin`.
6. Probar que un propietario puede mantener el control y que no puede ser eliminado por el panel.
7. Crear/verificar acceso independiente de los dueños.
8. Solo después de confirmar acceso de los dueños, quitar al desarrollador de `protected_admins` y de `user_roles` mediante el procedimiento acordado. No borrar automáticamente su cuenta.

## 6. Pendientes que requieren intervención manual

- Aplicar `20261013150000_security_hardening.sql` en Supabase.
- Registrar explícitamente los propietarios legítimos.
- Ejecutar pruebas RLS con roles `anon`, usuario normal, operador, admin y propietario.
- Revisar y actualizar dependencias Netlify de forma controlada.
- Configurar límites antiabuso/rate limiting para pedidos anónimos y cotizaciones Geoapify.
- Revisar rotación de cualquier secreto que haya sido expuesto fuera del repositorio; no se imprimieron ni recopilaron sus valores.
- Añadir CSP después de probar todos los dominios de Supabase, Geoapify, imágenes, Realtime y Netlify.
- Definir si se necesita guardar subtotal, total y precios validados en columnas server-side para contabilidad y conciliación.

## 7. Archivos modificados en esta auditoría

- `supabase/migrations/20261013150000_security_hardening.sql` — nuevo endurecimiento de roles, propietarios y validación de pedidos.
- `netlify.toml` — cabeceras HTTP de seguridad.

Los cambios de `.env.example` y `supabase/migrations/20261003002400_menu_content.sql` ya estaban presentes en el ZIP recibido antes de iniciar esta auditoría y no forman parte de las correcciones realizadas en esta rama.
