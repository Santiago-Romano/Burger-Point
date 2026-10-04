# Burger Point

Smash burger ordering site and order-management panel.

## Local development

1. Copy `.env.example` to `.env` and configure an independent Supabase project.
2. Install dependencies with `npm install`.
3. Run `npm run dev`.

Apply the database migrations in `supabase/migrations` to the Supabase project before using authentication, orders, or menu management.

## Cloudflare deployment

`npm run build` creates a Cloudflare Workers build. Configure the Supabase environment variables as Worker secrets, then deploy the prebuilt output with `npx nitro deploy --prebuilt`.

