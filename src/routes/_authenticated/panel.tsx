import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { MenuManager } from "@/components/MenuManager";
import { deleteUserAccount } from "@/lib/delete-user.functions";
import { formatDistance } from "@/lib/delivery-fees";

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
type AdminAccessRequest =
  Database["public"]["Functions"]["list_admin_access_requests"]["Returns"][number];
type AdminAccessUser = Database["public"]["Functions"]["list_access_users"]["Returns"][number];
type UserRole = Database["public"]["Enums"]["app_role"];
type AdminAccessStatus = "pending" | "rejected" | "none";
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
  const deleteUserAccountFn = useServerFn(deleteUserAccount);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [accessRole, setAccessRole] = useState<UserRole | null>(null);
  const [accessStatus, setAccessStatus] = useState<AdminAccessStatus | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [accessRequests, setAccessRequests] = useState<AdminAccessRequest[]>([]);
  const [accessUsers, setAccessUsers] = useState<AdminAccessUser[]>([]);
  const [accessRequestsLoading, setAccessRequestsLoading] = useState(false);
  const [accessRequestsError, setAccessRequestsError] = useState("");
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [updatingUserAccessId, setUpdatingUserAccessId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accessRequestsReload, setAccessRequestsReload] = useState(0);
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
  const [view, setView] = useState<"orders" | "menu" | "access">("menu");
  const [connection, setConnection] = useState<"conectado" | "reconectando" | "desconectado">(
    "reconectando",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [deletingOrders, setDeletingOrders] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let active = true;
    const w = localStorage.getItem("bp-print-width");
    if (w === "58mm" || w === "80mm") setWidth(w);
    const checkAccess = async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!active) return;
      setCurrentUserId(authData.user?.id ?? null);

      const { data: isAdmin, error: claimError } = await supabase.rpc("claim_admin");
      if (!active) return;
      if (!claimError && isAdmin) {
        setAccessRole("admin");
        setAccessStatus(null);
        setAllowed(true);
        return;
      }

      const { data: panelAccess, error: accessError } = await supabase.rpc("get_panel_access");
      if (!active) return;
      if (!accessError && (panelAccess === "admin" || panelAccess === "operator")) {
        setAccessRole(panelAccess);
        setAccessStatus(null);
        setAllowed(true);
      } else {
        setAccessRole(null);
        setAccessStatus(
          panelAccess === "pending" || panelAccess === "rejected" ? panelAccess : "none",
        );
        setAllowed(false);
      }
    };
    void checkAccess();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!allowed || accessRole !== "admin") return;
    let active = true;
    setAccessRequestsLoading(true);
    setAccessRequestsError("");
    Promise.all([
      supabase.rpc("list_admin_access_requests"),
      supabase.rpc("list_access_users"),
    ]).then(([requestsResult, usersResult]) => {
      if (!active) return;
      if (requestsResult.error) {
        setAccessRequestsError("No se pudieron cargar las solicitudes de acceso.");
      } else {
        setAccessRequests(requestsResult.data ?? []);
      }
      if (usersResult.error) {
        setAccessRequestsError((message) =>
          message
            ? `${message} Tampoco se pudo cargar la lista de usuarios.`
            : "No se pudo cargar la lista de usuarios.",
        );
      } else {
        setAccessUsers(usersResult.data ?? []);
      }
      setAccessRequestsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [allowed, accessRole, view, accessRequestsReload]);

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

  const setStatus = async (o: Order, status: Status, prepEtaMinutes?: number) => {
    const update = { status, ...(prepEtaMinutes ? { prep_eta_minutes: prepEtaMinutes } : {}) };
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...update } : x)));
    const { error } = await supabase.from("orders").update(update).eq("id", o.id);
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

  const reviewAccessRequest = async (userId: string, role: UserRole | null) => {
    setReviewingRequestId(userId);
    setAccessRequestsError("");
    try {
      const { data, error } = await supabase.rpc("review_user_access_request", {
        _user_id: userId,
        _approve: role !== null,
        _role: role,
      });
      if (error) {
        setAccessRequestsError("No se pudo actualizar la solicitud. Intentá de nuevo.");
        return;
      }
      if (!data) {
        setAccessRequestsError("Esa solicitud ya fue revisada. Actualizá la lista.");
        return;
      }
      setAccessRequests((current) => current.filter((request) => request.user_id !== userId));
      setAccessRequestsReload((count) => count + 1);
    } catch {
      setAccessRequestsError("No se pudo actualizar la solicitud. Intentá de nuevo.");
    } finally {
      setReviewingRequestId(null);
    }
  };

  const changeUserRole = async (userId: string, role: UserRole | null) => {
    setUpdatingUserAccessId(userId);
    setAccessRequestsError("");
    try {
      const { data, error } = await supabase.rpc("set_user_app_role", {
        _user_id: userId,
        _role: role,
      });
      if (error) {
        const message = error.message.toLowerCase();
        setAccessRequestsError(
          message.includes("last admin")
            ? "No se puede quitar el permiso al único administrador."
            : message.includes("own role")
              ? "No podés cambiar el rol de tu propia cuenta."
              : "No se pudo modificar el permiso. Revisá tu conexión e intentá de nuevo.",
        );
        return;
      }
      if (!data) {
        setAccessRequestsError("No se encontró esa cuenta. Actualizá la lista.");
        return;
      }
      setAccessUsers((users) =>
        users.map((user) =>
          user.user_id === userId
            ? { ...user, role: role ?? "none", request_status: role ? "approved" : "rejected" }
            : user,
        ),
      );
      setAccessRequests((requests) => requests.filter((request) => request.user_id !== userId));
      setAccessRequestsReload((count) => count + 1);
    } catch {
      setAccessRequestsError(
        "No se pudo modificar el permiso. Revisá tu conexión e intentá de nuevo.",
      );
    } finally {
      setUpdatingUserAccessId(null);
    }
  };

  const removeUserAccount = async (userId: string, email: string | null) => {
    if (
      !window.confirm(
        `Vas a eliminar permanentemente la cuenta ${email ?? "seleccionada"}. No se puede deshacer. ¿Continuar?`,
      )
    ) {
      return;
    }

    setDeletingUserId(userId);
    setAccessRequestsError("");
    try {
      const result = await deleteUserAccountFn({ data: { userId } });
      if (!result.success) {
        const errors = {
          self: "No podés eliminar tu propia cuenta desde este panel.",
          forbidden: "Solo un administrador puede eliminar cuentas.",
          remove_admin_role_first:
            "Primero cambiá el rol de Administrador de esa cuenta y después podrás eliminarla.",
          not_found: "La cuenta ya no existe. Actualizá la lista.",
          storage_objects:
            "Supabase no permite eliminar una cuenta que posee archivos en Storage. Transferí o borrá esos archivos primero.",
          configuration:
            "Falta configurar SUPABASE_SERVICE_ROLE_KEY en las variables de servidor de Netlify.",
          server:
            "No se pudo eliminar la cuenta. Revisá la configuración del servidor e intentá de nuevo.",
        } as const;
        setAccessRequestsError(errors[result.reason]);
        return;
      }

      setAccessUsers((users) => users.filter((user) => user.user_id !== userId));
      setAccessRequests((requests) => requests.filter((request) => request.user_id !== userId));
      setAccessRequestsReload((count) => count + 1);
    } catch {
      setAccessRequestsError(
        "No se pudo eliminar la cuenta. Revisá la configuración del servidor.",
      );
    } finally {
      setDeletingUserId(null);
    }
  };

  const deleteOrders = async (status?: Status) => {
    if (deletingOrders) return;
    setDeleteError("");
    setDeletingOrders(true);
    const deletedIds: string[] = [];
    try {
      const ids: string[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = status
          ? await supabase
              .from("orders")
              .select("id")
              .eq("status", status)
              .order("created_at", { ascending: false })
              .range(offset, offset + 499)
          : await supabase
              .from("orders")
              .select("id")
              .order("created_at", { ascending: false })
              .range(offset, offset + 499);
        if (result.error) throw new Error(result.error.message);
        ids.push(...(result.data ?? []).map((order) => order.id));
        if (!result.data || result.data.length < 500) break;
      }
      if (ids.length === 0) return;

      const description = status
        ? `pedidos de "${STATUS.find((item) => item.id === status)!.label}"`
        : "pedidos de todos los estados";
      if (
        !window.confirm(
          `Vas a eliminar permanentemente ${ids.length} ${description}, incluidos registros antiguos fuera del panel. Esta acción no se puede deshacer. ¿Continuar?`,
        )
      )
        return;

      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const { error } = await supabase.from("orders").delete().in("id", batch);
        if (error) throw new Error(error.message);
        deletedIds.push(...batch);
        const deletedBatchIds = new Set(batch);
        setOrders((prev) => prev.filter((order) => !deletedBatchIds.has(order.id)));
      }
    } catch (error) {
      setDeleteError(
        `${deletedIds.length ? `Se eliminaron ${deletedIds.length} pedidos; ` : ""}No se pudieron completar los borrados: ${error instanceof Error ? error.message : "error desconocido"}`,
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
          <p className="font-display text-3xl">
            {accessStatus === "pending"
              ? "Solicitud pendiente"
              : accessStatus === "rejected"
                ? "Solicitud rechazada"
                : "Sin acceso"}
          </p>
          <p className="mt-2 max-w-md text-cream-dim">
            {accessStatus === "pending"
              ? "Tu cuenta quedó pendiente de aprobación. Un administrador del local debe revisar tu solicitud."
              : accessStatus === "rejected"
                ? "Tu solicitud no fue aprobada. Comunicate con un administrador del local si necesitás acceso."
                : "Esta cuenta todavía no tiene acceso al panel. Pedile a un administrador que habilite tu cuenta."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-full border border-white/15 px-5 py-2 font-semibold text-cream"
            >
              Actualizar estado
            </button>
            <button
              onClick={signOut}
              className="rounded-full bg-ember px-5 py-2 font-semibold text-ink"
            >
              Salir
            </button>
          </div>
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
              onClick={() => setView("menu")}
              className={`rounded-full px-4 py-2 text-sm ${view === "menu" ? "bg-ember text-ink" : "text-cream-dim"}`}
            >
              Menú
            </button>
            <button
              onClick={() => setView("orders")}
              className={`rounded-full px-4 py-2 text-sm ${view === "orders" ? "bg-ember text-ink" : "text-cream-dim"}`}
            >
              Pedidos
            </button>
            {accessRole === "admin" && (
              <button
                onClick={() => setView("access")}
                className={`rounded-full px-4 py-2 text-sm ${view === "access" ? "bg-ember text-ink" : "text-cream-dim"}`}
              >
                Accesos
                {accessRequests.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-ember px-1.5 py-0.5 text-xs text-ink">
                    {accessRequests.length}
                  </span>
                )}
              </button>
            )}
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
        ) : view === "access" && accessRole === "admin" ? (
          <main className="mx-auto max-w-5xl px-5 py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember">
                  Administración
                </p>
                <h1 className="mt-1 font-display text-4xl">Accesos del local</h1>
                <p className="mt-2 text-sm text-cream-dim">
                  Revisá solicitudes y administrá los permisos de las cuentas registradas.
                </p>
              </div>
              <button
                onClick={() => setAccessRequestsReload((count) => count + 1)}
                disabled={accessRequestsLoading}
                className="rounded-full border border-white/15 px-4 py-2 text-sm text-cream-dim hover:text-cream disabled:opacity-50"
              >
                {accessRequestsLoading ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
            {accessRequestsError && (
              <p role="alert" className="mb-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-200">
                {accessRequestsError}
              </p>
            )}
            <section>
              <h2 className="mb-3 font-display text-2xl">Solicitudes pendientes</h2>
              {accessRequestsLoading && accessRequests.length === 0 ? (
                <p className="text-cream-dim">Cargando solicitudes…</p>
              ) : accessRequests.length === 0 ? (
                <p className="rounded-xl border border-white/10 p-6 text-cream-dim">
                  No hay solicitudes pendientes.
                </p>
              ) : (
                <div className="grid gap-3">
                  {accessRequests.map((request) => (
                    <article
                      key={request.user_id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-ink-2 p-4 ring-1 ring-white/10"
                    >
                      <div className="min-w-0">
                        <p className="break-all font-semibold">{request.email ?? "Sin email"}</p>
                        <p className="mt-1 text-sm text-cream-dim">
                          Solicitó acceso el{" "}
                          {new Date(request.requested_at).toLocaleString("es-AR")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void reviewAccessRequest(request.user_id, null)}
                          disabled={
                            reviewingRequestId !== null ||
                            updatingUserAccessId !== null ||
                            deletingUserId !== null
                          }
                          className="rounded-full border border-white/15 px-4 py-2 text-sm text-cream-dim hover:text-cream disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                        <button
                          onClick={() => void reviewAccessRequest(request.user_id, "operator")}
                          disabled={
                            reviewingRequestId !== null ||
                            updatingUserAccessId !== null ||
                            deletingUserId !== null
                          }
                          className="rounded-full border border-white/15 px-4 py-2 text-sm text-cream-dim hover:text-cream disabled:opacity-50"
                        >
                          Operador
                        </button>
                        <button
                          onClick={() => void reviewAccessRequest(request.user_id, "admin")}
                          disabled={
                            reviewingRequestId !== null ||
                            updatingUserAccessId !== null ||
                            deletingUserId !== null
                          }
                          className="rounded-full bg-ember px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                        >
                          {reviewingRequestId === request.user_id ? "Guardando…" : "Administrador"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-10">
              <div className="mb-3">
                <h2 className="font-display text-2xl">Usuarios y permisos</h2>
                <p className="mt-1 text-sm text-cream-dim">
                  Operador accede a pedidos y menú. Administrador también gestiona accesos y
                  cuentas.
                </p>
              </div>
              {accessRequestsLoading && accessUsers.length === 0 ? (
                <p className="text-cream-dim">Cargando usuarios…</p>
              ) : accessUsers.length === 0 ? (
                <p className="rounded-xl border border-white/10 p-5 text-cream-dim">
                  No se encontraron cuentas registradas.
                </p>
              ) : (
                <div className="grid gap-3">
                  {accessUsers.map((user) => (
                    <article
                      key={user.user_id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-ink-2 p-4 ring-1 ring-white/10"
                    >
                      <div className="min-w-0">
                        <p className="break-all font-semibold">{user.email ?? "Sin email"}</p>
                        <p className="mt-1 text-sm text-cream-dim">
                          Cuenta creada el {new Date(user.created_at).toLocaleDateString("es-AR")}
                          {user.user_id === currentUserId ? " · Tu cuenta" : ""}
                        </p>
                        {user.request_status === "pending" && (
                          <span className="mt-2 inline-flex rounded-full bg-amber-300/10 px-2.5 py-1 text-xs text-amber-200">
                            Solicitud pendiente
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-3 text-sm text-cream-dim">
                          <span>Rol</span>
                          <select
                            aria-label={`Rol para ${user.email ?? "esta cuenta"}`}
                            value={user.role}
                            disabled={
                              updatingUserAccessId !== null ||
                              deletingUserId !== null ||
                              user.user_id === currentUserId
                            }
                            onChange={(event) => {
                              const role =
                                event.target.value === "none"
                                  ? null
                                  : (event.target.value as UserRole);
                              const roleName =
                                role === "admin"
                                  ? "Administrador"
                                  : role === "operator"
                                    ? "Operador"
                                    : "Sin acceso";
                              if (
                                window.confirm(
                                  `¿Asignar “${roleName}” a ${user.email ?? "esta cuenta"}?`,
                                )
                              ) {
                                void changeUserRole(user.user_id, role);
                              }
                            }}
                            className="rounded-lg bg-ink px-3 py-2 text-cream ring-1 ring-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="none">Sin acceso</option>
                            <option value="operator">Operador · Pedidos y menú</option>
                            <option value="admin">Administrador</option>
                          </select>
                          {updatingUserAccessId === user.user_id && (
                            <span className="text-xs">Guardando…</span>
                          )}
                        </label>
                        {user.user_id !== currentUserId && user.role !== "admin" ? (
                          <button
                            type="button"
                            onClick={() => void removeUserAccount(user.user_id, user.email)}
                            disabled={
                              deletingUserId !== null ||
                              reviewingRequestId !== null ||
                              updatingUserAccessId !== null
                            }
                            className="rounded-full border border-red-300/30 px-4 py-2 text-sm text-red-200 hover:bg-red-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingUserId === user.user_id ? "Eliminando…" : "Eliminar cuenta"}
                          </button>
                        ) : user.role === "admin" && user.user_id !== currentUserId ? (
                          <p className="max-w-xs text-xs text-cream-dim">
                            Quitá primero el rol de Administrador para eliminar esta cuenta.
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </main>
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

            {accessRole === "admin" && (
              <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
                <button
                  type="button"
                  disabled={deletingOrders}
                  onClick={() => void deleteOrders(tab)}
                  className="rounded-full px-4 py-2 text-sm text-cream-dim ring-1 ring-white/15 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingOrders
                    ? "Eliminando…"
                    : `Eliminar todos los ${STATUS.find((status) => status.id === tab)!.label.toLowerCase()}`}
                </button>
                <button
                  type="button"
                  disabled={deletingOrders}
                  onClick={() => void deleteOrders()}
                  className="rounded-full px-4 py-2 text-sm text-red-300 ring-1 ring-red-400/30 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Eliminar todos los pedidos
                </button>
              </div>
            )}
            {accessRole === "admin" && deleteError && (
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
                    {o.delivery_type === "delivery" && o.delivery_fee != null && (
                      <p className="text-sm text-cream-dim">
                        Envío: $ {o.delivery_fee.toLocaleString("es-AR")}
                        {o.delivery_distance_meters != null &&
                          ` · ${formatDistance(o.delivery_distance_meters)} por auto`}
                      </p>
                    )}
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
                    {o.status === "en_cocina" && o.prep_eta_minutes && (
                      <p className="mt-3 rounded-lg bg-ember/10 px-3 py-2 text-sm text-ember">
                        Demora informada: {o.prep_eta_minutes} minutos
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {st.next && o.status === "nuevo" && (
                        <div className="w-full rounded-xl bg-ink p-3 ring-1 ring-white/10">
                          <p className="mb-2 text-sm font-semibold">Pasar a cocina · demora estimada</p>
                          <div className="flex flex-wrap gap-2">
                            {[20, 30, 40].map((minutes) => (
                              <button
                                key={minutes}
                                onClick={() => setStatus(o, st.next!, minutes)}
                                className="rounded-full bg-ember px-4 py-2 text-sm font-semibold text-ink"
                              >
                                {minutes} min
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {st.next && o.status !== "nuevo" && (
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
          className="hidden bg-white p-2 font-mono text-[13px] leading-snug text-black print:block"
          style={{ width, boxSizing: "border-box" }}
        >
          <p className="text-center text-[15px] font-bold">BURGER POINT</p>
          <p className="text-center text-[12px] font-bold">COMPROBANTE DE PEDIDO</p>
          <p className="mt-1 text-center text-[22px] font-bold">N.º {printing.order_number}</p>
          <p className="text-center text-[12px]">
            {new Date(printing.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
          </p>
          <hr className="my-2 border-black" />
          <p><b>Cliente:</b> {printing.customer_name}</p>
          <p><b>Teléfono:</b> {printing.phone}</p>
          <p className="mt-1 font-bold">
            {printing.delivery_type === "delivery" ? "DELIVERY" : "RETIRO EN LOCAL"}
          </p>
          {printing.delivery_type === "delivery" && <p><b>Dirección:</b> {printing.address}{printing.zone ? `, ${printing.zone}` : ""}</p>}
          <p><b>Pago:</b> {printing.payment}</p>
          {printing.prep_eta_minutes && <p><b>Demora:</b> {printing.prep_eta_minutes} min</p>}
          <hr className="my-2 border-black" />
          <p className="mb-1 text-center font-bold">DETALLE DEL PEDIDO</p>
          {(printing.items as unknown as Item[]).map((i, idx) => (
            <div key={idx} className="mb-2 break-words">
              <div className="flex justify-between gap-2 font-bold">
                <span>{i.qty} x {i.name}</span>
                <span className="shrink-0">
                  {i.unit_price != null
                    ? `$ ${(i.unit_price * i.qty).toLocaleString("es-AR")}`
                    : "—"}
                </span>
              </div>
              {i.unit_price != null && <p>$ {i.unit_price.toLocaleString("es-AR")} c/u</p>}
              {(i.extras?.length || i.salsa) && (
                <p className="text-[12px]">
                  {i.extras?.length ? `+ ${i.extras.join(", ")}` : ""}
                  {i.extras?.length && i.salsa ? " · " : ""}
                  {i.salsa ? `Salsa: ${i.salsa}` : ""}
                </p>
              )}
            </div>
          ))}
          <hr className="my-2 border-black" />
          {(() => {
            const items = printing.items as unknown as Item[];
            const hasAllPrices = items.every((item) => item.unit_price != null);
            const subtotal = items.reduce((sum, item) => sum + (item.unit_price ?? 0) * item.qty, 0);
            const deliveryFee = printing.delivery_type === "delivery" ? printing.delivery_fee ?? 0 : 0;
            return <>
              <div className="flex justify-between gap-2"><span>Subtotal</span><span>$ {subtotal.toLocaleString("es-AR")}</span></div>
              {printing.delivery_type === "delivery" && (
                <div className="flex justify-between gap-2"><span>Envío</span><span>$ {deliveryFee.toLocaleString("es-AR")}</span></div>
              )}
              <div className="mt-1 flex justify-between gap-2 text-[17px] font-bold">
                <span>TOTAL</span><span>{hasAllPrices ? `$ ${(subtotal + deliveryFee).toLocaleString("es-AR")}` : "Verificar precios"}</span>
              </div>
              {!hasAllPrices && <p className="text-[10px]">Este pedido no tiene todos los precios guardados.</p>}
            </>;
          })()}
          {printing.notes && <p className="mt-2 break-words"><b>Notas:</b> {printing.notes}</p>}
          <p className="mt-3 text-center text-[11px]">Gracias por tu pedido</p>
        </div>
      )}
    </>
  );
}
