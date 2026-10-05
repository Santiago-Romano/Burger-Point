import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { MenuManager } from "@/components/MenuManager";

export const Route = createFileRoute("/_authenticated/panel")({
  head: () => ({
    meta: [
      { title: "Panel de pedidos — Burger Point" },
      {
        name: "description",
        content: "Recepción, estados e impresión de pedidos de Burger Point.",
      },
      { property: "og:title", content: "Panel de pedidos — Burger Point" },
      { property: "og:description", content: "Recepción e impresión de pedidos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Panel,
});

type Order = Database["public"]["Tables"]["orders"]["Row"];
type Status = Database["public"]["Enums"]["order_status"];
interface Item {
  name: string;
  extras: string[];
  salsa: string | null;
  qty: number;
  unit_price?: number | null;
}

const STATUS: { id: Status; label: string; next?: Status; nextLabel?: string }[] = [
  { id: "nuevo", label: "Nuevos", next: "en_cocina", nextLabel: "Pasar a cocina" },
  { id: "en_cocina", label: "En cocina", next: "enviado", nextLabel: "Marcar enviado" },
  { id: "enviado", label: "Enviados", next: "entregado", nextLabel: "Marcar entregado" },
  { id: "entregado", label: "Entregados" },
  { id: "cancelado", label: "Cancelados" },
];

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.3, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    /* sin audio */
  }
}

const time = (d: string) =>
  new Date(d).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

function Panel() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState<Status>("nuevo");
  const [printing, setPrinting] = useState<Order | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [editForm, setEditForm] = useState({
    customer_name: "",
    phone: "",
    address: "",
    zone: "",
    payment: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [width, setWidth] = useState<"80mm" | "58mm">("80mm");
  const [view, setView] = useState<"orders" | "menu">("orders");
  const [connection, setConnection] = useState<"conectado" | "reconectando" | "desconectado">(
    "reconectando",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [deletingOrders, setDeletingOrders] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const w = localStorage.getItem("bp-print-width");
    if (w === "58mm" || w === "80mm") setWidth(w);
    supabase.rpc("claim_admin").then(({ data }) => setAllowed(Boolean(data)));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    const refresh = async () => {
      setRefreshing(true);
      const since = new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString();
      const { data } = await supabase
        .from("orders")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (active && data) setOrders(data);
      if (active) setRefreshing(false);
    };
    void refresh();
    const ch = supabase
      .channel("orders-panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        if (p.eventType === "INSERT") {
          setOrders((prev) => {
            const next = p.new as Order;
            if (prev.some((order) => order.id === next.id)) return prev;
            beep();
            return [next, ...prev];
          });
        } else if (p.eventType === "UPDATE") {
          setOrders((prev) =>
            prev.map((o) => (o.id === (p.new as Order).id ? (p.new as Order) : o)),
          );
        } else if (p.eventType === "DELETE") {
          setOrders((prev) => prev.filter((o) => o.id !== (p.old as Order).id));
        }
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setConnection("conectado");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setConnection("reconectando");
        else if (status === "CLOSED") setConnection("desconectado");
      });
    const interval = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(ch);
    };
  }, [allowed]);

  const setStatus = async (o: Order, status: Status) => {
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status } : x)));
    const { error } = await supabase.from("orders").update({ status }).eq("id", o.id);
    if (error)
      void supabase
        .from("orders")
        .select("*")
        .eq("id", o.id)
        .single()
        .then(({ data }) => {
          if (data) setOrders((prev) => prev.map((x) => (x.id === o.id ? data : x)));
        });
  };

  const deleteOrders = async (ids: string[], description: string) => {
    if (deletingOrders || ids.length === 0) return;
    if (
      !window.confirm(
        `Vas a eliminar permanentemente ${ids.length} ${description}. Esta acción no se puede deshacer. ¿Continuar?`,
      )
    )
      return;

    setDeleteError("");
    setDeletingOrders(true);
    try {
      const { error } = await supabase.from("orders").delete().in("id", ids);
      if (error) {
        setDeleteError(`No se pudieron eliminar los pedidos: ${error.message}`);
        return;
      }
      const deletedIds = new Set(ids);
      setOrders((prev) => prev.filter((order) => !deletedIds.has(order.id)));
    } catch (error) {
      setDeleteError(
        `No se pudieron eliminar los pedidos: ${error instanceof Error ? error.message : "error desconocido"}`,
      );
    } finally {
      setDeletingOrders(false);
    }
  };

  const beginEdit = (o: Order) => {
    setEditing(o);
    setEditForm({
      customer_name: o.customer_name,
      phone: o.phone,
      address: o.address ?? "",
      zone: o.zone ?? "",
      payment: o.payment,
      notes: o.notes ?? "",
    });
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || editForm.customer_name.trim().length < 2 || editForm.phone.trim().length < 6)
      return;
    setSavingEdit(true);
    const { data, error } = await supabase
      .from("orders")
      .update({
        customer_name: editForm.customer_name.trim().slice(0, 100),
        phone: editForm.phone.trim().slice(0, 30),
        address:
          editing.delivery_type === "delivery" ? editForm.address.trim().slice(0, 200) : null,
        zone: editing.delivery_type === "delivery" ? editForm.zone.trim().slice(0, 80) : null,
        payment: editForm.payment.trim().slice(0, 80),
        notes: editForm.notes.trim().slice(0, 500) || null,
      })
      .eq("id", editing.id)
      .select("*")
      .single();
    setSavingEdit(false);
    if (error) return;
    if (data) setOrders((prev) => prev.map((o) => (o.id === data.id ? data : o)));
    setEditing(null);
  };

  const print = (o: Order) => {
    setPrinting(o);
    window.setTimeout(() => window.print(), 80);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (allowed === null) return <div className="min-h-screen bg-ink p-8 text-cream">Cargando…</div>;
  if (!allowed)
    return (
      <div className="grid min-h-screen place-items-center bg-ink p-8 text-center text-cream">
        <div>
          <p className="font-display text-3xl">Sin acceso</p>
          <p className="mt-2 text-cream-dim">Esta cuenta no es la del local.</p>
          <button
            onClick={signOut}
            className="mt-6 rounded-full bg-ember px-5 py-2 font-semibold text-ink"
          >
            Salir
          </button>
        </div>
      </div>
    );

  const list = orders.filter((o) => o.status === tab);

  return (
    <>
      <style>{`@media print { @page { size: ${width} auto; margin: 0; } }`}</style>
      <div className="min-h-screen bg-ink font-body text-cream print:hidden">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-white/10 bg-ink/90 px-5 py-3 backdrop-blur">
          <p className="font-display text-2xl">
            PEDIDOS <span className="text-ember">BURGER POINT</span>
          </p>
          <nav className="flex items-center gap-1 rounded-full bg-ink p-1">
            <button
              onClick={() => setView("orders")}
              className={`rounded-full px-4 py-2 text-sm ${view === "orders" ? "bg-ember text-ink" : "text-cream-dim"}`}
            >
              Pedidos
            </button>
            <button
              onClick={() => setView("menu")}
              className={`rounded-full px-4 py-2 text-sm ${view === "menu" ? "bg-ember text-ink" : "text-cream-dim"}`}
            >
              Menú
            </button>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {view === "orders" && (
              <>
                <span
                  className={`hidden rounded-md px-2 py-1 text-xs sm:inline ${connection === "conectado" ? "bg-emerald-400/10 text-emerald-300" : "bg-ember/10 text-ember"}`}
                  title="El panel también actualiza automáticamente cada 30 segundos"
                >
                  ● {connection}
                </span>
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-md px-3 py-1 ring-1 ring-white/15"
                >
                  {refreshing ? "Actualizando…" : "Actualizar"}
                </button>
                <label className="text-cream-dim">Etiqueta</label>
                <select
                  value={width}
                  onChange={(e) => {
                    const v = e.target.value as "80mm" | "58mm";
                    setWidth(v);
                    localStorage.setItem("bp-print-width", v);
                  }}
                  className="rounded-md bg-ink-2 px-2 py-1 ring-1 ring-white/15"
                >
                  <option value="80mm">80 mm</option>
                  <option value="58mm">58 mm</option>
                </select>
                <button onClick={beep} className="rounded-md px-3 py-1 ring-1 ring-white/15">
                  Probar sonido
                </button>
              </>
            )}
            <button onClick={signOut} className="rounded-md px-3 py-1 ring-1 ring-white/15">
              Salir
            </button>
          </div>
        </header>

        {view === "menu" ? (
          <MenuManager />
        ) : (
          <>
            <nav className="flex flex-wrap gap-2 px-5 py-4">
              {STATUS.map((s) => {
                const n = orders.filter((o) => o.status === s.id).length;
                return (
                  <button
                    key={s.id}
                    onClick={() => setTab(s.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === s.id ? "bg-ember text-ink" : "text-cream-dim ring-1 ring-white/15"}`}
                  >
                    {s.label} ({n})
                  </button>
                );
              })}
            </nav>

            <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
              <button
                type="button"
                disabled={deletingOrders || list.length === 0}
                onClick={() =>
                  void deleteOrders(
                    list.map((order) => order.id),
                    `pedidos de "${STATUS.find((status) => status.id === tab)!.label}"`,
                  )
                }
                className="rounded-full px-4 py-2 text-sm text-cream-dim ring-1 ring-white/15 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingOrders
                  ? "Eliminando…"
                  : `Eliminar todos los ${STATUS.find((status) => status.id === tab)!.label.toLowerCase()} (${list.length})`}
              </button>
              <button
                type="button"
                disabled={deletingOrders || orders.length === 0}
                onClick={() =>
                  void deleteOrders(
                    orders.map((order) => order.id),
                    "pedidos visibles",
                  )
                }
                className="rounded-full px-4 py-2 text-sm text-red-300 ring-1 ring-red-400/30 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Eliminar todos los pedidos visibles ({orders.length})
              </button>
            </div>
            {deleteError && (
              <p
                className="mx-5 mb-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-200"
                role="alert"
              >
                {deleteError}
              </p>
            )}

            <main className="grid gap-4 px-5 pb-10 md:grid-cols-2 xl:grid-cols-3">
              {list.length === 0 && <p className="text-cream-dim">No hay pedidos acá.</p>}
              {list.map((o) => {
                const st = STATUS.find((s) => s.id === o.status)!;
                const items = o.items as unknown as Item[];
                return (
                  <article key={o.id} className="rounded-2xl bg-ink-2 p-4 ring-1 ring-white/10">
                    <div className="flex items-baseline justify-between">
                      <p className="font-display text-3xl text-ember">#{o.order_number}</p>
                      <p className="font-mono text-sm text-cream-dim">{time(o.created_at)}</p>
                    </div>
                    <p className="mt-1 font-semibold">
                      {o.customer_name} · {o.phone}
                    </p>
                    <p className="text-sm text-cream-dim">
                      {o.delivery_type === "delivery"
                        ? `Delivery: ${o.address} (${o.zone})`
                        : "Retira en el local"}{" "}
                      · {o.payment}
                    </p>
                    <ul className="mt-3 space-y-1 text-sm">
                      {items.map((i, idx) => (
                        <li key={idx}>
                          <b>{i.qty}x</b> {i.name}
                          {i.unit_price != null && (
                            <span className="text-cream-dim">
                              {" "}
                              · $ {i.unit_price.toLocaleString("es-AR")} c/u
                            </span>
                          )}
                          {i.extras?.length > 0 && (
                            <span className="text-cream-dim"> + {i.extras.join(", ")}</span>
                          )}
                          {i.salsa && <span className="text-cream-dim"> · Salsa {i.salsa}</span>}
                        </li>
                      ))}
                    </ul>
                    {o.notes && <p className="mt-2 rounded-md bg-ink p-2 text-sm">📝 {o.notes}</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {st.next && (
                        <button
                          onClick={() => setStatus(o, st.next!)}
                          className="rounded-full bg-ember px-4 py-2 text-sm font-semibold text-ink"
                        >
                          {st.nextLabel}
                        </button>
                      )}
                      <button
                        onClick={() => beginEdit(o)}
                        className="rounded-full px-4 py-2 text-sm ring-1 ring-white/15"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => print(o)}
                        className="rounded-full px-4 py-2 text-sm ring-1 ring-white/15"
                      >
                        Imprimir
                      </button>
                      {o.status !== "cancelado" && o.status !== "entregado" && (
                        <button
                          onClick={() => setStatus(o, "cancelado")}
                          className="rounded-full px-4 py-2 text-sm text-cream-dim ring-1 ring-white/15"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </main>
          </>
        )}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/85 p-4"
          onClick={() => setEditing(null)}
        >
          <form
            className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-ink-2 p-6 ring-1 ring-white/15"
            onSubmit={saveEdit}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-3xl">Editar pedido #{editing.order_number}</h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-2xl text-cream-dim"
              >
                ×
              </button>
            </div>
            <input
              className="w-full rounded-lg bg-ink px-3 py-2.5 text-sm ring-1 ring-white/15"
              value={editForm.customer_name}
              onChange={(event) => setEditForm({ ...editForm, customer_name: event.target.value })}
              placeholder="Nombre"
            />
            <input
              className="w-full rounded-lg bg-ink px-3 py-2.5 text-sm ring-1 ring-white/15"
              value={editForm.phone}
              onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
              placeholder="Teléfono"
            />
            {editing.delivery_type === "delivery" && (
              <>
                <input
                  className="w-full rounded-lg bg-ink px-3 py-2.5 text-sm ring-1 ring-white/15"
                  value={editForm.address}
                  onChange={(event) => setEditForm({ ...editForm, address: event.target.value })}
                  placeholder="Dirección"
                />
                <input
                  className="w-full rounded-lg bg-ink px-3 py-2.5 text-sm ring-1 ring-white/15"
                  value={editForm.zone}
                  onChange={(event) => setEditForm({ ...editForm, zone: event.target.value })}
                  placeholder="Zona"
                />
              </>
            )}
            <input
              className="w-full rounded-lg bg-ink px-3 py-2.5 text-sm ring-1 ring-white/15"
              value={editForm.payment}
              onChange={(event) => setEditForm({ ...editForm, payment: event.target.value })}
              placeholder="Medio de pago"
            />
            <textarea
              className="w-full rounded-lg bg-ink px-3 py-2.5 text-sm ring-1 ring-white/15"
              rows={3}
              value={editForm.notes}
              onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
              placeholder="Notas"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-full px-4 py-2 text-sm ring-1 ring-white/15"
              >
                Cancelar
              </button>
              <button
                disabled={savingEdit}
                className="rounded-full bg-ember px-4 py-2 text-sm font-semibold text-ink"
              >
                {savingEdit ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      )}

      {printing && (
        <div
          className="hidden bg-white p-2 font-mono text-[12px] leading-tight text-black print:block"
          style={{ width }}
        >
          <p className="text-center text-base font-bold">BURGER POINT</p>
          <p className="text-center text-2xl font-bold">#{printing.order_number}</p>
          <p className="text-center">{new Date(printing.created_at).toLocaleString("es-AR")}</p>
          <hr className="my-1 border-black" />
          <p className="font-bold">{printing.customer_name}</p>
          <p>Tel: {printing.phone}</p>
          <p>
            {printing.delivery_type === "delivery"
              ? `${printing.address} (${printing.zone})`
              : "RETIRA EN LOCAL"}
          </p>
          <p>Pago: {printing.payment}</p>
          <hr className="my-1 border-black" />
          {(printing.items as unknown as Item[]).map((i, idx) => (
            <div key={idx} className="mb-1">
              <p className="font-bold">
                {i.qty}x {i.name}
              </p>
              {i.extras?.map((e) => (
                <p key={e}> + {e}</p>
              ))}
              {i.salsa && <p> Salsa: {i.salsa}</p>}
            </div>
          ))}
          {printing.notes && (
            <>
              <hr className="my-1 border-black" />
              <p>Notas: {printing.notes}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
