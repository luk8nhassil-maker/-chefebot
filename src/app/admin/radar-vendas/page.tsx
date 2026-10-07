"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole, Share2, TrendingUp, UnlockKeyhole } from "lucide-react";

type RadarResponse = {
  ok: boolean;
  access: {
    active: boolean;
    source: "pro" | "indicacao" | "bloqueado";
    currentPlanId: "basic" | "plus" | "pro";
    permanentUnlock: boolean;
    upgradePlanId: "pro";
  };
  summary: {
    clientesAnalisados: number;
    clientesComPadrao: number;
    altaConfianca: number;
    emJanelaAgora: number;
    oportunidadesAtivas: number;
    ticketMedioBaseCents: number;
    janelaAnaliseDias: number;
  };
  opportunities: Array<{
    clienteRef: string;
    score: number;
    confianca: string;
    faseMesLabel: string;
    janelaProvavel: { inicioDia: number; fimDia: number } | null;
    diasAteJanela: number | null;
    emJanelaAgora: boolean;
    diaSemanaMaisForte: string | null;
    horarioMaisForte: { inicioHora: number; fimHora: number } | null;
    pedidosAnalisados: number;
    ticketMedioCents: number;
    metaTicketCents: number;
    diasDesdeUltimaCompra: number | null;
    acao: string;
    acaoLabel: string;
    acaoDescricao: string;
  }>;
};

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 18,
};

