import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServerDeliveryQuote } from "@/lib/delivery-quote.server";

const quoteInput = z.object({
  address: z.string().trim().min(4).max(200),
  zone: z.enum(["Ituzaingó", "Castelar", "Padua", "Udaondo", "Villa Tesei"]),
});

export const quoteDelivery = createServerFn({ method: "POST" })
  .validator(quoteInput)
  .handler(async ({ data }) => getServerDeliveryQuote(data.address, data.zone));
