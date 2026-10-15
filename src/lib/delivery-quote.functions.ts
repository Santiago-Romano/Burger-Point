import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServerDeliveryQuote } from "@/lib/delivery-quote.server";

const quoteInput = z.object({
  address: z.string().trim().min(4).max(200),
  zone: z.enum(["Ituzaingó", "Castelar", "Padua", "Udaondo", "Villa Tesei"]),
});

export const quoteDelivery = createServerFn({ method: "POST" })
  .validator(quoteInput)
  .handler(async ({ data }) => {
    const { checkRateLimit, getClientKey } = await import("@/lib/rate-limit.server");
    const clientKey = await getClientKey("quote");
    if (clientKey && !checkRateLimit(clientKey, 40, 5 * 60_000)) {
      return {
        success: false as const,
        reason: "route" as const,
      };
    }
    return getServerDeliveryQuote(data.address, data.zone);
  });
