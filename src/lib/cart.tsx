import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface CartItem {
  key: string;
  name: string;
  extras: string[];
  salsa?: string | undefined;
  unitPrice?: number | undefined;
  qty: number;
  isPromo?: boolean;
  promoDays?: number[];
}

interface CartCtx {
  items: CartItem[];
  add: (item: Omit<CartItem, "key" | "qty">) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  count: number;
}

const Ctx = createContext<CartCtx | null>(null);
const STORAGE = "bp-cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(items));
  }, [items]);

  const add: CartCtx["add"] = (item) => {
    const key = [item.name, ...item.extras.slice().sort(), item.salsa ?? ""].join("|");
    setItems((prev) => {
      const found = prev.find((p) => p.key === key);
      if (found) return prev.map((p) => (p.key === key ? { ...p, qty: p.qty + 1 } : p));
      return [...prev, { ...item, key, qty: 1 }];
    });
  };
  const setQty = (key: string, qty: number) =>
    setItems((prev) =>
      qty <= 0 ? prev.filter((p) => p.key !== key) : prev.map((p) => (p.key === key ? { ...p, qty } : p)),
    );

  return (
    <Ctx.Provider
      value={{
        items,
        add,
        setQty,
        clear: () => setItems([]),
        open,
        setOpen,
        count: items.reduce((n, i) => n + i.qty, 0),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart fuera de CartProvider");
  return c;
}

export function itemLine(i: { qty: number; name: string; extras: string[]; salsa?: string | undefined; unitPrice?: number | undefined }) {
  let s = `${i.qty}x ${i.name}`;
  if (i.unitPrice != null) s += ` ($ ${i.unitPrice.toLocaleString("es-AR")} c/u)`;
  if (i.extras.length) s += ` + ${i.extras.join(" + ")}`;
  if (i.salsa) s += ` (Salsa: ${i.salsa})`;
  return s;
}
