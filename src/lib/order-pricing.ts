export type OrderPricingErrorCode =
  | "catalog_unavailable"
  | "invalid_order"
  | "unknown_product"
  | "product_unavailable"
  | "price_changed"
  | "invalid_extra"
  | "invalid_sauce"
  | "promo_unavailable";

export class OrderPricingError extends Error {
  readonly code: OrderPricingErrorCode;

  constructor(code: OrderPricingErrorCode, message: string) {
    super(message);
    this.name = "OrderPricingError";
    this.code = code;
  }
}

export interface PricedOrderLine {
  name: string;
  qty: number;
  unit_price: number;
  extras: string[];
  salsa: string | null;
}

export interface PricedOrder {
  items: PricedOrderLine[];
  itemsSubtotal: number;
}

interface RecordLike {
  [key: string]: unknown;
  name?: unknown;
  price?: unknown;
  variants?: unknown;
  enabled?: unknown;
  extras?: unknown;
  sauces?: unknown;
  sauceOptions?: unknown;
  category?: unknown;
  promoDays?: unknown;
  label?: unknown;
  qty?: unknown;
  salsa?: unknown;
  unit_price?: unknown;
}

const DEFAULT_SAUCES = [
  "Mayonesa",
  "Mostaza",
  "BBQ",
  "Ketchup",
  "Ninguna de las anteriores",
];

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function money(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000_000) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function buenosAiresWeekday(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

interface CatalogCandidate {
  parent: RecordLike;
  price: number | null;
  enabled: boolean;
}

function findProduct(name: string, catalog: unknown[]): CatalogCandidate {
  const matches: CatalogCandidate[] = [];
  for (const rawProduct of catalog) {
    if (!isRecord(rawProduct)) continue;
    const product = rawProduct;
    const enabled = product.enabled !== false;
    if (product.name === name) {
      matches.push({ parent: product, price: money(product.price), enabled });
    }
    if (!Array.isArray(product.variants)) continue;
    for (const rawVariant of product.variants) {
      if (!isRecord(rawVariant) || rawVariant.name !== name) continue;
      const variantPrice = rawVariant.price;
      matches.push({
        parent: product,
        price:
          variantPrice == null || variantPrice === ""
            ? money(product.price)
            : money(variantPrice),
        enabled,
      });
    }
  }

  // Some products intentionally repeat the parent name for their first variant.
  // Identical candidates are harmless; conflicting catalog records fail closed.
  const unique = new Map<string, CatalogCandidate>();
  for (const candidate of matches) {
    const signature = JSON.stringify({
      parent: candidate.parent,
      price: candidate.price,
      enabled: candidate.enabled,
    });
    unique.set(signature, candidate);
  }
  if (unique.size === 0) {
    throw new OrderPricingError("unknown_product", "El producto ya no está en el menú.");
  }
  const candidates = [...unique.values()];
  if (candidates.some((candidate) => !candidate.enabled)) {
    throw new OrderPricingError("product_unavailable", "El producto no está disponible.");
  }
  const prices = new Set(candidates.map((candidate) => candidate.price));
  if (prices.size !== 1 || candidates[0]?.price == null) {
    throw new OrderPricingError("catalog_unavailable", "No se pudo validar el precio del catálogo.");
  }
  // The menu permits identical duplicate labels only when their pricing/options agree.
  const options = new Set(
    candidates.map((candidate) => JSON.stringify({
      extras: candidate.parent.extras ?? [],
      sauces: candidate.parent.sauces ?? false,
      sauceOptions: candidate.parent.sauceOptions ?? null,
      category: candidate.parent.category ?? null,
      promoDays: candidate.parent.promoDays ?? null,
    })),
  );
  if (options.size !== 1) {
    throw new OrderPricingError("catalog_unavailable", "El catálogo tiene productos ambiguos.");
  }
  return candidates[0]!;
}

export function priceOrderItems(
  rawItems: unknown,
  rawCatalog: unknown,
  now = new Date(),
): PricedOrder {
  if (!Array.isArray(rawCatalog)) {
    throw new OrderPricingError("catalog_unavailable", "El menú no está disponible para validar pedidos.");
  }
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50) {
    throw new OrderPricingError("invalid_order", "El pedido no tiene un formato válido.");
  }

  const items: PricedOrderLine[] = [];
  let subtotalCents = 0;
  for (const rawLine of rawItems) {
    if (!isRecord(rawLine)) {
      throw new OrderPricingError("invalid_order", "El pedido no tiene un formato válido.");
    }
    const name = rawLine.name;
    const qty = rawLine.qty;
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 200) {
      throw new OrderPricingError("invalid_order", "El nombre del producto no es válido.");
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 50) {
      throw new OrderPricingError("invalid_order", "La cantidad del producto no es válida.");
    }
    if (!Array.isArray(rawLine.extras) || rawLine.extras.length > 20) {
      throw new OrderPricingError("invalid_order", "Los adicionales no tienen un formato válido.");
    }
    const extras = rawLine.extras;
    if (extras.some((extra) => typeof extra !== "string" || extra.trim().length < 1 || extra.length > 100)) {
      throw new OrderPricingError("invalid_extra", "Hay un adicional no válido.");
    }
    if (new Set(extras).size !== extras.length) {
      throw new OrderPricingError("invalid_extra", "No se puede repetir el mismo adicional.");
    }

    const candidate = findProduct(name.trim(), rawCatalog);
    const product = candidate.parent;
    const basePrice = candidate.price;
    if (basePrice == null) {
      throw new OrderPricingError("catalog_unavailable", "El producto no tiene un precio publicado.");
    }

    let extrasCents = 0;
    const configuredExtras = Array.isArray(product.extras) ? product.extras : [];
    for (const selectedExtra of extras as string[]) {
      const configured = configuredExtras.find(
        (extra) => isRecord(extra) && extra.label === selectedExtra,
      );
      if (!isRecord(configured)) {
        throw new OrderPricingError("invalid_extra", "Hay un adicional que no pertenece al producto.");
      }
      // The existing menu model treats an omitted extra price as a free option;
      // explicit prices are always taken from the server-side catalog.
      const extraPrice = configured.price == null ? 0 : money(configured.price);
      if (extraPrice == null) {
        throw new OrderPricingError("catalog_unavailable", "El precio de un adicional no es válido.");
      }
      extrasCents += Math.round(extraPrice * 100);
    }

    const rawSalsa = rawLine.salsa;
    const salsa = rawSalsa == null || rawSalsa === "" ? null : rawSalsa;
    if (salsa !== null) {
      if (typeof salsa !== "string" || salsa.length > 100 || product.sauces !== true) {
        throw new OrderPricingError("invalid_sauce", "La salsa seleccionada no es válida para este producto.");
      }
      const configuredSauces = Array.isArray(product.sauceOptions)
        ? product.sauceOptions.filter((value): value is string => typeof value === "string")
        : DEFAULT_SAUCES;
      if (!configuredSauces.includes(salsa)) {
        throw new OrderPricingError("invalid_sauce", "La salsa seleccionada no está disponible.");
      }
    }

    if (product.category === "promos") {
      const promoDays = Array.isArray(product.promoDays) ? product.promoDays : [];
      if (!promoDays.includes(buenosAiresWeekday(now))) {
        throw new OrderPricingError("promo_unavailable", "La promoción no está disponible hoy.");
      }
    }

    const unitPrice = Math.round(basePrice * 100 + extrasCents) / 100;
    if (unitPrice > 100_000_000) {
      throw new OrderPricingError("catalog_unavailable", "El precio del pedido supera el límite permitido.");
    }
    const clientPrice = money(rawLine.unit_price);
    if (clientPrice == null || Math.abs(clientPrice - unitPrice) > 0.001) {
      throw new OrderPricingError("price_changed", "El precio cambió. Revisá el carrito y confirmá nuevamente.");
    }

    subtotalCents += Math.round(unitPrice * 100) * qty;
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 100_000_000_000) {
      throw new OrderPricingError("invalid_order", "El importe total del pedido supera el límite permitido.");
    }
    items.push({
      name: name.trim(),
      qty,
      unit_price: unitPrice,
      extras: [...(extras as string[])],
      salsa: salsa as string | null,
    });
  }

  return { items, itemsSubtotal: subtotalCents / 100 };
}
