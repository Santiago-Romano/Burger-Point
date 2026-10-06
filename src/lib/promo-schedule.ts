export const PROMO_WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

export function getBuenosAiresWeekday(date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
  }).format(date);

  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

export function isPromoAvailableToday(
  promoDays: number[] | undefined,
  weekday = getBuenosAiresWeekday(),
): boolean {
  return promoDays?.includes(weekday) ?? false;
}
