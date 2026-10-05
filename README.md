# Burger Point

Smash burger ordering site and order-management panel.

## Local development

1. Copy `.env.example` to `.env` and configure an independent Supabase project.
2. Install dependencies with `npm install`.
3. Run `npm run dev`.

Apply the database migrations in `supabase/migrations` to the Supabase project before using authentication, orders, or menu management.

## Cloudflare deployment

`npm run build` creates a Cloudflare Workers build. Configure the Supabase environment variables as Worker secrets, then deploy the prebuilt output with `npx nitro deploy --prebuilt`.

## Order reliability

Apply all migrations in `supabase/migrations`, including
`20261005000000_order_reliability.sql`. The order form now generates a stable
client UUID and retries transient failures without creating duplicate orders.
The `orders.client_order_id` unique index is required for this behavior.

The local panel refreshes every 30 seconds, refreshes when the tab becomes
visible again, and shows the Realtime connection state. Operators can edit
customer/contact/delivery/payment/notes fields, advance status, cancel and
print an order at 58 mm or 80 mm.

## Production checklist

- Configure Cloudflare Worker secrets; never commit `.env` or service-role keys.
- Configure Supabase backups and alerts for database/API errors.
- Add an external uptime and error monitor for the Worker and Supabase.
- Test the actual 58/80 mm printer, browser print scale, margins and paper cut.
- Run a load test against a staging project before advertising peak-demand capacity.
- Keep the panel open on a dedicated local device; Realtime reconnects and the
  periodic refresh recover orders after a browser/network interruption.

The project cannot guarantee an SLA, queue capacity or printer behavior from
code alone; those depend on the selected Cloudflare/Supabase plans and the
local hardware configuration.
