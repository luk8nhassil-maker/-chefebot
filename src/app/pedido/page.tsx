"use client";
import { useEffect } from "react";
import { Pizza } from "lucide-react";
import { PublicCardapio } from "@/app/cardapio/page";
import { useLiveMenu } from "@/app/cardapio/liveMenu";

export default function PedidoPage() {
  const { menu, erro, retry } = useLiveMenu();

  // Captura ?ref= de indicação na abertura do link. Removido da URL imediatamente
  // para não vazar em prints/histórico. Armazenado em cf_ref (sessionStorage) para
  // ser processado quando o amigo fizer login em /cliente.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref) {
        params.delete("ref");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
        sessionStorage.setItem("cf_ref", ref);
      }
    } catch {}
  }, []);

  if (erro) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--background)", color: "var(--foreground)", fontFamily: "system-ui", padding: 24 }}>
      <Pizza size={40} color="var(--foreground)" />
      <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Não foi possível carregar o cardápio.</p>
      <button onClick={retry} style={{ border: "1px solid var(--surface-elevated)", background: "transparent", color: "var(--foreground)", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14 }}>Tentar de novo</button>
    </div>
  );

  if (!menu) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)", color: "var(--foreground)", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center" }}><div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><Pizza size={36} color="var(--foreground)" /></div><p>Carregando cardápio…</p></div>
    </div>
  );

  return <PublicCardapio menu={menu} />;
}
