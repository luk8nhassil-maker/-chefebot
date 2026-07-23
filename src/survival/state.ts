// Modelo de estados do Modo Sobrevivência — função pura, sem I/O. Este
// módulo nunca chama Redis/Evolution/Mercado Pago nem decide fazer uma
// checagem de rede: ele só classifica sinais já coletados em outro lugar
// (health checks existentes em src/lib/healthChecks.ts, a flag manual de
// emergência). Mantém a decisão testável sem mocks de rede.

export type SurvivalState = "NORMAL" | "DEGRADADO" | "MANUAL" | "INDISPONIVEL";

export type SurvivalSignals = {
  /** Ativação manual explícita via CHEFEBOT_SURVIVAL_MODE. */
  forcedMode: "off" | "degraded" | "manual";
  /** Persistência do pedido (Redis) comprovadamente indisponível/instável
   * na janela observada — nunca inferido de uma única falha isolada. */
  pedidoPersistenceUnhealthy: boolean;
  /** Esta função só roda se o app respondeu; existe como campo explícito
   * para deixar a regra "app fora do ar => INDISPONIVEL" auditável mesmo
   * que no futuro este sinal venha de fora do próprio processo. */
  appReachable: boolean;
};

/**
 * Decide o estado do Modo Sobrevivência a partir dos sinais informados.
 * Prioridade: app inacessível > modo manual (forçado ou por falha real de
 * persistência) > modo degradado forçado > normal. Nunca retorna um estado
 * pior do que os sinais realmente indicam.
 */
export function avaliarEstadoSobrevivencia(signals: SurvivalSignals): SurvivalState {
  if (!signals.appReachable) return "INDISPONIVEL";
  if (signals.forcedMode === "manual") return "MANUAL";
  if (signals.pedidoPersistenceUnhealthy) return "MANUAL";
  if (signals.forcedMode === "degraded") return "DEGRADADO";
  return "NORMAL";
}
