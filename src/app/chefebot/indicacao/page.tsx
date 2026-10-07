"use client";

import { useEffect, useState, type FormEvent } from "react";

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--foreground)",
  borderRadius: 12,
  padding: "13px 14px",
  fontSize: 15,
};

export default function IndicacaoChefeBotPage() {
  const [ref, setRef] = useState("");
  const [nome, setNome] = useState("");
  const [pizzaria, setPizzaria] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [website, setWebsite] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "erro">("idle");

  useEffect(() => {
    queueMicrotask(() => setRef(new URLSearchParams(window.location.search).get("ref") ?? ""));
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/chefebot/indicacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, nome, pizzaria, whatsapp, website }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error("invalid");
      setStatus("ok");
    } catch {
      setStatus("erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", padding: "40px 18px" }}>
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <p style={{ color: "var(--brand-text)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>ChefeBot para pizzarias</p>
        <h1 style={{ fontSize: 34, lineHeight: 1.08, margin: "8px 0 12px" }}>Sua pizzaria pode vender com mais inteligência.</h1>
        <p style={{ color: "var(--foreground-secondary)", lineHeight: 1.65, fontSize: 16 }}>
          O ChefeBot organiza pedidos, acompanha comportamento de compra e ajuda a identificar oportunidades de recompra e aumento de ticket sem depender de achismo.
        </p>

        {status === "ok" ? (
          <div style={{ marginTop: 24, border: "1px solid color-mix(in srgb, var(--success) 35%, var(--border))", borderRadius: 16, padding: 20, background: "color-mix(in srgb, var(--success) 7%, var(--surface))" }}>
            <h2 style={{ margin: 0 }}>Interesse registrado.</h2>
            <p style={{ color: "var(--foreground-secondary)", marginBottom: 0 }}>A equipe poderá entrar em contato pelo WhatsApp informado para explicar o ChefeBot.</p>
          </div>
        ) : (
          <form onSubmit={enviar} style={{ marginTop: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 20, display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Seu nome
              <input value={nome} onChange={e => setNome(e.target.value)} required maxLength={80} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Nome da pizzaria
              <input value={pizzaria} onChange={e => setPizzaria(e.target.value)} required maxLength={100} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>WhatsApp
              <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} required inputMode="tel" maxLength={24} style={inputStyle} />
            </label>
            <input value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
            <button disabled={enviando || !ref} style={{ border: 0, borderRadius: 12, padding: "14px", background: "var(--primary)", color: "var(--foreground)", fontWeight: 900, fontSize: 15, cursor: "pointer" }}>
              {enviando ? "Enviando..." : "Quero conhecer o ChefeBot"}
            </button>
            <p style={{ margin: 0, color: "var(--foreground-muted)", fontSize: 11, lineHeight: 1.5 }}>
              Ao enviar, você autoriza contato sobre o ChefeBot pelo WhatsApp informado. A indicação só gera benefício para quem compartilhou depois de uma contratação paga confirmada.
            </p>
            {status === "erro" && <p role="alert" style={{ color: "var(--danger)", margin: 0, fontSize: 13 }}>Este convite não pôde ser validado. Peça um novo link a quem indicou.</p>}
          </form>
        )}
      </div>
    </main>
  );
}
