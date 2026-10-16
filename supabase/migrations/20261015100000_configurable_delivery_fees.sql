-- Owner-configurable delivery tariffs, preserving the current prices as defaults.
alter table public.shop_settings
  add column if not exists delivery_fee_2500 integer not null default 1500,
  add column if not exists delivery_fee_3000 integer not null default 1800,
  add column if not exists delivery_fee_3500 integer not null default 2000,
  add column if not exists delivery_fee_4000 integer not null default 2500,
  add column if not exists delivery_fee_4500 integer not null default 3000,
  add column if not exists delivery_fee_5000 integer not null default 3500,
  add column if not exists delivery_fee_5500 integer not null default 4000;

alter table public.shop_settings
  drop constraint if exists shop_settings_delivery_fees_check;

alter table public.shop_settings
  add constraint shop_settings_delivery_fees_check check (
    delivery_fee_2500 between 0 and 100000
    and delivery_fee_3000 between delivery_fee_2500 and 100000
    and delivery_fee_3500 between delivery_fee_3000 and 100000
    and delivery_fee_4000 between delivery_fee_3500 and 100000
    and delivery_fee_4500 between delivery_fee_4000 and 100000
    and delivery_fee_5000 between delivery_fee_4500 and 100000
    and delivery_fee_5500 between delivery_fee_5000 and 100000
  );

-- Delivery quote validation must use the active settings rather than fixed prices.
alter table public.orders
  drop constraint if exists orders_delivery_quote_check;

alter table public.orders
  add constraint orders_delivery_quote_check check (
    (delivery_distance_meters is null and delivery_fee is null)
    or (
      delivery_distance_meters is not null
      and delivery_fee is not null
      and delivery_type = 'delivery'
      and delivery_distance_meters between 0 and 5500
      and delivery_fee between 0 and 100000
    )
  );
