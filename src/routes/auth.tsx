import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Ingreso al panel — Burger Point" },
      { name: "description", content: "Acceso del local al panel de pedidos de Burger Point." },
      { property: "og:title", content: "Ingreso al panel — Burger Point" },
      { property: "og:description", content: "Acceso del local al panel de pedidos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const field = "w-full rounded-lg bg-ink px-3 py-3 text-sm text-cream ring-1 ring-white/15 outline-none focus:ring-ember";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/panel", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    setBusy(true);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setMsg("Email o contraseña incorrectos.");
      navigate({ to: "/panel", replace: true });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/panel` },
      });
      setBusy(false);
      if (error) return setMsg(error.message);
      if (data.session) navigate({ to: "/panel", replace: true });
      else setMsg("Te mandamos un email para confirmar la cuenta. Después ingresá acá.");
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-ink px-4 font-body text-cream">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl bg-ink-2 p-6 ring-1 ring-white/10">
        <p className="font-display text-3xl">
          BURGER<span className="text-ember">POINT</span>
        </p>
        <p className="text-sm text-cream-dim">Panel de pedidos del local</p>
        <input className={field} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={field} type="password" required minLength={6} placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
        {msg && <p className="text-sm text-ember">{msg}</p>}
        <button disabled={busy} className="w-full rounded-full bg-ember py-3 font-semibold text-ink disabled:opacity-50">
          {mode === "in" ? "Ingresar" : "Crear cuenta"}
        </button>
        <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="w-full text-sm text-cream-dim hover:text-cream">
          {mode === "in" ? "Primera vez? Crear la cuenta del local" : "Ya tengo cuenta"}
        </button>
      </form>
    </div>
  );
}
