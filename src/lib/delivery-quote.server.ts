import { getDeliveryFee, type DeliveryFeeResult } from "@/lib/delivery-fees";

export type ServerDeliveryQuote =
  | ({ success: true } & DeliveryFeeResult)
  | { success: false; reason: "configuration" | "route" };

type GeocodeResponse = {
  results?: { lat?: number; lon?: number }[];
};
type RouteResponse = {
  results?: { distance?: number }[];
};

const STORE_ADDRESS = "Cnel. Quesada 1275, Ituzaingó, Buenos Aires, Argentina";
const LOCAL_BIAS = "-58.67,-34.65";

async function geocode(address: string, apiKey: string) {
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.search = new URLSearchParams({
    text: address,
    format: "json",
    limit: "1",
    lang: "es",
    filter: "countrycode:ar",
    bias: `proximity:${LOCAL_BIAS}`,
    apiKey,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Geocoding failed");
  const result = (await response.json()) as GeocodeResponse;
  const point = result.results?.[0];
  if (
    typeof point?.lat !== "number" ||
    typeof point.lon !== "number" ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lon)
  ) {
    throw new Error("Address not found");
  }
  return point;
}

export async function getServerDeliveryQuote(address: string, zone: string): Promise<ServerDeliveryQuote> {
  const apiKey = process.env["GEOAPIFY_API_KEY"];
  if (!apiKey) return { success: false, reason: "configuration" };

  try {
    const [origin, destination] = await Promise.all([
      geocode(STORE_ADDRESS, apiKey),
      geocode(`${address}, ${zone}, Buenos Aires, Argentina`, apiKey),
    ]);
    const routeUrl = new URL("https://api.geoapify.com/v1/routing");
    routeUrl.search = new URLSearchParams({
      waypoints: `${origin.lat},${origin.lon}|${destination.lat},${destination.lon}`,
      mode: "drive",
      type: "short",
      units: "metric",
      format: "json",
      apiKey,
    }).toString();
    const response = await fetch(routeUrl, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return { success: false, reason: "route" };
    const result = (await response.json()) as RouteResponse;
    const distanceMeters = result.results?.[0]?.distance;
    if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
      return { success: false, reason: "route" };
    }
    const defaultQuote = getDeliveryFee(distanceMeters);
    if (!defaultQuote.available) return { success: true, ...defaultQuote };

    // Read the current owner-configured tariff table; retain legacy defaults if settings are unavailable.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: settings } = await supabaseAdmin
        .from("shop_settings")
        .select("delivery_fee_2500, delivery_fee_3000, delivery_fee_3500, delivery_fee_4000, delivery_fee_4500, delivery_fee_5000, delivery_fee_5500")
        .eq("id", 1)
        .maybeSingle();
      if (settings) {
        const bands = [
          { maxMeters: 2500, fee: settings.delivery_fee_2500 },
          { maxMeters: 3000, fee: settings.delivery_fee_3000 },
          { maxMeters: 3500, fee: settings.delivery_fee_3500 },
          { maxMeters: 4000, fee: settings.delivery_fee_4000 },
          { maxMeters: 4500, fee: settings.delivery_fee_4500 },
          { maxMeters: 5000, fee: settings.delivery_fee_5000 },
          { maxMeters: 5500, fee: settings.delivery_fee_5500 },
        ];
        const band = bands.find((item) => Math.ceil(distanceMeters) <= item.maxMeters);
        if (band && Number.isSafeInteger(band.fee) && band.fee >= 0) {
          return { success: true, available: true, distanceMeters: Math.ceil(distanceMeters), fee: band.fee };
        }
      }
    } catch {
      // Keep existing tariff behavior if the optional settings read fails.
    }
    return { success: true, ...defaultQuote };
  } catch {
    return { success: false, reason: "route" };
  }
}
