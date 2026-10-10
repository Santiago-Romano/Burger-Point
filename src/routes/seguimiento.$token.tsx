import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Status = Database["public"]["Enums"]["order_status"];
type Tracking = { order_number: number; status: Status; prep_eta_minutes: number | null };

const labels: Record<Status, string> = {
  nuevo: "Recibimos tu pedido",
  en_cocina: "Estamos preparando tu pedido",
  enviado: "Tu pedido está en camino",
  entregado: "Pedido entregado",
  cancelado: "Pedido cancelado",
};

export const Route = createFileRoute("/seguimiento/$token")({ component: TrackingPage });

function TrackingPage() {
  const { token } = Route.useParams();
  const [order, setOrder] = useState<Tracking | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data, error } = await supabase.rpc("get_order_tracking", {
        _client_order_id: token,
      });
      if (!active) return;
      setFailed(Boolean(error) || !data?.length);
      setOrder(data?.[0] ?? null);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token]);

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-5 text-cream">
      <section className="w-full max-w-lg rounded-2xl bg-ink-2 p-8 text-center ring-1 ring-white/10">
        <p className="font-display text-2xl text-ember">BURGER POINT</p>
        {order ? (
          <>
            <p className="mt-6 text-sm text-cream-dim">Pedido #{order.order_number}</p>
            <h1 className="mt-2 font-display text-4xl">{labels[order.status]}</h1>
            {order.status === "en_cocina" && order.prep_eta_minutes && (
              <p className="mt-4 text-lg">Demora estimada: {order.prep_eta_minutes} minutos</p>
            )}
            <p className="mt-5 text-sm text-cream-dim">Esta página se actualiza automáticamente.</p>
          </>
        ) : (
          <p className="mt-6 text-cream-dim">
            {failed ? "No encontramos el pedido. Revisá el enlace o contactá al local." : "Buscando tu pedido…"}
          </p>
        )}
        <a href="/" className="mt-8 inline-flex rounded-full bg-ember px-6 py-3 font-semibold text-ink">
          Volver al menú
        </a>
      </section>
    </main>
  );
}
