"use client";

import { useState, type FormEvent } from "react";

type EventRow = {
  eventId: string;
  sessionId: string;
  type: string;
  occurredAtMs: number;
  context: {
    source?: string; screen?: string; target?: string; productId?: string;
    cartItems?: number; cartDistinctItems?: number; outcome?: string;
    failureCode?: string; engagementMs?: number;
  };
  identificado: boolean;
};
type ReadResult = {
  ok: boolean;
  periodoDias: number;
  timeline: { events: EventRow[]; truncated: boolean };
  summary: {
    sessions: number; sessionsWithOrder: number; sessionsWithoutOrder: number;
    appOpens: number; searches: number; productViews: number; cartInteractions: number;
    checkoutStarts: number; rankingOpens: number; fidelityOpens: number;
    totalEngagementSeconds: number; medianDaysBetweenSessions: number | null; lastSeenAtMs: number | null;
  };
};
const labels: Record<string, string> = {
  app_open: "Abriu o app", whatsapp_link_verified: "Link oficial do WhatsApp validado", screen_view: "Abriu uma tela", search_used: "Pesquisou",
  category_view: "Abriu uma categoria", product_view: "Visualizou produto",
  cart_add: "Adicionou ao carrinho", cart_remove: "Removeu do carrinho",
  cart_quantity_change: "Alterou quantidade", cart_state: "Atualizou o carrinho",
  checkout_start: "Iniciou checkout", delivery_step_view: "Etapa de entrega",
  payment_step_view: "Etapa de pagamento", order_submit_attempt: "Tentou enviar pedido",
  action_result: "Resultado do envio", order_created: "Pedido criado",
  ranking_open: "Abriu Ranking", cofre_open: "Abriu Cofre", fidelity_open: "Abriu fidelidade",
  page_exit: "Saiu da tela",
};
function insights(result: ReadResult) {
  const events = result.timeline.events;
  const failures = events.filter(e => e.type === "action_result" && e.context.outcome === "failure");
  const noOrderSessions = new Set(events.filter(e => e.type !== "order_created").map(e => e.sessionId));
  const orderedSessions = new Set(events.filter(e => e.type === "order_created").map(e => e.sessionId));
  const abandoned = [...noOrderSessions].filter(id => !orderedSessions.has(id) && events.some(e => e.sessionId === id && e.type === "checkout_start")).length;
  const productCounts = new Map<string, number>();
  for (const e of events) if (e.type === "product_view" && e.context.productId) productCounts.set(e.context.productId, (productCounts.get(e.context.productId) ?? 0) + 1);
  const repeated = [...productCounts.entries()].filter(([, n]) => n > 1).sort((a,b) => b[1]-a[1])[0];
  const out: string[] = [];
  if (failures.length) out.push(failures.length + " tentativa(s) de envio falharam; confira horário, tela e código técnico registrado.");
  if (abandoned) out.push(abandoned + " sessão(ões) chegaram ao checkout sem evento de pedido criado.");
  if (repeated) out.push("Produto " + repeated[0] + " foi visto " + repeated[1] + " vezes; pode indicar interesse ou dificuldade de decisão.");
  if (!out.length && events.length) out.push("Não há falhas de checkout observadas neste período. Compare o relato com a etapa e horário registrados.");
  if (!events.length) out.push("Nenhum evento associado ao número neste período. Confirme se o cliente abriu o link oficial do WhatsApp com telemetria habilitada.");
  return out;
}
const card = { background: "var(--surface, rgba(255,255,255,.04))", border: "1px solid var(--border, rgba(255,255,255,.12))", borderRadius: 14, padding: 16 };
const muted = { color: "var(--text-secondary, #9aa3ad)", fontSize: 13 };
const pretty = (e: EventRow) => {
  const c = e.context;
  if (e.type === "action_result") return c.outcome === "success" ? "Envio aceito pelo sistema" : "Falha: " + (c.failureCode ?? "código indisponível");
  if (e.type === "product_view" && c.productId) return (labels[e.type] ?? e.type) + " · " + c.productId;
  if (e.type === "cart_state" && typeof c.cartItems === "number") return (labels[e.type] ?? e.type) + " · " + c.cartItems + " item(ns)";
  return labels[e.type] ?? e.type;
};

