# Runbook de transferencia de propietarios — Burger Point

**No ejecutar con UUID de ejemplo.** Este procedimiento es para aplicar manualmente por el operador autorizado en un proyecto de prueba y luego, con aprobación de los dueños, en producción. No cambia cuentas por sí solo.

## 1. Prevalidaciones

1. Cada propietario designado debe haber creado y confirmado su cuenta; obtener su UUID desde `auth.users` y verificarlo con la persona por un canal independiente. No identificar propietarios solo por una dirección de correo.
2. Guardar una exportación/backup de `public.user_roles`, `public.protected_admins` y `public.admin_access_requests`.
3. Confirmar que el UUID del desarrollador no se confunda con ninguno de los UUID de propietarios.
4. Ejecutar el alta con un operador confiable con privilegio SQL de despliegue; `protected_admins` no concede escritura a `anon` ni a `authenticated`.

Consulta de verificación de identidades (reemplazar los valores y ejecutar antes de la transacción):

```sql
select id, email, email_confirmed_at
from auth.users
where id in (
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
);
```

El resultado debe tener exactamente una fila por persona designada; confirmar que los UUID corresponden a las cuentas de los dueños.

## 2. Alta atómica de dueños

Reemplazar los UUID ficticios por los UUID previamente comprobados. Ejecutar el bloque completo en **una sola transacción**. Los locks serializan esta operación con los RPC de cambio de roles; se insertan primero las protecciones y luego el rol admin, y se verifica todo antes del commit.

```sql
begin;
lock table public.user_roles in share row exclusive mode;
lock table public.protected_admins in share row exclusive mode;

do $$
declare
  owner_ids uuid[] := array[
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid
  ];
begin
  if cardinality(owner_ids) < 2 then
    raise exception 'Se requieren al menos dos propietarios designados';
  end if;
  if (select count(distinct id) from unnest(owner_ids) as owners(id)) <> cardinality(owner_ids) then
    raise exception 'Hay UUID de propietario duplicados';
  end if;
  if exists (
    select 1 from unnest(owner_ids) as owners(id)
    where not exists (select 1 from auth.users as u where u.id = owners.id)
  ) then
    raise exception 'Un UUID designado no existe en auth.users';
  end if;
end;
$$;

insert into public.protected_admins(user_id)
select owner_id
from unnest(array[
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
]) as owners(owner_id)
on conflict (user_id) do nothing;

insert into public.user_roles(user_id, role)
select owner_id, 'admin'::public.app_role
from unnest(array[
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
]) as owners(owner_id)
on conflict (user_id, role) do nothing;

do $$
declare
  owner_ids uuid[] := array[
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid
  ];
begin
  if exists (
    select 1 from unnest(owner_ids) as owners(id)
    where not exists (select 1 from public.protected_admins as p where p.user_id = owners.id)
       or not exists (select 1 from public.user_roles as r where r.user_id = owners.id and r.role = 'admin')
  ) then
    raise exception 'No se pudo verificar protected_admins y admin para todos los propietarios';
  end if;
end;
$$;

commit;
```

Si cualquier comprobación falla, ejecutar `rollback` y no retirar el acceso existente.

## 3. Verificación antes de retirar al desarrollador

Como administrador SQL autorizado, comprobar que cada dueño figura en ambas tablas. Luego cada dueño debe iniciar sesión en el panel desde su propio dispositivo y confirmar que obtiene acceso de `admin` y puede ejercer las funciones esperadas. Mantener al menos dos propietarios protegidos y activos.

```sql
select u.id, u.email,
       exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin') as is_admin,
       exists (select 1 from public.protected_admins p where p.user_id = u.id) as is_protected_owner
from auth.users u
where u.id in (
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
);
```

## 4. Retiro controlado del admin del desarrollador

Solo después de la verificación de ambos dueños, llamar a `set_user_app_role` desde la sesión autenticada de uno de los propietarios, por RPC, con el UUID del desarrollador y `_role = null`. El RPC actual valida que el llamante sea administrador protegido, impide el auto-cambio y conserva al último admin.

```text
RPC public.set_user_app_role(
  _user_id = <UUID_VERIFICADO_DEL_DESARROLLADOR>,
  _role    = null
)
```

Si el RPC responde que el desarrollador es un `protected_admin`, **no** lo desproteger antes de verificar que los dos dueños ya iniciaron sesión correctamente. Después de esa verificación, un operador de despliegue autorizado puede revocar en una transacción única su protección y roles de la aplicación. El guard impide el cambio si no detecta a los dos dueños protegidos con rol `admin` distintos del desarrollador:

```sql
begin;
lock table public.user_roles in share row exclusive mode;
lock table public.protected_admins in share row exclusive mode;

do $$
declare
  developer_id uuid := '33333333-3333-4333-8333-333333333333'::uuid;
  owner_ids uuid[] := array[
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid
  ];
begin
  if (select count(distinct p.user_id)
      from public.protected_admins p
      join public.user_roles r on r.user_id = p.user_id and r.role = 'admin'
      where p.user_id = any(owner_ids) and p.user_id <> developer_id) < 2 then
    raise exception 'Se requieren dos dueños distintos del desarrollador, protegidos y con rol admin';
  end if;
end;
$$;

delete from public.protected_admins
where user_id = '33333333-3333-4333-8333-333333333333'::uuid;
delete from public.user_roles
where user_id = '33333333-3333-4333-8333-333333333333'::uuid;
update public.admin_access_requests
set status = 'rejected', reviewed_at = now(), reviewed_by = null
where user_id = '33333333-3333-4333-8333-333333333333'::uuid;

commit;
```

Reemplazar todos los UUID de ejemplo y revisar el `DO` antes de ejecutar. No borrar la cuenta del desarrollador como sustituto de la revocación: la FK `ON DELETE RESTRICT` de `protected_admins` lo impide deliberadamente.

Al terminar, verificar por SQL que el desarrollador ya no tiene `admin` y que los dueños siguen en ambas tablas. Revisar también, por separado, el acceso de esa persona a GitHub, Netlify, Supabase Dashboard, llaves/API y repositorios: `protected_admins` solo controla roles de la aplicación, no esos proveedores. Si se revoca acceso a secretos de despliegue, rotar las claves de forma coordinada con el despliegue y sin publicar valores en tickets o logs.
