-- Presets de demora configurables para hamburguesas y delivery.
-- Los operadores y administradores pueden agregarlos, seleccionarlos y eliminarlos desde el panel.
alter table public.shop_settings
  add column if not exists prep_presets integer[] not null default array[20, 30, 40, 50]::integer[],
  add column if not exists delivery_presets integer[] not null default array[20, 30, 40, 50]::integer[];

update public.shop_settings
set prep_presets = case when cardinality(prep_presets) = 0 then array[20, 30, 40, 50]::integer[] else prep_presets end,
    delivery_presets = case when cardinality(delivery_presets) = 0 then array[20, 30, 40, 50]::integer[] else delivery_presets end
where id = 1;

alter table public.shop_settings
  add constraint shop_settings_prep_presets_valid
  check (cardinality(prep_presets) between 1 and 24);

alter table public.shop_settings
  add constraint shop_settings_delivery_presets_valid
  check (cardinality(delivery_presets) between 1 and 24);
