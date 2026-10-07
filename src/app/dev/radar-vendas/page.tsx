"use client";

import { useEffect, useState } from "react";

type Lead = {
  id: string;
  nome: string;
  pizzaria: string;
  whatsapp: string;
  createdAt: string;
  status: "novo" | "convertido";
  convertedAt?: string;
};

export default function RadarVendasDevPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [acao, setAcao] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function carregar() {
    setLoading(true);
    const res = await fetch("/api/dev/radar-vendas/indicacoes", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setLeads(Array.isArray(json.leads) ? json.leads : []);
    setLoading(false);
  }

  useEffect(() => { void carregar(); }, []);

  async function confirmar(id: string) {
    if (!window.confirm("Confirme somente se esta pizzaria realmente virou cliente pagante do ChefeBot. Continuar?")) return;
    setAcao(id);
    setMsg("");
    const res = await fetch("/api/dev/radar-vendas/indicacoes/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: id }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      setMsg("Conversão confirmada. O Radar foi desbloqueado permanentemente para a conta indicadora.");
      await carregar();
    } else setMsg(json.error || "Falha ao confirmar.");
    setAcao(null);
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 18px 64px", color: "var(--foreground)" }}>
      <a href="/dev" style={{ color: "var(--brand-text)", textDecoration: "none" }}>← Console Dev</a>
      <h1>Indicações · Radar de Vendas</h1>
      <p style={{ color: "var(--foreground-secondary)" }}>Só marque como pagante depois de confirmar a contratação real. Essa ação concede o desbloqueio permanente do módulo.</p>
      {msg && <p style={{ fontWeight: 700 }}>{msg}</p>}
      {loading ? <p>Carregando...</p> : leads.length === 0 ? <p>Nenhuma indicação registrada.</p> : (
        <div style={{ display: "grid", gap: 10 }}>
          {leads.map((lead) => (
            <div key={lead.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
              <strong>{lead.pizzaria}</strong>
              <div style={{ color: "var(--foreground-secondary)", fontSize: 13, marginTop: 4 }}>{lead.nome} · {lead.whatsapp}</div>
              <div style={{ color: "var(--foreground-muted)", fontSize: 12, marginTop: 4 }}>{new Date(lead.createdAt).toLocaleString("pt-BR")}</div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>{lead.status === "convertido" ? "Pagante confirmado" : "Aguardando conversão"}</span>
                {lead.status !== "convertido" && (
                  <button disabled={acao === lead.id} onClick={() => void confirmar(lead.id)} style={{ border: 0, borderRadius: 9, padding: "9px 12px", background: "var(--primary)", fontWeight: 800, cursor: "pointer" }}>
                    {acao === lead.id ? "Confirmando..." : "Confirmar pagante"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
