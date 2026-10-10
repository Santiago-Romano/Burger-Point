export type DeliveryFeeResult =
  | { available: true; distanceMeters: number; fee: number }
  | { available: false; distanceMeters: number; fee: null };

const DELIVERY_FEE_BANDS = [
  { maxMeters: 2_500, fee: 1_500 },
  { maxMeters: 3_000, fee: 1_800 },
  { maxMeters: 3_500, fee: 2_000 },
  { maxMeters: 4_000, fee: 2_500 },
  { maxMeters: 4_500, fee: 3_000 },
  { maxMeters: 5_000, fee: 3_500 },
  { maxMeters: 5_500, fee: 4_000 },
] as const;

export function getDeliveryFee(distanceMeters: number): DeliveryFeeResult {
  const distance = Math.ceil(distanceMeters);
  const band = DELIVERY_FEE_BANDS.find(({ maxMeters }) => distance <= maxMeters);

  return band
    ? { available: true, distanceMeters: distance, fee: band.fee }
    : { available: false, distanceMeters: distance, fee: null };
}

export function formatDistance(distanceMeters: number): string {
  return `${(distanceMeters / 1000).toLocaleString("es-AR", {
    maximumFractionDigits: 2,
  })} km`;
}
