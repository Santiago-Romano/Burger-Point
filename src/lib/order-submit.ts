import type { Database } from "@/integrations/supabase/types";

/**
 * Public PostgREST inserts are intentionally not exposed from the browser.
 * Use submitOrder from order-submit.functions.ts so prices and delivery are
 * recalculated in the trusted server runtime before persistence.
 */
export type NewOrder = Database["public"]["Tables"]["orders"]["Insert"];
