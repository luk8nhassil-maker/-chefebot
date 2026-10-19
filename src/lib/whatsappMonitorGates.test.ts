import { describe, expect, test } from "vitest";
import { avaliarGatesWhatsApp, recomendarAcaoWhatsApp, type MonitorEvidence } from "./whatsappMonitorGates";

const base: MonitorEvidence = {
  stage: 1, mode: "canary", qstashConfigured: true, workerRecentlyConfirmed: true, redisOk: true,
  evolutionConnected: true, canary: { state: "roundtrip_ok", outboundHttpStatus: 200, outboxAccepted: true },
  metrics: { pending: 0, inFlight: 0, ambiguous: 0, unresolved: 0, queued: 2, accepted: 2, failed: 0, recovered: 1, oldestWaitingMs: null },
};

describe("painel DEV WhatsApp: critérios conservadores", () => {
  test("jamais promove automaticamente etapas 2, 3 ou 4 sem prova/decisão humana", () => {
    const steps = avaliarGatesWhatsApp(base);
    expect(steps).toHaveLength(4);
    expect(steps[1].passed).toBe(false);
    expect(steps[2].passed).toBe(false);
    expect(steps[3].passed).toBe(false);
  });
  test("ausência de dados impede validar a primeira etapa", () => {
    const data = { ...base, metrics: { ...base.metrics, accepted: null } };
    expect(avaliarGatesWhatsApp(data)[0].passed).toBe(false);
  });
  test("canário não comprovado impede o avanço", () => {
    expect(avaliarGatesWhatsApp({ ...base, canary: { state: "outbound_sent", outboundHttpStatus: 200, outboxAccepted: true } })[0].passed).toBe(false);
  });
  test("mesmo com round-trip, ausência de job do canário na outbox bloqueia o gate", () => {
    expect(avaliarGatesWhatsApp({ ...base, canary: { ...base.canary, outboxAccepted: null } })[0].passed).toBe(false);
  });
  test("falha de Redis gera recomendação de bloqueio", () => {
    expect(recomendarAcaoWhatsApp({ ...base, redisOk: false })).toMatch(/não avance/);
  });
  test("resultados ambíguos exigem revisão, nunca retry automático", () => {
    expect(recomendarAcaoWhatsApp({ ...base, metrics: { ...base.metrics, ambiguous: 1 } })).toMatch(/Não repetir automaticamente/);
  });
  test("modo all antes da liberação gera alerta explícito", () => {
    expect(recomendarAcaoWhatsApp({ ...base, mode: "all" })).toMatch(/Alerta/);
  });
  test("capacidade gradual não aprova janela, etapa ou liberação de clientes", () => {
    const steps = avaliarGatesWhatsApp({ ...base, inboxGradualSupported: true });
    expect(steps[2].checks[0].ok).toBe(true);
    expect(steps[2].passed).toBe(false);
    expect(steps[3].passed).toBe(false);
  });
});
