import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDeliveryFee } from "@/lib/delivery-fees";

const quoteInput = z.object({
  address: z.string().trim().min(4).max(200),
  zone: z.enum(["Ituzaingó", "Castelar", "Padua", "Udaondo", "Villa Tesei"]),
});

type RoutesResponse = { routes?: { distanceMeters?: number }[] };

export const quoteDelivery = createServerFn({ method: "POST" })
  .validator(quoteInput)
  .handler(async ({ data }) => {
    const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
    if (!apiKey) return { success: false as const, reason: "configuration" as const };

    try {
      const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { address: "Cnel. Quesada 1275, Ituzaingó, Buenos Aires, Argentina" },
          destination: {
            address: `${data.address}, ${data.zone}, Buenos Aires, Argentina`,
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          regionCode: "AR",
          languageCode: "es-AR",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) return { success: false as const, reason: "route" as const };

      const result = (await response.json()) as RoutesResponse;
      const distanceMeters = result.routes?.[0]?.distanceMeters;
      if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
        return { success: false as const, reason: "route" as const };
      }

      return { success: true as const, ...getDeliveryFee(distanceMeters) };
    } catch {
      return { success: false as const, reason: "route" as const };
    }
  });
