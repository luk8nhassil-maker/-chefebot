"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

export default function ConviteMarketingPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  const iniciou = useRef(false);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!token || iniciou.current) return;
    iniciou.current = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/marketing-organico/visita", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        window.location.replace(typeof data.destino === "string" ? data.destino : "/pedido");
      } catch {
        setErro(true);
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [token]);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "var(--background)" }}>
      <section style={{ width: "min(100%, 380px)", padding: 24, borderRadius: 22, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
        <div aria-hidden="true" style={{ fontSize: 44 }}>🍕</div>
        <h1 style={{ margin: "10px 0 6px", fontSize: 22 }}>Abrindo o Chefe da Pizza…</h1>
        <p style={{ margin: 0, color: "var(--foreground-secondary)", lineHeight: 1.5 }}>
          Você recebeu um convite. Já vamos abrir o cardápio para fazer seu pedido.
        </p>
        {erro && (
          <button type="button" onClick={() => window.location.replace("/pedido")} style={{ marginTop: 18, minHeight: 44, width: "100%", border: 0, borderRadius: 12, fontWeight: 800, background: "var(--primary)", color: "var(--primary-foreground)" }}>
            Abrir cardápio
          </button>
        )}
      </section>
    </main>
  );
}
