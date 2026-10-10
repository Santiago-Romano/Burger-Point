import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useCart } from "@/lib/cart";
import { submitOrder } from "@/lib/order-submit";
import { quoteDelivery } from "@/lib/delivery-quote.functions";
import { formatDistance, type DeliveryFeeResult } from "@/lib/delivery-fees";
import { isPromoAvailableToday, PROMO_WEEKDAYS } from "@/lib/promo-schedule";

const ZONAS = ["Ituzaingó", "Castelar", "Padua", "Udaondo", "Villa Tesei"];
const PAGOS = ["Efectivo", "Tarjeta", "Mercado Pago", "Transferencia"];

const field =
  "w-full rounded-lg bg-ink px-3 py-2.5 text-sm text-cream ring-1 ring-white/15 outline-none placeholder:text-cream-dim/60 focus:ring-ember";

const isPromoCartItem = (item: { name: string; isPromo?: boolean }) =>
  item.isPromo ?? /^promo(?:\s|$)/i.test(item.name);

export function CartDrawer() {
  const { items, setQty, clear, open, setOpen } = useCart();
  const quoteDeliveryFn = useServerFn(quoteDelivery);
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
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [deliveryQuote, setDeliveryQuote] = useState<
    (DeliveryFeeResult & { address: string; zone: string }) | null
  >(null);
  const [quotingDelivery, setQuotingDelivery] = useState(false);
  const submissionKey = useRef<string | null>(null);

  if (!open) return null;

  const quoteMatchesAddress =
    deliveryQuote?.address === address.trim() && deliveryQuote?.zone === zone;

  const calculateDelivery = async () => {
    setError("");
    if (address.trim().length < 4) return setError("Ingresá la dirección para calcular el envío.");

    setQuotingDelivery(true);
    setDeliveryQuote(null);
    try {
      const result = await quoteDeliveryFn({ data: { address: address.trim(), zone } });
      if (!result.success) {
        setError(
          result.reason === "configuration"
            ? "El cálculo de envío todavía no está configurado. Elegí retiro o contactá al local."
            : "No pudimos calcular la distancia para esa dirección. Revisá la dirección y la localidad.",
        );
      } else {
        setDeliveryQuote({ ...result, address: address.trim(), zone });
      }
    } catch {
      setError("No pudimos calcular el envío. Revisá la dirección e intentá de nuevo.");
    } finally {
      setQuotingDelivery(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!items.length) return setError("Tu pedido está vacío.");
    const unavailablePromo = items.find(
      (item) => isPromoCartItem(item) && !isPromoAvailableToday(item.promoDays),
    );
    if (unavailablePromo) {
      const validDays = (unavailablePromo.promoDays ?? [])
        .map((day) => PROMO_WEEKDAYS[day])
        .filter(Boolean)
        .join(", ");
      return setError(
        validDays
          ? `${unavailablePromo.name} solo está disponible estos días: ${validDays}. Quitala del pedido para continuar.`
          : "Hay una promo vencida en el pedido. Quitala y agregá la promo disponible hoy.",
      );
    }
    if (name.trim().length < 2) return setError("Ingresá tu nombre.");
    if (phone.replace(/\D/g, "").length < 8) return setError("Ingresá un teléfono válido.");
    if (tipo === "delivery" && address.trim().length < 4) return setError("Ingresá la dirección.");
    if (tipo === "delivery" && !quoteMatchesAddress)
      return setError("Calculá el costo del envío antes de confirmar el pedido.");
    if (tipo === "delivery" && deliveryQuote?.available === false)
      return setError("No llegamos a esa dirección: supera los 5,5 km de recorrido.");

    const clientOrderId = submissionKey.current ?? crypto.randomUUID();
    submissionKey.current = clientOrderId;
    setSending(true);
    const { error: dbError, retrySafe } = await submitOrder({
      client_order_id: clientOrderId,
      customer_name: name.trim().slice(0, 100),
      phone: phone.trim().slice(0, 30),
      delivery_type: tipo,
      delivery_distance_meters:
        tipo === "delivery" && deliveryQuote?.available ? deliveryQuote.distanceMeters : null,
      delivery_fee: tipo === "delivery" && deliveryQuote?.available ? deliveryQuote.fee : null,
      address: tipo === "delivery" ? address.trim().slice(0, 200) : null,
      zone: tipo === "delivery" ? zone : null,
      payment,
      notes: notes.trim().slice(0, 500) || null,
      items: items.map(({ name, extras, salsa, qty, unitPrice }) => ({
        name,
        extras,
        salsa: salsa ?? null,
        qty,
        unit_price: unitPrice ?? null,
      })),
    });
    setSending(false);
    if (dbError)
      return setError(
        retrySafe
          ? "No pudimos registrar el pedido. Probá nuevamente en unos segundos; el reintento no va a duplicarlo."
          : "No pudimos confirmar el pedido. Antes de volver a intentarlo, consultá al local para evitar duplicarlo.",
      );

    clear();
    setTrackingToken(clientOrderId);
    submissionKey.current = null;
    setDone(true);
  };

  const close = () => {
    setOpen(false);
    setDone(false);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-ink/80 backdrop-blur-sm"
      onClick={close}
    >
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
          <div className="mt-10 text-center" aria-live="polite">
            <p className="font-display text-4xl text-ember">¡PEDIDO REGISTRADO!</p>
            <p className="mt-3 text-cream-dim">
              Recibimos tu pedido #{trackingToken?.slice(0, 8).toUpperCase()}. Podés consultar su estado y la demora estimada.
            </p>
            {trackingToken && (
              <a
                href={`/seguimiento/${trackingToken}`}
                className="mt-5 inline-flex rounded-full bg-ember px-6 py-3 font-semibold text-ink"
              >
                Ver estado del pedido
              </a>
            )}
            <button
              onClick={close}
              className="mt-8 rounded-full bg-ember px-6 py-3 font-semibold text-ink"
            >
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
                  <li
                    key={i.key}
                    className="flex items-start justify-between gap-3 rounded-xl bg-ink p-3 ring-1 ring-white/10"
                  >
                    <div className="text-sm">
                      <p className="font-semibold">{i.name}</p>
                      {i.unitPrice != null && (
                        <p className="font-mono text-ember">
                          $ {i.unitPrice.toLocaleString("es-AR")} c/u
                        </p>
                      )}
                      {i.extras.length > 0 && (
                        <p className="text-cream-dim">+ {i.extras.join(", ")}</p>
                      )}
                      {i.salsa && <p className="text-cream-dim">Salsa: {i.salsa}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono">
                      <button
                        aria-label="Quitar uno"
                        onClick={() => setQty(i.key, i.qty - 1)}
                        className="size-7 rounded-full ring-1 ring-white/15"
                      >
                        −
                      </button>
                      <span className="w-5 text-center">{i.qty}</span>
                      <button
                        aria-label="Sumar uno"
                        onClick={() => setQty(i.key, i.qty + 1)}
                        className="size-7 rounded-full ring-1 ring-white/15"
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={submit} className="mt-6 space-y-3">
              <input
                className={field}
                placeholder="Tu nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
              <input
                className={field}
                placeholder="Teléfono / WhatsApp"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={30}
                inputMode="tel"
              />
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
                  <input
                    className={field}
                    placeholder="Dirección (calle, número, entre calles)"
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setDeliveryQuote(null);
                    }}
                    maxLength={200}
                  />
                  <select
                    className={field}
                    value={zone}
                    onChange={(e) => {
                      setZone(e.target.value);
                      setDeliveryQuote(null);
                    }}
                  >
                    {ZONAS.map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void calculateDelivery()}
                    disabled={quotingDelivery || address.trim().length < 4}
                    className="w-full rounded-full px-4 py-2.5 text-sm font-semibold ring-1 ring-white/20 hover:bg-white/5 disabled:opacity-50"
                  >
                    {quotingDelivery ? "Calculando distancia…" : "Calcular costo de envío"}
                  </button>
                  {quoteMatchesAddress && deliveryQuote?.available && (
                    <div className="rounded-lg bg-ink px-3 py-2 text-sm" aria-live="polite">
                      <p>Distancia por auto: {formatDistance(deliveryQuote.distanceMeters)}</p>
                      <p className="font-semibold text-ember">
                        Costo de envío: $ {deliveryQuote.fee.toLocaleString("es-AR")}
                      </p>
                    </div>
                  )}
                  {quoteMatchesAddress && deliveryQuote?.available === false && (
                    <p className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-200" role="alert">
                      Distancia: {formatDistance(deliveryQuote.distanceMeters)}. No hay delivery a más de 5,5 km.
                    </p>
                  )}
                </>
              )}
              <select
                className={field}
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                {PAGOS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <textarea
                className={field}
                rows={2}
                placeholder="Notas (opcional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
              {error && (
                <p className="text-sm text-ember" role="alert">
                  {error}
                </p>
              )}
              <button
                disabled={sending || items.length === 0 || quotingDelivery}
                className="w-full rounded-full bg-ember py-3.5 font-semibold text-ink disabled:opacity-50"
              >
                {sending ? "Registrando y reintentando…" : "Confirmar pedido"}
              </button>
              <p className="text-center text-xs text-cream-dim">
                Si la conexión falla, reintentamos sin crear pedidos duplicados.
              </p>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}
