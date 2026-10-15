-- Email del cliente para enviar la confirmación de pedido recibido.
alter table public.orders add column if not exists customer_email text;

comment on column public.orders.customer_email is
  'Email declarado por el cliente en el checkout; se usa para la confirmación de pedido recibido.';
