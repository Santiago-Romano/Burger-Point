import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { getServerDeliveryQuote } from "@/lib/delivery-quote.server";
import { OrderPricingError, priceOrderItems } from "@/lib/order-pricing";

const ZONES = ["Ituzaingó", "Castelar", "Padua", "Udaondo", "Villa Tesei"] as const;
const PAYMENTS = ["Efectivo", "Tarjeta", "Mercado Pago", "Transferencia"] as const;

const orderLineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  extras: z.array(z.string().trim().min(1).max(100)).max(20),
  salsa: z.string().max(100).nullable().optional(),
  qty: z.number().int().min(1).max(50),
  unit_price: z.number().finite().nonnegative().max(100_000_000).nullable().optional(),
});

const submissionSchema = z.object({
  client_order_id: z.string().uuid(),
  customer_name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().min(6).max(30).refine((value) => value.replace(/\D/g, "").length >= 8),
  delivery_type: z.enum(["delivery", "retiro"]),
  delivery_distance_meters: z.number().int().min(0).max(5_500).nullable(),
  delivery_fee: z.number().int().min(0).nullable(),
  address: z.string().trim().min(4).max(200).nullable(),
  zone: z.enum(ZONES).nullable(),
  payment: z.enum(PAYMENTS),
  notes: z.string().trim().max(500).nullable(),
  items: z.array(orderLineSchema).min(1).max(50),
});

export type OrderSubmission = z.infer<typeof submissionSchema>;
export type OrderSubmissionResult = {
  data: { id: string; order_number: number; client_order_id: string } | null;
  error: { code?: string; status?: number; message?: string } | null;
  retrySafe: boolean;
};

function failure(code: string, message: string, retrySafe = false): OrderSubmissionResult {
  return { data: null, error: { code, message }, retrySafe };
}

export const submitOrder = createServerFn({ method: "POST" })
  .validator(submissionSchema)
  .handler(async ({ data }): Promise<OrderSubmissionResult> => {
    try {
      const { checkRateLimit, getClientKey } = await import("@/lib/rate-limit.server");
      const clientKey = await getClientKey("order");
      if (clientKey && !checkRateLimit(clientKey, 8, 5 * 60_000)) {
        return failure(
          "rate_limited",
          "Estamos recibiendo demasiados pedidos desde tu conexión. Esperá unos minutos e intentá de nuevo.",
          false,
        );
      }

      if (data.delivery_type === "delivery") {
        if (!data.address || !data.zone) return failure("invalid_delivery", "Revisá la dirección y localidad.");
      } else if (
        data.address !== null ||
        data.zone !== null ||
        data.delivery_fee !== null ||
        data.delivery_distance_meters !== null
      ) {
        return failure("invalid_delivery", "Los pedidos para retirar no llevan dirección ni costo de envío.");
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const priorOrder = await supabaseAdmin
        .from("orders")
        .select("id,order_number,client_order_id")
        .eq("client_order_id", data.client_order_id)
        .maybeSingle();
      if (priorOrder.data) return { data: priorOrder.data, error: null, retrySafe: true };
      if (priorOrder.error) {
        return failure("order_lookup_failed", "No se pudo verificar el pedido previo. Intentá nuevamente.", true);
      }

      const { data: menu, error: menuError } = await supabaseAdmin
        .from("menu_content")
        .select("items")
        .eq("id", 1)
        .maybeSingle();
      if (menuError || !Array.isArray(menu?.items)) {
        return failure("catalog_unavailable", "El menú no está disponible para confirmar pedidos.", true);
      }

      const priced = priceOrderItems(data.items, menu.items);
      let deliveryDistance: number | null = null;
      let deliveryFee: number | null = null;
      if (data.delivery_type === "delivery") {
        const quote = await getServerDeliveryQuote(data.address!, data.zone!);
        if (!quote.success) {
          return failure(
            quote.reason === "configuration" ? "delivery_configuration" : "delivery_quote_failed",
            quote.reason === "configuration"
              ? "El cálculo de envío no está configurado. Elegí retiro o contactá al local."
              : "No pudimos verificar el costo de envío. Revisá la dirección e intentá nuevamente.",
            true,
          );
        }
        if (!quote.available || quote.distanceMeters > 5_500 || quote.fee === null) {
          return failure("delivery_unavailable", "No llegamos a esa dirección: supera los 5,5 km de recorrido.");
        }
        if (
          data.delivery_distance_meters !== quote.distanceMeters ||
          data.delivery_fee !== quote.fee
        ) {
          return failure("delivery_quote_changed", "El costo de envío cambió. Volvé a calcularlo y revisá el total.");
        }
        deliveryDistance = quote.distanceMeters;
        deliveryFee = quote.fee;
      }

      const insert: Database["public"]["Tables"]["orders"]["Insert"] = {
        client_order_id: data.client_order_id,
        customer_name: data.customer_name,
        customer_email: data.email,
        phone: data.phone,
        delivery_type: data.delivery_type,
        delivery_distance_meters: deliveryDistance,
        delivery_fee: deliveryFee,
        address: data.delivery_type === "delivery" ? data.address : null,
        zone: data.delivery_type === "delivery" ? data.zone : null,
        payment: data.payment,
        notes: data.notes || null,
        items: priced.items as unknown as Json,
        items_subtotal: priced.itemsSubtotal,
        total_amount: priced.itemsSubtotal + (deliveryFee ?? 0),
        status: "nuevo",
      };

      const inserted = await supabaseAdmin
        .from("orders")
        .insert(insert)
        .select("id,order_number,client_order_id")
        .single();
      if (!inserted.error && inserted.data) {
        const { sendOrderReceivedEmail, buildTrackingUrl } = await import("@/lib/email.server");
        await sendOrderReceivedEmail({
          to: data.email,
          orderNumber: inserted.data.order_number,
          customerName: data.customer_name,
          deliveryType: data.delivery_type,
          total: priced.itemsSubtotal + (deliveryFee ?? 0),
          trackingUrl: buildTrackingUrl(data.client_order_id),
        });
        return { data: inserted.data, error: null, retrySafe: true };
      }

      if (inserted.error?.code === "23505") {
        const existing = await supabaseAdmin
          .from("orders")
          .select("id,order_number,client_order_id")
          .eq("client_order_id", data.client_order_id)
          .maybeSingle();
        if (existing.data) return { data: existing.data, error: null, retrySafe: true };
      }
      return failure("order_insert_failed", "No se pudo registrar el pedido. Intentá nuevamente.", true);
    } catch (error) {
      if (error instanceof OrderPricingError) {
        return failure(error.code, error.message);
      }
      console.error("[order-submit] Pedido rechazado por un error de servidor.");
      return failure("server_error", "No se pudo confirmar el pedido. Intentá nuevamente.", true);
    }
  });
