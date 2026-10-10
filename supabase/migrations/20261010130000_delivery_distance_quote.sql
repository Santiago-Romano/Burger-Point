alter table public.orders
  add column if not exists delivery_distance_meters integer,
  add column if not exists delivery_fee integer;

alter table public.orders
  drop constraint if exists orders_delivery_quote_check;

alter table public.orders
  add constraint orders_delivery_quote_check
  check (
    (delivery_distance_meters is null and delivery_fee is null)
    or (
      delivery_distance_meters is not null
      and delivery_fee is not null
      and delivery_type = 'delivery'
      and delivery_distance_meters between 0 and 5500
      and (
        (delivery_distance_meters <= 2500 and delivery_fee = 1500)
        or (delivery_distance_meters > 2500 and delivery_distance_meters <= 3000 and delivery_fee = 1800)
        or (delivery_distance_meters > 3000 and delivery_distance_meters <= 3500 and delivery_fee = 2000)
        or (delivery_distance_meters > 3500 and delivery_distance_meters <= 4000 and delivery_fee = 2500)
        or (delivery_distance_meters > 4000 and delivery_distance_meters <= 4500 and delivery_fee = 3000)
        or (delivery_distance_meters > 4500 and delivery_distance_meters <= 5000 and delivery_fee = 3500)
        or (delivery_distance_meters > 5000 and delivery_distance_meters <= 5500 and delivery_fee = 4000)
      )
    )
  );
