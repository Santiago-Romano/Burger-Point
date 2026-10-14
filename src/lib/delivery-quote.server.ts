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
    return { success: true, ...getDeliveryFee(distanceMeters) };
  } catch {
    return { success: false, reason: "route" };
  }
}
