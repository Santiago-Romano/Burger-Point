import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import nosotrosImg from "@/assets/nosotros-grill.jpg";
import burgerPointLogo from "../../Logo Burger-Point.jpeg";
import {
  DEFAULT_MENU,
  DEFAULT_SAUCES,
  mergeDefaultPromos,
  type MenuItem as SharedMenuItem,
} from "@/lib/menu-data";
import { supabase } from "@/integrations/supabase/client";
import { CartProvider, useCart } from "@/lib/cart";
import { CartDrawer } from "@/components/CartDrawer";
import { Toaster } from "@/components/ui/sonner";
import {
  getBuenosAiresWeekday,
  isPromoAvailableToday,
  PROMO_WEEKDAYS,
} from "@/lib/promo-schedule";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Burger Point — Smash Burgers en Ituzaingó" },
      {
        name: "description",
        content:
          "Smash burgers a la plancha en Ituzaingó. Delivery en Ituzaingó, Castelar, Padua, Udaondo y Villa Tesei. Pedí por WhatsApp.",
      },
      { property: "og:title", content: "Burger Point — Smash Burgers en Ituzaingó" },
      {
        property: "og:description",
        content:
          "Smash burgers a la plancha, pan brioche tostado y queso que se estira. Pedí por WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const WHATSAPP = "5491162118588";
const waLink = (text: string) =>
  `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const menuImages = import.meta.glob("/src/assets/menu/*.{png,jpg,jpeg}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const img = (file: string) =>
  file.startsWith("http") || file.startsWith("/")
    ? file
    : menuImages[`/src/assets/menu/${file}`] ?? "";

type Category = "burgers" | "veggies" | "acompanamientos" | "bebidas" | "promos";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "burgers", label: "Burgers + Fritas" },
  { id: "veggies", label: "Veggies" },
  { id: "acompanamientos", label: "Acompañamientos" },
  { id: "bebidas", label: "Bebidas" },
];

interface MenuVariant {
  label: string; // "Simple" | "Doble" | "Triple"
  name: string; // nombre completo para el pedido
  desc: string;
  image: string;
  price?: number;
}

interface MenuExtra {
  label: string;
  price?: number;
}

interface MenuItem extends Omit<SharedMenuItem, "category"> {
  name: string;
  desc: string;
  image: string;
  tag?: string;
  tagHot?: boolean;
  category: Category;
  variants?: MenuVariant[];
  extras?: MenuExtra[];
  sauces?: boolean;
  price?: number;
  enabled?: boolean;
  promoDays?: number[];
  sauceOptions?: string[];
}

const BURGER_ADICIONALES: MenuExtra[] = [
  { label: "Coca / Coca Zero / Sprite 600cc", price: 3500 },
  { label: "Carne con Cheddar", price: 3000 },
  { label: "Doble Carne con Cheddar", price: 5000 },
  { label: "Panceta", price: 1800 },
  { label: "Feta de Cheddar", price: 1500 },
  { label: "Huevo", price: 1500 },
  { label: "Cebolla Caramelizada", price: 1500 },
  { label: "Pepinos Agridulces", price: 1500 },
  { label: "Cebolla Morada", price: 1500 },
  { label: "Lechuga", price: 1000 },
  { label: "Tomate", price: 1000 },
];

const FRITAS_ADICIONALES: MenuExtra[] = [
  { label: "Dip de Cheddar Líquido", price: 3000 },
  { label: "Dip de BBQ", price: 2000 },
  { label: "Dip de Ketchup", price: 2000 },
];

const SALSAS = DEFAULT_SAUCES;

const LEGACY_MENU: MenuItem[] = [
  // Burgers + Fritas
  { name: "Burger Point", desc: "La de la casa. Smash sellada, cheddar y salsa Point, con fritas.", image: "burguers-fritas-burger-point.png", tag: "La de la casa", tagHot: true, category: "burgers" },
  {
    name: "Cheese Burger",
    desc: "La clásica: cheddar fundido y fritas crocantes. Elegí cuánta carne.",
    image: "burguers-fritas-simples-chesse-burger-simple.png",
    tag: "Best seller",
    tagHot: true,
    category: "burgers",
    variants: [
      { label: "Simple", name: "Cheese Burger Simple", desc: "Clásica con cheddar fundido y fritas crocantes.", image: "burguers-fritas-simples-chesse-burger-simple.png" },
      { label: "Doble", name: "Cheese Burger Doble", desc: "Doble carne, doble cheddar. Para hambre de verdad.", image: "burguers-fritas-dobles-chesse-burger-doble.png" },
      { label: "Triple", name: "Cheese Burger Triple", desc: "Tres patties selladas, triple cheddar y fritas.", image: "burguers-fritas-triples-chesse-burger-triple.png" },
    ],
  },
  {
    name: "Implosive Burger",
    desc: "La que explota de sabor: cheddar, panceta y salsa de la casa.",
    image: "burguers-fritas-simples-implosive-burger.png",
    tag: "Best seller",
    tagHot: true,
    category: "burgers",
    variants: [
      { label: "Simple", name: "Implosive Burger", desc: "La que explota de sabor: cheddar, panceta y salsa de la casa.", image: "burguers-fritas-simples-implosive-burger.png" },
      { label: "Doble", name: "Implosive Burger Doble", desc: "Doble implosión: dos carnes, panceta crocante y cheddar.", image: "burguers-fritas-dobles-implosive-burger-doble.png" },
      { label: "Triple", name: "Implosive Burger Triple", desc: "Triple carne, triple locura. No apta para indecisos.", image: "burguers-fritas-triples-implosive-burger-triple.png" },
    ],
  },
  {
    name: "Oklahoma",
    desc: "Cebolla aplastada en la plancha, estilo Oklahoma original.",
    image: "burguers-fritas-simples-oklahoma-simple.png",
    category: "burgers",
    variants: [
      { label: "Simple", name: "Oklahoma Simple", desc: "Cebolla aplastada en la plancha, estilo Oklahoma original.", image: "burguers-fritas-simples-oklahoma-simple.png" },
      { label: "Doble", name: "Oklahoma Doble", desc: "Doble carne con cebolla caramelizada en la plancha.", image: "burguers-fritas-dobles-oklahoma-doble.png" },
      { label: "Triple", name: "Oklahoma Triple", desc: "Tres patties con cebolla fundida y cheddar.", image: "burguers-fritas-triples-oklahoma-triple.png" },
    ],
  },
  {
    name: "Grand Tasty Point",
    desc: "Nuestra versión de la tasty: salsa especial, cheddar y fritas.",
    image: "burguers-fritas-simples-grand-tasty-point-simple.png",
    category: "burgers",
    variants: [
      { label: "Simple", name: "Grand Tasty Point Simple", desc: "Nuestra versión de la tasty: salsa especial, cheddar y fritas.", image: "burguers-fritas-simples-grand-tasty-point-simple.png" },
      { label: "Doble", name: "Grand Tasty Point Doble", desc: "Doble tasty con salsa de la casa y queso fundido.", image: "burguers-fritas-dobles-grand-tasty-point-doble.png" },
      { label: "Triple", name: "Grand Tasty Point Triple", desc: "La tasty más grande que vas a ver. Triple carne.", image: "burguers-fritas-triples-grand-tasty-point-triple.png" },
    ],
  },
  {
    name: "Bomb Tasty",
    desc: "Bomba de sabor con salsa tasty. Solo viene grande.",
    image: "burguers-fritas-dobles-bomb-tasty-doble.png",
    category: "burgers",
    variants: [
      { label: "Doble", name: "Bomb Tasty Doble", desc: "Bomba de sabor: doble carne, doble queso, salsa tasty.", image: "burguers-fritas-dobles-bomb-tasty-doble.png" },
      { label: "Triple", name: "Bomb Tasty Triple", desc: "La bomba definitiva. Triple carne y queso hasta el borde.", image: "burguers-fritas-triples-bomb-tasty-triple.png" },
    ],
  },
  { name: "Onion Point Doble", desc: "Doble carne con aros de cebolla crocantes y BBQ.", image: "burguers-fritas-dobles-onion-point-doble.png", category: "burgers" },
  { name: "Ten Point", desc: "La triple insignia. Diez puntos, sin discusión.", image: "burguers-fritas-triples-ten-point.png", tag: "Insignia", tagHot: true, category: "burgers" },
  { name: "Burger Angus", desc: "Carne angus premium, sellada a la plancha.", image: "burguers-fritas-burger-angus.png", category: "burgers" },
  { name: "Burger House", desc: "La receta de la casa, como la hacemos desde el día uno.", image: "burguers-fritas-burger-house.png", category: "burgers" },
  { name: "Burguer Kid", desc: "Para los más chicos: simple, rica y con fritas.", image: "burguers-fritas-burguer-kid.png", category: "burgers" },
  { name: "Cajita Feliz Simple", desc: "Burger simple + fritas en cajita. Felicidad garantizada.", image: "burguers-fritas-simples-cajita-feliz-simple.png", category: "burgers" },
  // Veggies
  {
    name: "Not Libra",
    desc: "Veggie que no parece veggie. Con fritas.",
    image: "burguers-veggies-fritas-simples-not-libra-simple.png",
    tag: "Veggie",
    category: "veggies",
    variants: [
      { label: "Simple", name: "Not Libra Simple", desc: "Veggie que no parece veggie. Con fritas.", image: "burguers-veggies-fritas-simples-not-libra-simple.png" },
      { label: "Doble", name: "Not Libra Doble", desc: "Doble porción veggie, doble sabor. Con fritas.", image: "burguers-veggies-fritas-dobles-not-libra-doble.png" },
    ],
  },
  { name: "Not Chicken", desc: "Crujiente, dorada y 100% vegetal. Con fritas.", image: "burguers-veggies-fritas-not-chicken.png", tag: "Veggie", category: "veggies" },
  { name: "Burgaña de Lentejas y Especias", desc: "Medallón casero de lentejas con especias. Con fritas.", image: "burguers-veggies-fritas-burgana-de-lentejas-y-especias.png", tag: "Veggie", category: "veggies" },
  // Acompañamientos
  { name: "Aros de Cebolla x10", desc: "Crocantes, con ketchup.", image: "acompaamientos-aros-de-cebolla-10-unidades-ketchup.png", category: "acompanamientos" },
  { name: "Bastones de Muzzarella x6", desc: "Queso que se estira, con ketchup.", image: "acompaamientos-bastones-de-muzzarela-6-unidades-ketchup.png", category: "acompanamientos" },
  { name: "Nuggets x10", desc: "Dorados y crocantes, con BBQ.", image: "acompaamientos-nuggets-10-unidades-bbq.png", category: "acompanamientos" },
  {
    name: "Papas Cerveceras",
    desc: "Con piel, bien condimentadas. Elegí el tamaño.",
    image: "acompaamientos-papas-fritas-papas-cerveceras-chicas.png",
    category: "acompanamientos",
    extras: FRITAS_ADICIONALES,
    variants: [
      { label: "Chicas", name: "Papas Cerveceras Chicas", desc: "Con piel, bien condimentadas. Ideales para acompañar.", image: "acompaamientos-papas-fritas-papas-cerveceras-chicas.png" },
      { label: "Grandes", name: "Papas Cerveceras Grandes", desc: "Para compartir (o no). Las más pedidas.", image: "acompaamientos-papas-fritas-papas-cerveceras-grandes.png" },
    ],
  },
  {
    name: "Porción de Fritas",
    desc: "Las clásicas, doradas. Elegí el tamaño.",
    image: "acompaamientos-papas-fritas-porcion-de-fritas-chicas.png",
    category: "acompanamientos",
    extras: FRITAS_ADICIONALES,
    variants: [
      { label: "Chica", name: "Porción de Fritas Chica", desc: "Las clásicas, doradas y crocantes.", image: "acompaamientos-papas-fritas-porcion-de-fritas-chicas.png" },
      { label: "Grande", name: "Porción de Fritas Grande", desc: "La porción que alcanza para todos.", image: "acompaamientos-papas-fritas-procion-de-fritas-grande.png" },
    ],
  },
  { name: "Picada Caliente", desc: "Un poco de todo, bien caliente.", image: "acompaamientos-picada-caliente.png", tag: "Para compartir", category: "acompanamientos" },
  { name: "Picada Nuggets", desc: "Nuggets y fritas para picar.", image: "acompaamientos-picada-nuggets.png", category: "acompanamientos" },
  {
    name: "Tostato",
    desc: "Tostado con pan de papa, doble cheddar y mostaza.",
    image: "acompaamientos-tostato.png",
    category: "acompanamientos",
    variants: [
      { label: "Cheddar", name: "Tostado C/ Cheddar", desc: "Pan de papa, doble cheddar y mostaza.", image: "acompaamientos-tostato.png" },
      { label: "Cheddar y Huevo", name: "Tostado C/ Cheddar y Huevo", desc: "Pan de papa, doble cheddar, mostaza y huevo.", image: "acompaamientos-tostato.png" },
      { label: "Cheddar y Panceta", name: "Tostado C/ Cheddar y Panceta", desc: "Pan de papa, doble cheddar, mostaza y panceta.", image: "acompaamientos-tostato.png" },
      { label: "Cheddar, Panceta y Huevo", name: "Tostado C/ Cheddar, Panceta y Huevo", desc: "Pan de papa, doble cheddar, mostaza, panceta y huevo.", image: "acompaamientos-tostato.png" },
    ],
  },
  { name: "Dip de Cheddar", desc: "Para mojar todo.", image: "acompaamientos-dips-dip-de-cheddar.png", category: "acompanamientos" },
  { name: "Dip de BBQ", desc: "Ahumado y dulzón.", image: "acompaamientos-dips-dip-de-bbq.png", category: "acompanamientos" },
  { name: "Dip de Ketchup", desc: "El clásico para acompañar.", image: "acompaamientos-dips-dip-de-ketchup.png", category: "acompanamientos" },
  { name: "Dip de Mayonesa", desc: "Suave y cremosa.", image: "acompaamientos-dips-dip-de-mayonesa.png", category: "acompanamientos" },
  // Bebidas
  { name: "Coca Cola 1.75L", desc: "La grande, bien fría.", image: "bebidas-coca-cola-1-75l.png", category: "bebidas" },
  { name: "Coca Cola 600ml", desc: "La compañera de siempre.", image: "bebidas-coca-cola-600ml.png", category: "bebidas" },
  { name: "Coca Cola Zero 600ml", desc: "Sin azúcar, mismo gusto.", image: "bebidas-coca-cola-zero-600ml.png", category: "bebidas" },
  { name: "Sprite 600ml", desc: "Lima-limón bien helada.", image: "bebidas-sprite-600ml.png", category: "bebidas" },
  { name: "Andes Rubia", desc: "Cerveza rubia, la compañera ideal.", image: "bebidas-andes-rubia.png", tag: "+18", category: "bebidas" },
  // Promos
  { name: "Promo Sábado Cheeseburger Doble", desc: "Cheeseburger doble con cheddar. $14.500 c/u. Delivery: mínimo 2 unidades.", image: "promo-sabado.png", tag: "Sábados · $14.500 c/u", tagHot: true, price: 14500, promoDays: [6], category: "promos" },
  { name: "Promo Domingo Gran Tasty Doble", desc: "Gran Tasty doble con papas fritas. $14.999 c/u. Delivery: mínimo 2 unidades.", image: "promo-domingo.png", tag: "Domingos · $14.999 c/u", tagHot: true, price: 14999, promoDays: [0], category: "promos" },
];

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.03a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.12.82.83-3.04-.2-.31a8.08 8.08 0 0 1-1.24-4.28c0-4.47 3.64-8.11 8.12-8.11a8.1 8.1 0 0 1 8.11 8.11c0 4.48-3.64 8.12-8.07 8.12zm4.45-6.08c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.53.06-.24-.12-1.03-.38-1.96-1.21-.72-.64-1.21-1.44-1.35-1.68-.14-.24-.02-.38.11-.5.11-.11.24-.28.37-.42.12-.14.16-.24.24-.4.08-.16.04-.31-.02-.43-.06-.12-.55-1.32-.75-1.81-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.43.06-.65.31-.22.24-.86.84-.86 2.05 0 1.21.88 2.37 1 2.53.12.16 1.72 2.63 4.18 3.69.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.05.14-1.16-.06-.1-.22-.16-.46-.28z" />
    </svg>
  );
}

function MenuCard({ item }: { item: MenuItem }) {
  const [variantIdx, setVariantIdx] = useState(0);
  const [extrasSel, setExtrasSel] = useState<string[]>([]);
  const [salsa, setSalsa] = useState("");
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const variant = item.variants?.[variantIdx];
  const displayName = variant?.name ?? item.name;
  const displayDesc = variant?.desc ?? item.desc;
  const displayImage = variant?.image ?? item.image;
  const displayPrice = variant?.price ?? item.price;
  const canCustomize = Boolean(item.extras || item.sauces);

  useEffect(() => {
    if (!customizerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCustomizerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [customizerOpen]);

  const toggleExtra = (label: string) =>
    setExtrasSel((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  const orderLines = [`Hola Burger Point, quiero pedir: ${displayName}`];
  if (displayPrice != null) {
    orderLines.push(`Precio: $ ${displayPrice.toLocaleString("es-AR")} c/u`);
  }
  if (extrasSel.length > 0) orderLines.push(`Adicionales: ${extrasSel.join(" + ")}`);
  if (salsa) orderLines.push(`Salsas: ${salsa}`);
  const waHref = waLink(orderLines.join("\n"));
  const cart = useCart();
  const addToCart = () => {
    cart.add({
      name: displayName,
      extras: extrasSel,
      salsa: salsa || undefined,
      unitPrice: displayPrice,
      isPromo: item.category === "promos",
      promoDays: item.category === "promos" ? item.promoDays : undefined,
    });
    setCustomizerOpen(false);
    setExtrasSel([]);
    setSalsa("");
    toast.success(`${displayName} agregado al pedido`, {
      action: { label: "Ver pedido", onClick: () => cart.setOpen(true) },
    });
  };

  return (
    <article
      className={`group cursor-pointer rounded-2xl bg-ink-2 ring-1 ring-white/10 ${
        customizerOpen
          ? "overflow-visible"
          : "overflow-hidden transition-transform duration-300 hover:-translate-y-1.5"
      }`}
      onClick={() => setCustomizerOpen(true)}
    >
      <div className="relative">
        <img
          src={img(displayImage)}
          alt={displayName}
          loading="lazy"
          className={`block aspect-[4/3] w-full max-w-full bg-ink-3 ${item.category === "promos" ? "object-contain" : "object-cover"}`}
        />
        {item.tag && (
          <span
            className={`absolute left-3 top-3 rounded-full bg-ink/80 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
              item.tagHot ? "text-ember" : "text-cream-dim"
            }`}
          >
            {item.tag}
          </span>
        )}
        {variant && (
          <span className="absolute right-3 top-3 rounded-full bg-ember px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-ink">
            {variant.label}
          </span>
        )}
      </div>
      <div className="p-5">
        <h3 className="font-display text-2xl leading-none tracking-tight">
          {item.name}
        </h3>
        {item.variants && (
          <div className="mt-3 flex gap-1.5 rounded-full bg-ink p-1 ring-1 ring-white/10">
            {item.variants.map((v, i) => (
              <button
                key={v.label}
                onClick={(event) => {
                  event.stopPropagation();
                  setVariantIdx(i);
                }}
                className={
                  i === variantIdx
                    ? "flex-1 rounded-full bg-ember px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink"
                    : "flex-1 rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim transition-colors hover:text-cream"
                }
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-sm text-pretty text-cream-dim">{displayDesc}</p>
        {displayPrice != null && <p className="mt-3 font-mono text-lg font-semibold text-ember">$ {displayPrice.toLocaleString("es-AR")}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setCustomizerOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-full bg-ember px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-ember-soft"
          >
            <span aria-hidden>{canCustomize ? "＋" : "↗"}</span>
            {canCustomize ? "Personalizar" : "Ver producto"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              addToCart();
            }}
            className="inline-flex items-center gap-2 rounded-full bg-ember px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-ember-soft"
          >
            <span aria-hidden>＋</span>
            Agregar al pedido
          </button>
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-2 rounded-full bg-ember/10 px-4 py-2 text-sm font-semibold text-ember transition-colors hover:bg-ember hover:text-ink"
          >
            <WhatsAppIcon className="size-4" />
            Pedir por WhatsApp
          </a>
        </div>
      </div>

      {customizerOpen && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-ink/85 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={(event) => {
            event.stopPropagation();
            setCustomizerOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`customizer-${item.name.replaceAll(" ", "-")}`}
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-ink-2 p-5 shadow-2xl ring-1 ring-white/15 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember">
                  {canCustomize ? "Personalizá tu pedido" : "Detalle del producto"}
                </p>
                <h3 id={`customizer-${item.name.replaceAll(" ", "-")}`} className="mt-1 font-display text-3xl leading-none">
                  {displayName}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setCustomizerOpen(false)}
                className="grid size-10 shrink-0 place-items-center rounded-full text-2xl text-cream-dim ring-1 ring-white/15 transition-colors hover:bg-ink hover:text-cream"
              >
                ×
              </button>
            </div>

            <img
              src={img(displayImage)}
              alt={displayName}
              className={`mx-auto block max-w-full rounded-xl bg-ink-3 ring-1 ring-white/10 ${
                item.category === "promos"
                  ? "max-h-[55vh] object-contain"
                  : "aspect-[4/3] w-full object-cover"
              }`}
            />

            <p className="mt-4 text-sm text-pretty text-cream-dim">{displayDesc}</p>
            {displayPrice != null && <p className="mt-3 font-mono text-xl font-semibold text-ember">$ {displayPrice.toLocaleString("es-AR")}</p>}

            {item.extras && (
              <div className="pt-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream-dim">
                  {item.category === "acompanamientos" ? "Dips" : "Adicionales"}
                </p>
                <ul className="mt-2 space-y-1">
                  {item.extras.map((extra) => {
                    const checked = extrasSel.includes(extra.label);
                    return (
                      <li key={extra.label}>
                        <label
                          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                            checked ? "bg-ember/10 text-cream ring-1 ring-ember/30" : "bg-ink hover:bg-ink-3"
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleExtra(extra.label)}
                              className="size-4 accent-ember"
                            />
                            {extra.label}
                          </span>
                          {extra.price != null && (
                            <span className="shrink-0 font-mono text-xs text-cream-dim">
                              $ {extra.price}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {item.sauces && (
              <div className="pt-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream-dim">
                  Salsas (elegí una)
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SALSAS.map((sauce) => (
                    <button
                      key={sauce}
                      type="button"
                      onClick={() => setSalsa(salsa === sauce ? "" : sauce)}
                      className={
                        salsa === sauce
                          ? "rounded-full bg-ember px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink"
                          : "rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim ring-1 ring-white/15 transition-colors hover:text-cream"
                      }
                    >
                      {sauce}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={addToCart}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-ember px-5 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-ember-soft"
            >
              ＋ Agregar al pedido
            </button>
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-ember/10 px-5 py-3 text-sm font-semibold text-ember transition-colors hover:bg-ember hover:text-ink"
            >
              <WhatsAppIcon className="size-5" />
              Pedir solo esto por WhatsApp
            </a>
          </div>
        </div>
      )}
    </article>
  );
}

function Index() {
  return (
    <CartProvider>
      <IndexInner />
      <CartDrawer />
      <Toaster position="top-center" />
    </CartProvider>
  );
}

function CartButton() {
  const { count, setOpen } = useCart();
  return (
    <button
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-2 rounded-full border border-ember/50 px-5 py-3 text-sm font-semibold text-ember transition-colors hover:bg-ember hover:text-ink"
    >
      Mi pedido
      <span className="grid min-w-6 place-items-center rounded-full bg-ember px-1.5 text-xs text-ink">{count}</span>
    </button>
  );
}

function DailyPromoHero({
  promos,
  day,
  onAdd,
}: {
  promos: MenuItem[];
  day: number;
  onAdd: (item: MenuItem) => void;
}) {
  const todayLabel = PROMO_WEEKDAYS[day] ?? "hoy";
  const featuredPromo = promos[0]!;

  return (
    <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 pt-10 pb-10 sm:px-8 lg:grid-cols-12">
      <div className="lg:col-span-6">
        <div className="animate-rise mb-6 flex items-center gap-3">
          <span className="h-px w-8 bg-ember" />
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">
            Ituzaingó · Buenos Aires
          </span>
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ember">
          Disponible solo hoy · {todayLabel}
        </p>
        <h1 className="animate-rise mt-3 font-display text-[clamp(3.5rem,9vw,7rem)] leading-[0.82] tracking-tight">
          HOY
          <br />
          <span className="animate-flicker text-ember">HAY PROMO</span>
        </h1>
        <div className="mt-7 space-y-3">
          {promos.map((promo) => (
            <article key={promo.name} className="rounded-2xl bg-ink-2/90 p-4 ring-1 ring-ember/35 sm:p-5">
              <h2 className="font-display text-2xl leading-tight sm:text-3xl">
                {promo.name.replace(/^Promo\s+/i, "")}
              </h2>
              <p className="mt-2 text-sm text-pretty text-cream-dim">{promo.desc}</p>
              {promo.price != null && (
                <p className="mt-2 font-mono text-xl font-semibold text-ember">
                  $ {promo.price.toLocaleString("es-AR")} c/u
                </p>
              )}
              <button
                type="button"
                onClick={() => onAdd(promo)}
                className="mt-4 rounded-full bg-ember px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-ember-soft"
              >
                Agregar promo al pedido
              </button>
            </article>
          ))}
        </div>
        <a
          href="#menu"
          className="mt-5 inline-flex items-center rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-cream transition-colors hover:border-ember/60 hover:text-ember"
        >
          Ver el menú completo
        </a>
      </div>

      <div className="animate-rise relative lg:col-span-6 [animation-delay:120ms]">
        <div className="absolute -inset-3 rounded-[28px] bg-ember/25 blur-2xl" />
        <div className="relative overflow-hidden rounded-[28px] bg-black ring-1 ring-white/10">
          <img
            src={img(featuredPromo.image)}
            alt={featuredPromo.name}
            className="block h-auto max-h-[70vh] w-full max-w-full bg-black object-contain"
          />
        </div>
      </div>
    </div>
  );
}

function IndexInner() {
  const [category, setCategory] = useState<Category>("burgers");
  const [menu, setMenu] = useState<MenuItem[]>(DEFAULT_MENU.length ? DEFAULT_MENU as MenuItem[] : LEGACY_MENU);
  const [promoDay, setPromoDay] = useState(getBuenosAiresWeekday);
  const cart = useCart();

  useEffect(() => {
    let active = true;
    supabase
      .from("menu_content")
      .select("items")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (active && Array.isArray(data?.items)) {
          setMenu(mergeDefaultPromos(data.items as unknown as MenuItem[]));
        }
      });

    const channel = supabase
      .channel("public-menu")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_content" }, (payload) => {
        const updatedItems = (payload.new as { items?: unknown }).items;
        if (Array.isArray(updatedItems)) setMenu(mergeDefaultPromos(updatedItems as MenuItem[]));
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setPromoDay(getBuenosAiresWeekday()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = menu.filter((item) => item.category === category && item.enabled !== false);
  const todaysPromos = menu.filter(
    (item) =>
      item.category === "promos" &&
      item.enabled !== false &&
      isPromoAvailableToday(item.promoDays, promoDay),
  );
  const addPromoToCart = (item: MenuItem) => {
    if (!isPromoAvailableToday(item.promoDays)) {
      setPromoDay(getBuenosAiresWeekday());
      toast.error("Esta promo solo se puede pedir el día indicado.");
      return;
    }

    cart.add({
      name: item.name,
      extras: [],
      unitPrice: item.price,
      isPromo: true,
      promoDays: item.promoDays,
    });
    toast.success(`${item.name} agregada al pedido`, {
      action: { label: "Ver pedido", onClick: () => cart.setOpen(true) },
    });
  };

  return (
    <div className="min-h-screen bg-ink font-body text-cream antialiased">
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#" aria-label="Burger Point - inicio" className="flex shrink-0 items-center">
            <img
              src={burgerPointLogo}
              alt="Burger Point"
              className="size-14 max-w-full object-contain mix-blend-lighten sm:size-16"
            />
          </a>
          <nav className="hidden items-center gap-8 text-sm text-cream-dim md:flex">
            <a href="#menu" className="transition-colors hover:text-cream">Menú</a>
            <a href="#nosotros" className="transition-colors hover:text-cream">Nosotros</a>
            <a href="#delivery" className="transition-colors hover:text-cream">Delivery</a>
            <a href="#pagos" className="transition-colors hover:text-cream">Pagos</a>
          </nav>
          <a
            href={waLink("Hola Burger Point, quiero hacer un pedido")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-ember px-4 py-2 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
          >
            <WhatsAppIcon className="size-4" /> Pedir por WhatsApp
          </a>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 right-[-10%] h-[520px] w-[520px] rounded-full bg-ember/20 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-[-10%] h-[360px] w-[360px] rounded-full bg-ember-soft/10 blur-[100px]" />

        {todaysPromos.length > 0 ? (
          <DailyPromoHero promos={todaysPromos} day={promoDay} onAdd={addPromoToCart} />
        ) : (
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 pt-14 pb-10 sm:px-8 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <div className="animate-rise mb-6 flex items-center gap-3">
              <span className="h-px w-8 bg-ember" />
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-cream-dim">
                Ituzaingó · Buenos Aires
              </span>
            </div>
            <h1 className="animate-rise font-display text-[clamp(3.5rem,11vw,9rem)] leading-[0.82] tracking-tight [animation-delay:80ms]">
              LA PARRILLA
              <br />
              <span className="animate-flicker text-ember">NO&nbsp;DUERME</span>
            </h1>
            <p className="animate-rise mt-7 max-w-[46ch] text-lg text-pretty text-cream-dim [animation-delay:160ms]">
              Más de 7 años haciendo smash burgers a la plancha: pan tostado,
              queso que se estira y ese char que no se negocia. Pedí por
              WhatsApp y te la llevamos caliente a tu casa.
            </p>
            <div className="animate-rise mt-9 flex flex-wrap items-center gap-4 [animation-delay:240ms]">
              <a
                href={waLink("Hola Burger Point, quiero hacer un pedido")}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-3 rounded-full bg-ember px-7 py-4 text-base font-semibold text-ink transition-transform hover:-translate-y-0.5"
              >
                <WhatsAppIcon className="size-5" />
                Pedí por WhatsApp
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </a>
              <a
                href="#menu"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-base font-medium text-cream transition-colors hover:border-ember/60 hover:text-ember"
              >
                Ver el menú
              </a>
            </div>
            <div className="animate-rise mt-10 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim [animation-delay:320ms]">
              <span>+7 años de fuego</span>
              <span>5 zonas de delivery</span>
              <span>Smash a la plancha</span>
            </div>
          </div>

          <div className="animate-rise relative lg:col-span-6 [animation-delay:120ms]">
            <div className="relative">
              <div className="absolute -inset-3 rounded-[28px] bg-ember/25 blur-2xl" />
              <div className="relative overflow-hidden rounded-[28px] ring-1 ring-white/10">
                <img
                  src={img("burguers-fritas-burger-point.png")}
                  alt="Burger Point, la hamburguesa de la casa"
                  className="block aspect-[4/5] w-full max-w-full object-cover"
                />
              </div>
              {/* steam */}
              <div className="pointer-events-none absolute left-1/2 top-6 flex -translate-x-1/2 gap-3">
                <span className="animate-steam block h-16 w-1.5 rounded-full bg-cream/30 blur-md" />
                <span className="animate-steam block h-20 w-1.5 rounded-full bg-cream/25 blur-md [animation-delay:.6s]" />
                <span className="animate-steam block h-14 w-1.5 rounded-full bg-cream/30 blur-md [animation-delay:1.1s]" />
              </div>
              <div className="absolute -left-4 bottom-8 rotate-[-6deg] rounded-lg bg-ember px-4 py-3 text-ink shadow-lg">
                <p className="font-display text-2xl leading-none">BURGER POINT</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em]">
                  La de la casa · con fritas
                </p>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* marquee */}
        <div className="overflow-hidden border-y border-white/10 py-3">
          <div className="animate-marquee flex whitespace-nowrap font-display text-2xl tracking-wide text-cream/25">
            {[0, 1].map((n) => (
              <span key={n} className="flex">
                <span className="px-6">SMASH BURGERS</span>
                <span className="text-ember">◆</span>
                <span className="px-6">FRITAS CRUJIENTES</span>
                <span className="text-ember">◆</span>
                <span className="px-6">PROMOS SOLO EN SU DIA</span>
                <span className="text-ember">◆</span>
                <span className="px-6">DELIVERY EN ITUZAINGÓ</span>
                <span className="text-ember">◆</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* MENU */}
      <section id="menu" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20 sm:px-8">
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ember">
              (a) El menú
            </span>
            <h2 className="mt-3 font-display text-5xl tracking-tight text-balance sm:text-6xl">
              Elegí tu arma
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={
                  category === c.id
                    ? "rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-ink"
                    : "rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-cream-dim transition-colors hover:border-ember/50 hover:text-cream"
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <MenuCard key={item.name} item={item} />
          ))}
        </div>
      </section>

      {/* NOSOTROS */}
      <section id="nosotros" className="scroll-mt-20 border-y border-white/10 bg-ink-2/40">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <img
              src={nosotrosImg}
              alt="Smash burger sellándose en la plancha"
              loading="lazy"
              width={1024}
              height={1280}
              className="block aspect-[4/5] w-full max-w-full rounded-2xl object-cover outline-1 -outline-offset-1 outline-white/5"
            />
          </div>
          <div className="lg:col-span-7">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ember">
              (b) Nosotros
            </span>
            <h2 className="mt-3 font-display text-5xl tracking-tight text-balance sm:text-6xl">
              Nacimos en la esquina, crecimos en la plancha
            </h2>
            <p className="mt-6 max-w-[52ch] text-lg text-pretty text-cream-dim">
              Llevamos más de 7 años trabajando esta locura y pasión por las
              hamburguesas. Nos enfocamos en que tengas la mejor experiencia con
              una hamburguesa en la comodidad de tu casa: cada una se arma al
              momento, con ese char que no se negocia.
            </p>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-6">
              <div>
                <p className="font-display text-4xl text-ember">7+</p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.15em] text-cream-dim">
                  Años de fuego
                </p>
              </div>
              <div>
                <p className="font-display text-4xl text-ember">5</p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.15em] text-cream-dim">
                  Zonas de delivery
                </p>
              </div>
              <div>
                <p className="font-display text-4xl text-ember">40+</p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.15em] text-cream-dim">
                  Productos
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DELIVERY + PAGOS */}
      <section id="delivery" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ember">
              (c) Delivery
            </span>
            <h2 className="mt-3 font-display text-4xl tracking-tight text-balance sm:text-5xl">
              Llegamos hasta tu puerta
            </h2>
            <p className="mt-4 max-w-[40ch] text-pretty text-cream-dim">
              Estamos en Ituzaingó y repartimos por toda la zona. Pedí y te lo
              llevamos caliente, como debe ser.
            </p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <span className="rounded-full border border-ember/40 bg-ember/10 px-4 py-2 text-sm font-medium text-ember">
                Ituzaingó
              </span>
              {["Castelar", "Padua", "Udaondo", "Villa Tesei"].map((z) => (
                <span
                  key={z}
                  className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-cream-dim"
                >
                  {z}
                </span>
              ))}
            </div>
          </div>
          <div id="pagos" className="scroll-mt-20">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ember">
              (d) Pagos
            </span>
            <h2 className="mt-3 font-display text-4xl tracking-tight text-balance sm:text-5xl">
              Pagá como quieras
            </h2>
            <p className="mt-4 max-w-[40ch] text-pretty text-cream-dim">
              Una vez hecho el pedido, te enviamos los datos para abonar.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              {[
                { t: "Efectivo", d: "Al recibir tu pedido" },
                { t: "Tarjeta", d: "Débito y crédito" },
                { t: "Mercado Pago", d: "QR o link de pago" },
                { t: "Transferencia", d: "Te pasamos el alias" },
              ].map((p) => (
                <div key={p.t} className="rounded-xl bg-ink-2 p-4 ring-1 ring-white/10">
                  <p className="font-display text-xl">{p.t}</p>
                  <p className="mt-1 text-sm text-cream-dim">{p.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/10 bg-ink-2/60">
        <div className="mx-auto max-w-7xl px-5 py-16 text-center sm:px-8">
          <p className="font-display text-5xl tracking-tight text-balance sm:text-7xl">
            ¿HAMBRE? <span className="text-ember">PEDÍ YA.</span>
          </p>
          <a
            href={waLink("Hola Burger Point, quiero hacer un pedido")}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center gap-3 rounded-full bg-ember px-8 py-4 text-lg font-semibold text-ink transition-transform hover:-translate-y-0.5"
          >
            <WhatsAppIcon className="size-5" /> Pedir por WhatsApp
          </a>
          <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.2em] text-cream-dim">
            Burger Point · Ituzaingó, Buenos Aires · Pedidos por WhatsApp
          </p>
        </div>
      </footer>

      {/* STICKY BAR */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="hidden sm:block">
            <p className="font-display text-lg leading-none">Burger Point</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream-dim">
              Ituzaingó · Delivery propio
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CartButton />
            <a
              href={waLink("Hola Burger Point, quiero hacer un pedido")}
              target="_blank"
              rel="noreferrer"
              aria-label="Pedir por WhatsApp"
              className="inline-flex items-center gap-2 rounded-full bg-ember px-4 py-3 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5 sm:px-6"
            >
              <WhatsAppIcon className="size-4" /> <span className="hidden sm:inline">WhatsApp</span>
            </a>
          </div>
        </div>
      </div>
      <div className="h-16" />
    </div>
  );
}
