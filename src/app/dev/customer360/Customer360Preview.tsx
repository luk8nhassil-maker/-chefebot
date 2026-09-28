"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  buildBehaviorSessionInsights,
  buildCustomerBehaviorFeatureVector,
  type BehaviorInsightEvent,
} from "@/lib/behaviorInsights";

const BASE = Date.parse("2026-09-28T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const S4 = "44444444-4444-4444-8444-444444444444";

function ev(
  sessionId: string,
  type: BehaviorInsightEvent["type"],
  createdAtMs: number,
  data: BehaviorInsightEvent["data"] = {},
  authority: BehaviorInsightEvent["authority"] = "client_observed",
): BehaviorInsightEvent {
  return { sessionId, type, createdAtMs, data, authority };
}

const FIXTURE: BehaviorInsightEvent[] = [
  ev(S1, "app_open", BASE - 7 * DAY),
  ev(S1, "page_view", BASE - 7 * DAY + 3_000),
  ev(S1, "search_used", BASE - 7 * DAY + 8_000),
  ev(S1, "product_open", BASE - 7 * DAY + 15_000),
  ev(S1, "cart_add", BASE - 7 * DAY + 22_000),
  ev(S1, "funnel_step", BASE - 7 * DAY + 35_000, { step: "pagamento" }),
  ev(S1, "order_created", BASE - 7 * DAY + 60_000, { orderTotalCents: 6200 }, "server_fact"),
  ev(S2, "app_open", BASE - 4 * DAY),
  ev(S2, "page_view", BASE - 4 * DAY + 2_000),
  ev(S2, "product_open", BASE - 4 * DAY + 12_000),
  ev(S2, "cart_add", BASE - 4 * DAY + 20_000),
  ev(S2, "funnel_step", BASE - 4 * DAY + 32_000, { step: "entrega" }),
  ev(S2, "checkout_exit_observed", BASE - 4 * DAY + 50_000, { step: "entrega" }),
  ev(S3, "app_open", BASE - 2 * DAY),
  ev(S3, "ranking_open", BASE - 2 * DAY + 8_000),
  ev(S3, "product_open", BASE - 2 * DAY + 18_000),
  ev(S4, "app_open", BASE - DAY),
  ev(S4, "search_used", BASE - DAY + 7_000),
  ev(S4, "product_open", BASE - DAY + 14_000),
  ev(S4, "cart_add", BASE - DAY + 22_000),
];

const LABEL: Record<string, string> = {
  app_open: "Entrou no app",
  page_view: "Abriu uma página",
  search_used: "Pesquisou",
  product_open: "Interagiu com produto",
  cart_add: "Adicionou ao carrinho",
  cart_remove: "Removeu do carrinho",
  funnel_step: "Avançou no funil",
  checkout_exit_observed: "Saiu durante o checkout",
  ranking_open: "Abriu o Ranking",
  cofre_open: "Abriu o Cofre",
  order_created: "Pedido criado pelo servidor",
  app_background: "Saiu do app",
  app_resume: "Voltou ao app",
};

function money(cents: number | null) {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const shell: CSSProperties = {
  minHeight: "100vh",
  padding: "28px 18px 56px",
  background: "linear-gradient(180deg,#101010,#1b1b1b)",
  color: "#f8f8f8",
  fontFamily: "Arial, sans-serif",
};
const card: CSSProperties = {
  background: "rgba(255,255,255,.06)",
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 20,
  padding: 18,
};

export default function Customer360Preview() {
  const [selected, setSelected] = useState(S2);
  const sessions = useMemo(() => buildBehaviorSessionInsights(FIXTURE), []);
  const vector = useMemo(() => buildCustomerBehaviorFeatureVector(FIXTURE), []);
  const session = sessions.find((item) => item.sessionId === selected) ?? sessions[0];
  const events = FIXTURE
    .filter((event) => event.sessionId === session?.sessionId)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  return (
    <main style={shell}>
      <div style={{ width: "min(1100px,100%)", margin: "0 auto" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#ffcf21" }}>PREVIEW · DADOS FICTÍCIOS</span>
        <h1 style={{ fontSize: "clamp(32px,6vw,58px)", lineHeight: .98, maxWidth: 850 }}>
          Customer 360: a jornada antes do pedido passa a ser visível.
        </h1>
        <p style={{ color: "#bbb", maxWidth: 800, lineHeight: 1.6 }}>
          Este Preview não grava Redis, não lê clientes reais e não chama integrações externas.
          A coleta real continua desligada.
        </p>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10, margin: "24px 0" }}>
          {[
            ["Sessões", vector.sessions],
            ["Sem pedido", vector.sessionsWithoutOrder],
            ["Carrinho sem pedido", vector.sessionsWithCartWithoutOrder],
            ["Checkout sem pedido", vector.sessionsWithCheckoutWithoutOrder],
            ["Conversão", vector.conversionRatePct + "%"],
            ["Desde a compra", vector.sessionsSinceLastOrder],
          ].map(([label, value]) => (
            <article style={card} key={String(label)}>
              <span style={{ color: "#aaa", fontSize: 12 }}>{label}</span>
              <strong style={{ display: "block", marginTop: 6, fontSize: 26 }}>{value}</strong>
            </article>
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(240px,.7fr) minmax(0,1.3fr)", gap: 14 }}>
          <article style={card}>
            <strong>Visitas do cliente</strong>
            <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
              {sessions.map((item, index) => (
                <button
                  key={item.sessionId}
                  type="button"
                  onClick={() => setSelected(item.sessionId)}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    borderRadius: 14,
                    border: item.sessionId === session?.sessionId ? "1px solid #ffcf21" : "1px solid rgba(255,255,255,.1)",
                    background: item.sessionId === session?.sessionId ? "rgba(255,207,33,.12)" : "rgba(0,0,0,.16)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <b>Visita {index + 1}</b>
                  <span style={{ display: "block", color: "#aaa", marginTop: 4 }}>
                    {item.converted ? "Converteu" : item.depth} · {item.durationSec}s
                  </span>
                </button>
              ))}
            </div>
          </article>

          <article style={card}>
            <strong>Linha do tempo da visita</strong>
            <h2>{session?.converted ? "Terminou em pedido" : "Não terminou em pedido"}</h2>
            <p style={{ color: "#aaa" }}>
              Profundidade: {session?.depth}
              {session?.orderTotalCents !== null ? " · pedido " + money(session?.orderTotalCents ?? null) : ""}
            </p>
            <div style={{ display: "grid", gap: 9 }}>
              {events.map((event, index) => (
                <div
                  key={event.sessionId + "-" + event.createdAtMs + "-" + index}
                  style={{ display: "grid", gridTemplateColumns: "12px 1fr auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.07)" }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ffcf21" }} />
                  <div>
                    <b>{LABEL[event.type] ?? event.type}</b>
                    <small style={{ display: "block", color: "#999", marginTop: 3 }}>
                      {new Date(event.createdAtMs).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </small>
                  </div>
                  <small style={{ color: event.authority === "server_fact" ? "#9ee6a1" : "#aaa" }}>
                    {event.authority === "server_fact" ? "Servidor" : "Observado"}
                  </small>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section style={{ ...card, marginTop: 14 }}>
          <strong>Vetor comportamental</strong>
          <p style={{ color: "#aaa" }}>A máquina aprende sinais; não inventa desconto.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <span>Buscas <b>{vector.searches}</b></span>
            <span>Produtos <b>{vector.productOpens}</b></span>
            <span>Carrinho <b>{vector.cartAdds}</b></span>
            <span>Ranking <b>{vector.rankingOpens}</b></span>
            <span>Saídas checkout <b>{vector.checkoutExitObserved}</b></span>
          </div>
        </section>
      </div>
    </main>
  );
}
