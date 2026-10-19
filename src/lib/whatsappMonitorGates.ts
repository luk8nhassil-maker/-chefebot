// Avaliação informativa: nunca altera rollout, agenda, Redis ou fase aprovada.
export type MonitorMetrics = {
  pending: number; inFlight: number; ambiguous: number; unresolved: number;
  queued: number | null; accepted: number | null; failed: number | null;
  recovered: number | null; closedCanaryNoRetry?: number | null; oldestWaitingMs: number | null;
};
export type CanaryEvidence = { state: string | null; outboundHttpStatus: number | null; outboxAccepted: boolean | null };
export type MonitorEvidence = {
  stage: number; mode: string; qstashConfigured: boolean; workerRecentlyConfirmed: boolean | null;
  redisOk: boolean; evolutionConnected: boolean | null;
  canary: CanaryEvidence; metrics: MonitorMetrics; inboxGradualSupported?: boolean;
};
export type GateResult = { step: number; title: string; passed: boolean; checks: Array<{ text: string; ok: boolean | null }> };

export function avaliarGatesWhatsApp(e: MonitorEvidence): GateResult[] {
  const m = e.metrics;
  const step1 = [
    { text: "Redis disponível para leitura", ok: e.redisOk },
    { text: "Evolution conectada (checagem real)", ok: e.evolutionConnected },
    { text: "QStash configurado (não comprova agenda em execução)", ok: e.qstashConfigured },
    { text: "Canário com ida e volta confirmada", ok: e.canary.state === "roundtrip_ok" },
    { text: "Confirmação HTTP 2xx do canário", ok: e.canary.outboundHttpStatus !== null && e.canary.outboundHttpStatus >= 200 && e.canary.outboundHttpStatus < 300 },
    { text: "Contador real de envios aceitos pela Evolution disponível e positivo", ok: m.accepted === null ? null : m.accepted > 0 },
    { text: "Envio do próprio canário aceito pela outbox", ok: e.canary.outboxAccepted },
  ];
  const step2 = [
    { text: "Ao menos um lease recuperado com evidência", ok: m.recovered === null ? null : m.recovered > 0 },
    { text: "Nenhuma inconsistência pendente de intervenção", ok: m.unresolved === 0 },
    { text: "Nenhum resultado ambíguo aguardando conciliação", ok: m.ambiguous === 0 },
    { text: "Worker executou callback assinado nos últimos 15 minutos", ok: e.workerRecentlyConfirmed },
    { text: "Agenda periódica de 5 minutos comprovada (pendente de integração de leitura do QStash)", ok: null },
  ];
  const step3 = [
    { text: "Mecanismo gradual por lista explícita implementado (não autoriza ativação)", ok: e.inboxGradualSupported === true },
    { text: "Histórico por período para comprovar estabilidade", ok: null },
    { text: "Aprovação humana registrada para ampliação", ok: null },
  ];
  const step4 = [
    { text: "Todos os gates anteriores aprovados e documentados", ok: false },
    { text: "Custos reais e limites dos provedores conferidos", ok: null },
    { text: "Liberação geral aprovada explicitamente", ok: null },
  ];
  return [
    { step: 1, title: "Teste no nosso número", checks: step1, passed: step1.every(c => c.ok === true) },
    { step: 2, title: "Teste de recuperação", checks: step2, passed: step2.every(c => c.ok === true) },
    { step: 3, title: "Liberação gradual", checks: step3, passed: false },
    { step: 4, title: "Liberação geral", checks: step4, passed: false },
  ];
}

export function recomendarAcaoWhatsApp(e: MonitorEvidence): string {
  if (!e.redisOk) return "Verificar conexão ou cota do Redis. Sem leitura confiável, não avance.";
  if (e.mode === "all" && e.stage < 4) return "Alerta: envio geral configurado antes da etapa de liberação geral. Revisar rollout sem alterar automaticamente o serviço.";
  if (e.metrics.pending > 0 && e.workerRecentlyConfirmed === false) return "Fila com mensagens pendentes e sem execução recente do worker. Verificar QStash e callback antes de ampliar.";
  if (e.metrics.unresolved > 0 || e.metrics.ambiguous > 0) return "Investigar os jobs em quarentena e confirmar com o provedor antes de qualquer reenvio. Não repetir automaticamente.";
  if (e.metrics.oldestWaitingMs !== null && e.metrics.oldestWaitingMs > 300000) return "Há mensagens aguardando há mais de 5 minutos. Investigar worker e agenda antes de ampliar.";
  const current = avaliarGatesWhatsApp(e)[Math.max(0, Math.min(3, e.stage - 1))];
  if (current.passed) return "Critérios técnicos visíveis atendidos. Aguardando revisão e aprovação explícita, sem avançar automaticamente.";
  return "Manter a etapa atual. Conferir os critérios pendentes e reunir evidências reais antes de solicitar aprovação.";
}