function moeda(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export default function RadarVendasPage() {
  const [data, setData] = useState<RadarResponse | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);
  const [ativando, setAtivando] = useState(false);
  const [indicando, setIndicando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  async function carregar() {
    setLoading(true);
    setErro("");
    try {
      const res = await fetch("/api/admin/radar-vendas", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Radar indisponível");
      setData(json as RadarResponse);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o Radar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void carregar(); }, []);

  async function ativarNoPro() {
    setAtivando(true);
    setMensagem("");
    try {
      const res = await fetch("/api/assinatura/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "pro" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Não foi possível abrir o pagamento.");
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }
      await carregar();
      setMensagem("Plano atualizado. O Radar será liberado quando o pagamento estiver confirmado.");
    } catch (e) {
      setMensagem(e instanceof Error ? e.message : "Falha ao abrir o pagamento.");
    } finally {
      setAtivando(false);
    }
  }

  async function compartilharIndicacao() {
    setIndicando(true);
    setMensagem("");
    try {
      const res = await fetch("/api/admin/radar-vendas/indicacao", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Não foi possível gerar o convite.");
      const url = window.location.origin + json.sharePath;
      const text = `${json.message}\n\n${url}`;
      if (navigator.share) await navigator.share({ title: "ChefeBot", text, url });
      else {
        await navigator.clipboard.writeText(text);
        setMensagem("Convite copiado. Envie para outro dono de pizzaria.");
      }
    } catch (e) {
      setMensagem(e instanceof Error ? e.message : "Falha ao compartilhar.");
    } finally {
      setIndicando(false);
    }
  }

  if (loading) return <main style={{ padding: 24 }}>Carregando Radar...</main>;
  if (erro || !data) return <main style={{ padding: 24 }}><p>{erro || "Radar indisponível."}</p></main>;

  const ativo = data.access.active;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 18px 64px", color: "var(--foreground)" }}>
      <a href="/admin" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--foreground-secondary)", textDecoration: "none", fontSize: 13 }}>
        <ArrowLeft size={15} /> Voltar ao painel
      </a>

      <header style={{ margin: "18px 0 22px" }}>
        <p style={{ color: "var(--brand-text)", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>ChefeBot · Crescimento</p>
        <h1 style={{ margin: "6px 0 6px", fontSize: 30 }}>Radar de Vendas 2.0</h1>
        <p style={{ color: "var(--foreground-secondary)", maxWidth: 760, lineHeight: 1.6, margin: 0 }}>
          Encontra padrões reais de recompra e mostra quando vale aparecer, quando proteger margem e quando usar uma meta de ticket.
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
        {[
          ["Clientes analisados", data.summary.clientesAnalisados],
          ["Com padrão detectado", data.summary.clientesComPadrao],
          ["Confiança alta", data.summary.altaConfianca],
          ["Na janela agora", data.summary.emJanelaAgora],
          ["Oportunidades ativas", data.summary.oportunidadesAtivas],
          ["Ticket base", moeda(data.summary.ticketMedioBaseCents)],
        ].map(([label, value]) => (
          <div key={String(label)} style={card}>
            <div style={{ color: "var(--foreground-muted)", fontSize: 12 }}>{label}</div>
            <strong style={{ display: "block", fontSize: 24, marginTop: 6 }}>{value}</strong>
          </div>
        ))}
      </section>

      {!ativo ? (
        <section style={{ ...card, marginTop: 18, border: "1px solid color-mix(in srgb, var(--primary) 45%, var(--border))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LockKeyhole size={22} />
            <div>
              <h2 style={{ margin: 0, fontSize: 19 }}>Os sinais existem. Os detalhes estão bloqueados.</h2>
              <p style={{ color: "var(--foreground-secondary)", margin: "5px 0 0", lineHeight: 1.5 }}>
                O preview acima usa dados reais da pizzaria. Ative para ver quais clientes estão na janela, a meta de ticket sugerida e a próxima ação.
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginTop: 18 }}>
            <button onClick={ativarNoPro} disabled={ativando} style={{ border: 0, borderRadius: 12, padding: "14px 16px", background: "var(--primary)", color: "var(--foreground)", fontWeight: 800, cursor: "pointer" }}>
              {ativando ? "Abrindo pagamento..." : "Ativar no plano Pro"}
            </button>
            <button onClick={compartilharIndicacao} disabled={indicando} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface-secondary)", color: "var(--foreground)", fontWeight: 800, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
              <Share2 size={17} /> {indicando ? "Gerando convite..." : "Desbloquear indicando uma pizzaria"}
            </button>
          </div>
          <p style={{ color: "var(--foreground-muted)", fontSize: 12, lineHeight: 1.55, margin: "12px 0 0" }}>
            A indicação só libera o Radar quando a pizzaria indicada vira cliente pagante confirmado. O desbloqueio fica permanente para este módulo enquanto a assinatura base do ChefeBot estiver em dia.
          </p>
          {mensagem && <p style={{ marginTop: 12, fontSize: 13, fontWeight: 700 }}>{mensagem}</p>}
        </section>
      ) : (
        <>
          <section style={{ ...card, marginTop: 18, background: "color-mix(in srgb, var(--success) 8%, var(--surface))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <UnlockKeyhole size={20} />
              <strong>Radar ativo · {data.access.source === "indicacao" ? "desbloqueado por indicação" : "plano Pro"}</strong>
            </div>
            <p style={{ color: "var(--foreground-secondary)", margin: "7px 0 0", fontSize: 13 }}>
              Nesta versão o Radar recomenda a ação. Ele não dispara cupom nem WhatsApp sozinho, para evitar gasto de margem e mensagens fora de hora.
            </p>
          </section>

          <section style={{ marginTop: 18, display: "grid", gap: 10 }}>
            {data.opportunities.length === 0 ? (
              <div style={card}>Ainda não há clientes com histórico suficiente para gerar oportunidades.</div>
            ) : data.opportunities.map((o, i) => (
              <article key={`${o.clienteRef}-${i}`} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ color: "var(--foreground-muted)", fontSize: 12 }}>{o.clienteRef}</div>
                    <h3 style={{ margin: "3px 0 0", fontSize: 18 }}>{o.acaoLabel}</h3>
                  </div>
                  <span style={{ fontWeight: 900, fontSize: 18 }}>Score {o.score}</span>
                </div>
                <p style={{ color: "var(--foreground-secondary)", margin: "10px 0", lineHeight: 1.55 }}>{o.acaoDescricao}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, fontSize: 13 }}>
                  <span><strong>Fase:</strong> {o.faseMesLabel}</span>
                  <span><strong>Janela:</strong> {o.janelaProvavel ? `dias ${o.janelaProvavel.inicioDia}–${o.janelaProvavel.fimDia}` : "—"}</span>
                  <span><strong>Ticket médio:</strong> {moeda(o.ticketMedioCents)}</span>
                  <span><strong>Meta sugerida:</strong> {moeda(o.metaTicketCents)}</span>
                  <span><strong>Confiança:</strong> {o.confianca}</span>
                  <span><strong>Pedidos usados:</strong> {o.pedidosAnalisados}</span>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
