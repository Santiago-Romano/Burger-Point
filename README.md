# Burger Point

Smash burger ordering site and order-management panel.

## Local development

1. Copy `.env.example` to `.env` and configure an independent Supabase project.
2. Install dependencies with `npm install`.
3. Run `npm run dev`.

Apply the database migrations in `supabase/migrations` to the Supabase project before using authentication, orders, or menu management.

## Netlify deployment

The project uses the TanStack Start Netlify Vite plugin to deploy server rendering and server functions to Netlify. Connect the repository to Netlify and use the build command and publish directory in `netlify.toml` (`bun run build` and `dist/client`).

Configure the required Supabase and cron environment variables in Netlify using `.env.example` as a reference. Keep service-role keys in Netlify's environment settings; never commit them.

### Delivery distance pricing

The checkout requests a Google Maps Routes API driving distance from Cnel. Quesada 1275, Ituzaingó to the entered delivery address. Configure `GOOGLE_MAPS_API_KEY` in the local `.env` and in Netlify's environment settings. Enable the Routes API and billing in the Google Cloud project, and restrict the key to the Routes API. The key is read only by the server function.

Apply `20261010130000_delivery_distance_quote.sql` to Supabase before recording delivery quotes. The driving-distance fees are $1,500 through 2.5 km; $1,800 through 3 km; $2,000 through 3.5 km; $2,500 through 4 km; $3,000 through 4.5 km; $3,500 through 5 km; and $4,000 through 5.5 km. Delivery is unavailable beyond 5.5 km.

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

- Configure Netlify environment variables; never commit `.env` or service-role keys.
- Configure Supabase backups and alerts for database/API errors.
- Add an external uptime and error monitor for the Worker and Supabase.
- Test the actual 58/80 mm printer, browser print scale, margins and paper cut.
- Run a load test against a staging project before advertising peak-demand capacity.
- Keep the panel open on a dedicated local device; Realtime reconnects and the
  periodic refresh recover orders after a browser/network interruption.

The project cannot guarantee an SLA, queue capacity or printer behavior from
code alone; those depend on the selected Netlify/Supabase plans and the
local hardware configuration.
