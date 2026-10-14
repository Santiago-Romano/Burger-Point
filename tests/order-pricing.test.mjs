import test from "node:test";
import assert from "node:assert/strict";
import { priceOrderItems, OrderPricingError } from "../src/lib/order-pricing.ts";

const menu = [
  {
    name: "Burger de prueba",
    price: 1000,
    enabled: true,
    category: "burgers",
    extras: [{ label: "Queso", price: 250 }, { label: "Verdeo" }],
    sauces: true,
    sauceOptions: ["BBQ", "Ketchup"],
    variants: [{ name: "Burger de prueba Doble", price: 1500 }],
  },
  {
    name: "Promo de prueba",
    price: 700,
    category: "promos",
    promoDays: [1],
  },
  { name: "Producto oculto", price: 500, enabled: false },
];

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error instanceof OrderPricingError && error.code === code);
}

test("recalcula el precio desde catálogo y suma extras configurados", () => {
  const result = priceOrderItems(
    [{ name: "Burger de prueba", qty: 2, unit_price: 1250, extras: ["Queso", "Verdeo"], salsa: "BBQ", injected: true }],
    menu,
    new Date("2026-10-12T15:00:00Z"),
  );
  assert.deepEqual(result.items, [{
    name: "Burger de prueba",
    qty: 2,
    unit_price: 1250,
    extras: ["Queso", "Verdeo"],
    salsa: "BBQ",
  }]);
  assert.equal(result.itemsSubtotal, 2500);
});

test("acepta variantes y rechaza que el cliente fuerce un precio menor", () => {
  const priced = priceOrderItems(
    [{ name: "Burger de prueba Doble", qty: 1, unit_price: 1500, extras: [], salsa: null }],
    menu,
    new Date("2026-10-12T15:00:00Z"),
  );
  assert.equal(priced.items[0].unit_price, 1500);
  throwsCode(() => priceOrderItems(
    [{ name: "Burger de prueba Doble", qty: 1, unit_price: 1, extras: [], salsa: null }],
    menu,
    new Date("2026-10-12T15:00:00Z"),
  ), "price_changed");
});

test("rechaza producto desconocido, deshabilitado y extra no configurado", () => {
  throwsCode(() => priceOrderItems(
    [{ name: "Inventado", qty: 1, unit_price: 1, extras: [], salsa: null }], menu,
  ), "unknown_product");
  throwsCode(() => priceOrderItems(
    [{ name: "Producto oculto", qty: 1, unit_price: 500, extras: [], salsa: null }], menu,
  ), "product_unavailable");
  throwsCode(() => priceOrderItems(
    [{ name: "Burger de prueba", qty: 1, unit_price: 1000, extras: ["Extra inventado"], salsa: null }], menu,
  ), "invalid_extra");
});

test("rechaza salsa no permitida, cantidades inválidas y catálogo ausente", () => {
  throwsCode(() => priceOrderItems(
    [{ name: "Burger de prueba", qty: 1, unit_price: 1000, extras: [], salsa: "Mayonesa" }], menu,
  ), "invalid_sauce");
  throwsCode(() => priceOrderItems(
    [{ name: "Burger de prueba", qty: 1.5, unit_price: 1000, extras: [], salsa: null }], menu,
  ), "invalid_order");
  throwsCode(() => priceOrderItems(
    [{ name: "Burger de prueba", qty: 1, unit_price: 1000, extras: [], salsa: null }], undefined,
  ), "catalog_unavailable");
});

test("valida las promociones con el día de Buenos Aires", () => {
  // 2026-10-12 is Monday in Buenos Aires.
  const valid = priceOrderItems(
    [{ name: "Promo de prueba", qty: 1, unit_price: 700, extras: [], salsa: null }],
    menu,
    new Date("2026-10-12T15:00:00Z"),
  );
  assert.equal(valid.itemsSubtotal, 700);
  throwsCode(() => priceOrderItems(
    [{ name: "Promo de prueba", qty: 1, unit_price: 700, extras: [], salsa: null }],
    menu,
    new Date("2026-10-13T15:00:00Z"),
  ), "promo_unavailable");
});
