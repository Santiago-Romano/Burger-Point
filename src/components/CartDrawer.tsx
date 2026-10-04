import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { itemLine, useCart } from "@/lib/cart";

const WHATSAPP = "5491162118588";
const ZONAS = ["Ituzaingó", "Castelar", "Padua", "Udaondo", "Villa Tesei"];
const PAGOS = ["Efectivo", "Tarjeta", "Mercado Pago", "Transferencia"];

const field =
  "w-full rounded-lg bg-ink px-3 py-2.5 text-sm text-cream ring-1 ring-white/15 outline-none placeholder:text-cream-dim/60 focus:ring-ember";

export function CartDrawer() {
  const { items, setQty, clear, open, setOpen } = useCart();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tipo, setTipo] = useState<"delivery" | "retiro">("delivery");
  const [address, setAddress] = useState("");
  const [zone, setZone] = useState(ZONAS[0]!);
  const [payment, setPayment] = useState(PAGOS[0]!);
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!items.length) return setError("Tu pedido está vacío.");
    if (name.trim().length < 2) return setError("Ingresá tu nombre.");
    if (phone.replace(/\D/g, "").length < 8) return setError("Ingresá un teléfono válido.");
    if (tipo === "delivery" && address.trim().length < 4) return setError("Ingresá la dirección.");

    setSending(true);
    const win = window.open("", "_blank");
    const { error: dbError } = await supabase.from("orders").insert({
      customer_name: name.trim().slice(0, 100),
      phone: phone.trim().slice(0, 30),
      delivery_type: tipo,
      address: tipo === "delivery" ? address.trim().slice(0, 200) : null,
      zone: tipo === "delivery" ? zone : null,
      payment,
      notes: notes.trim().slice(0, 500) || null,
      items: items.map(({ name, extras, salsa, qty, unitPrice }) => ({ name, extras, salsa: salsa ?? null, qty, unit_price: unitPrice ?? null })),
    });
    setSending(false);
    if (dbError) {
      win?.close();
      return setError("No pudimos registrar el pedido. Probá de nuevo o escribinos por WhatsApp.");
    }

    const msg = [
      "Hola Burger Point, hice este pedido desde la web:",
      ...items.map(itemLine),
      "",
      `Nombre: ${name}`,
      `Tel: ${phone}`,
      tipo === "delivery" ? `Delivery: ${address} (${zone})` : "Retiro en el local",
      `Pago: ${payment}`,
      notes ? `Notas: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const url = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;
    if (win) win.location.href = url;
    else window.location.href = url;
    clear();
    setDone(true);
  };

  const close = () => {
    setOpen(false);
    setDone(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-ink/80 backdrop-blur-sm" onClick={close}>
      <aside
        role="dialog"
        aria-label="Tu pedido"
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-ink-2 p-5 ring-1 ring-white/10 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl">Tu pedido</h2>
          <button
            aria-label="Cerrar"
            onClick={close}
            className="grid size-10 place-items-center rounded-full text-2xl text-cream-dim ring-1 ring-white/15 hover:text-cream"
          >
            ×
          </button>
        </div>

        {done ? (
          <div className="mt-10 text-center">
            <p className="font-display text-4xl text-ember">¡PEDIDO ENVIADO!</p>
            <p className="mt-3 text-cream-dim">
              Ya lo recibimos en el local. Te escribimos por WhatsApp para confirmar.
            </p>
            <button onClick={close} className="mt-8 rounded-full bg-ember px-6 py-3 font-semibold text-ink">
              Seguir viendo el menú
            </button>
          </div>
        ) : (
          <>
            {items.length === 0 ? (
              <p className="mt-8 text-cream-dim">Todavía no agregaste nada. Elegí algo del menú.</p>
            ) : (
              <ul className="mt-5 space-y-2">
                {items.map((i) => (
                  <li key={i.key} className="flex items-start justify-between gap-3 rounded-xl bg-ink p-3 ring-1 ring-white/10">
                    <div className="text-sm">
                      <p className="font-semibold">{i.name}</p>
                      {i.unitPrice != null && <p className="font-mono text-ember">$ {i.unitPrice.toLocaleString("es-AR")} c/u</p>}
                      {i.extras.length > 0 && <p className="text-cream-dim">+ {i.extras.join(", ")}</p>}
                      {i.salsa && <p className="text-cream-dim">Salsa: {i.salsa}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono">
                      <button aria-label="Quitar uno" onClick={() => setQty(i.key, i.qty - 1)} className="size-7 rounded-full ring-1 ring-white/15">−</button>
                      <span className="w-5 text-center">{i.qty}</span>
                      <button aria-label="Sumar uno" onClick={() => setQty(i.key, i.qty + 1)} className="size-7 rounded-full ring-1 ring-white/15">+</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={submit} className="mt-6 space-y-3">
              <input className={field} placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              <input className={field} placeholder="Teléfono / WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" />
              <div className="flex gap-2 rounded-full bg-ink p-1 ring-1 ring-white/10">
                {(["delivery", "retiro"] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setTipo(t)}
                    className={`flex-1 rounded-full py-2 font-mono text-[11px] uppercase tracking-[0.12em] ${tipo === t ? "bg-ember text-ink" : "text-cream-dim"}`}
                  >
                    {t === "delivery" ? "Delivery" : "Retiro"}
                  </button>
                ))}
              </div>
              {tipo === "delivery" && (
                <>
                  <input className={field} placeholder="Dirección (calle, número, entre calles)" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
                  <select className={field} value={zone} onChange={(e) => setZone(e.target.value)}>
                    {ZONAS.map((z) => <option key={z}>{z}</option>)}
                  </select>
                </>
              )}
              <select className={field} value={payment} onChange={(e) => setPayment(e.target.value)}>
                {PAGOS.map((p) => <option key={p}>{p}</option>)}
              </select>
              <textarea className={field} rows={2} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
              {error && <p className="text-sm text-ember">{error}</p>}
              <button
                disabled={sending || items.length === 0}
                className="w-full rounded-full bg-ember py-3.5 font-semibold text-ink disabled:opacity-50"
              >
                {sending ? "Enviando…" : "Confirmar pedido"}
              </button>
              <p className="text-center text-xs text-cream-dim">
                El pedido llega al local y se abre WhatsApp para confirmarlo.
              </p>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}
