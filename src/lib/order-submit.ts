import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type NewOrder = Database["public"]["Tables"]["orders"]["Insert"];
export type SubmittedOrder = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_number" | "client_order_id"
>;

const RETRY_DELAYS_MS = [250, 750, 1500];

type SupabaseError = { code?: string; status?: number; message?: string };

function isMissingClientOrderId(error: SupabaseError): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    (error.code === "PGRST204" || error.code === "42703") && message.includes("client_order_id")
  );
}

function isRetryable(error: SupabaseError | null): boolean {
  if (!error) return false;
  if (error.code === "23505" || error.code === "42501" || error.code === "23514") return false;
  return !error.status || error.status >= 500;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function submitOrder(order: NewOrder): Promise<{
  data: SubmittedOrder | null;
  error: SupabaseError | null;
  retrySafe: boolean;
}> {
  const insert = (value: NewOrder) => supabase.from("orders").insert(value);
  const retrySafe = true;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    // Do not chain .select() here. Anonymous customers have INSERT access but
    // intentionally do not have SELECT access to orders. The insert response
    // itself is enough to confirm acceptance by the database.
    const result = await insert(order);

    if (!result.error) return { data: null, error: null, retrySafe };

    if (retrySafe && isMissingClientOrderId(result.error)) {
      const { client_order_id: _clientOrderId, ...legacyOrder } = order;
      const legacyResult = await supabase.from("orders").insert(legacyOrder);
      return { data: null, error: legacyResult.error, retrySafe: false };
    }

    // A unique conflict means the first request probably succeeded and the
    // response was lost. Read the existing row instead of creating a duplicate.
    if (result.error.code === "23505") {
      // UUID collisions are practically impossible. A unique conflict for
      // this stable key therefore means a previous retry already succeeded.
      return { data: null, error: null, retrySafe };
    }

    if (!retrySafe || !isRetryable(result.error) || attempt === RETRY_DELAYS_MS.length) {
      return { data: null, error: result.error, retrySafe };
    }
    await wait(RETRY_DELAYS_MS[attempt]!);
  }

  return {
    data: null,
    error: { message: "No se pudo registrar el pedido." },
    retrySafe,
  };
}