export default function MonitoramentoUsuarios() {
  const [telefone, setTelefone] = useState("");
  const [periodo, setPeriodo] = useState(30);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function consultar(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/dev/comportamento/cliente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", body: JSON.stringify({ telefone, periodo }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Não foi possível consultar este histórico.");
      setResult(data as ReadResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar o histórico.");
    } finally { setLoading(false); }
  }
  const events = result?.timeline.events ?? [];
  return <main style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 18px 64px", color: "var(--foreground, #f4f4f5)" }}>
    <a href="/dev" style={{ color: "var(--primary, #f5a623)", textDecoration: "none", fontSize: 13 }}>← Console Dev</a>
    <header style={{ margin: "20px 0 24px" }}>
      <p style={{ color: "var(--primary, #f5a623)", fontSize: 12, fontWeight: 800, letterSpacing: 1.1, textTransform: "uppercase", margin: "0 0 8px" }}>Sala Dev · Suporte e UX</p>
      <h1 style={{ fontSize: 30, margin: 0 }}>Monitoramento de usuários</h1>
      <p style={{ ...muted, maxWidth: 760, lineHeight: 1.6 }}>Consulte a jornada ligada ao telefone usado no link oficial do WhatsApp. O número serve apenas para localizar o cliente no servidor; a resposta mostra eventos, sem nome, telefone ou endereço.</p>
    </header>
    <form onSubmit={consultar} style={{ ...card, display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 }}>
      <label style={{ display: "grid", gap: 6, flex: "1 1 260px", fontSize: 13, fontWeight: 700 }}>Telefone informado pelo cliente
        <input value={telefone} onChange={e => setTelefone(e.target.value)} type="tel" autoComplete="off" inputMode="tel" required maxLength={24} placeholder="DDD + número" style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid var(--border, #444)", background: "var(--background, #151515)", color: "inherit" }} />
      </label>
      <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Período
        <select value={periodo} onChange={e => setPeriodo(Number(e.target.value))} style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid var(--border, #444)", background: "var(--background, #151515)", color: "inherit" }}>
          {[7,30,60,90].map(d => <option key={d} value={d}>{d} dias</option>)}
        </select>
      </label>
      <button disabled={loading} style={{ padding: "12px 18px", border: 0, borderRadius: 9, background: "var(--primary, #f5a623)", color: "#171717", fontWeight: 800, cursor: loading ? "wait" : "pointer" }}>{loading ? "Consultando…" : "Ver jornada"}</button>
    </form>
    {error && <p role="alert" style={{ color: "var(--danger, #f87171)", marginTop: 14 }}>{error}</p>}
    {result && <>
      <section aria-label="Resumo do cliente" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10, marginTop: 18 }}>
        {[
          ["Sessões", result.summary.sessions], ["Pedidos", result.summary.sessionsWithOrder],
          ["Sem pedido", result.summary.sessionsWithoutOrder], ["Buscas", result.summary.searches],
          ["Produtos vistos", result.summary.productViews], ["Interações no carrinho", result.summary.cartInteractions],
          ["Inícios de checkout", result.summary.checkoutStarts], ["Tempo ativo", Math.round(result.summary.totalEngagementSeconds / 60) + " min"],
          ["Intervalo mediano", result.summary.medianDaysBetweenSessions === null ? "—" : Math.round(result.summary.medianDaysBetweenSessions * 10) / 10 + " dias"], ["Última atividade", result.summary.lastSeenAtMs ? new Date(result.summary.lastSeenAtMs).toLocaleDateString("pt-BR") : "—"],
        ].map(([label,value]) => <div key={String(label)} style={card}><div style={muted}>{label}</div><strong style={{ display: "block", fontSize: 24, marginTop: 6 }}>{value}</strong></div>)}
      </section>
      <section style={{ ...card, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>Sinais para investigação</h2>
        <ul style={{ ...muted, lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>{insights(result).map(x => <li key={x}>{x}</li>)}</ul>
      </section>
      <section style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Linha do tempo · {events.length} eventos</h2>
          <span style={muted}>Mais recentes primeiro</span>
        </div>
        {result.timeline.truncated && <p role="status" style={{ color: "var(--attention, #fbbf24)", fontSize: 13 }}>Histórico limitado a 1.000 eventos; este período pode estar incompleto.</p>}
        {!events.length ? <p style={muted}>Ainda não há eventos ligados a esse telefone neste período.</p> :
          <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 8 }}>
            {events.map(e => <li key={e.eventId} style={{ display: "grid", gridTemplateColumns: "minmax(135px,180px) 1fr", gap: 12, borderTop: "1px solid var(--border, rgba(255,255,255,.1))", padding: "11px 0" }}>
              <time style={{ ...muted, fontVariantNumeric: "tabular-nums" }}>{new Date(e.occurredAtMs).toLocaleString("pt-BR")}</time>
              <div><strong style={{ fontSize: 14 }}>{pretty(e)}</strong><div style={muted}>{[e.context.screen, e.context.source, e.context.target].filter(Boolean).join(" · ") || "sem contexto adicional"}</div></div>
            </li>)}
          </ol>}
      </section>
      <p style={{ ...muted, marginTop: 14 }}>Os registros mostram o que foi instrumentado e ajudam a reproduzir o problema. Ausência de evento não prova que a ação não ocorreu; navegador, rede e falhas fora dos pontos instrumentados podem não aparecer.</p>
    </>}
  </main>;
}
