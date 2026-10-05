import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type NewOrder = Database["public"]["Tables"]["orders"]["Insert"];
export type SubmittedOrder = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_number" | "client_order_id"
>;

const RETRY_DELAYS_MS = [250, 750, 1500];

type SupabaseError = { code?: string; status?: number; message?: string };

function isRetryable(error: SupabaseError | null): boolean {
  if (!error) return false;
  if (error.code === "23505" || error.code === "42501" || error.code === "23514") return false;
  return !error.status || error.status >= 500;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function submitOrder(
  order: NewOrder,
): Promise<{ data: SubmittedOrder | null; error: SupabaseError | null }> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await supabase
      .from("orders")
      .insert(order)
      .select("id, order_number, client_order_id")
      .single();

    if (!result.error) return { data: result.data, error: null };

    // A unique conflict means the first request probably succeeded and the
    // response was lost. Read the existing row instead of creating a duplicate.
    if (result.error.code === "23505") {
      const existing = await supabase
        .from("orders")
        .select("id, order_number, client_order_id")
        .eq("client_order_id", order.client_order_id!)
        .maybeSingle();
      if (existing.data) return { data: existing.data, error: null };
      return { data: null, error: result.error };
    }

    if (!isRetryable(result.error) || attempt === RETRY_DELAYS_MS.length) {
      return { data: null, error: result.error };
    }
    await wait(RETRY_DELAYS_MS[attempt]!);
  }

  return { data: null, error: { message: "No se pudo registrar el pedido." } };
}
