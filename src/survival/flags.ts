// Feature flags do Modo Sobrevivência 1.0 — todas desligadas por padrão.
// Não são segredos (não precisam ficar fora do log/inspeção). Cada uma só
// liga uma camada adicional de resiliência; com todas "false"/ausentes o
// comportamento do sistema é idêntico ao de antes deste programa.
//
// Mesmo padrão já usado em src/app/api/dev/infra/route.ts (`isFeatureEnabled`)
// e em src/app/api/cron/mcp-observer/route.ts (`MCP_MODE`): leitura direta
// de process.env, comparação estrita, sem cache — não existe um sistema de
// feature flags central no projeto, então não criamos um framework novo,
// só seguimos a convenção existente.

/** Ativa o núcleo do Modo Sobrevivência (modelo de estados, idempotência de
 * criação de pedido). Ainda não ativa fallback manual nem redução de carga. */
export function survivalModeEnabled(): boolean {
  return process.env.SURVIVAL_MODE_ENABLED === "true";
}

/** Ativa a experiência de fallback manual pelo WhatsApp (Etapa 2). */
export function survivalManualFallbackEnabled(): boolean {
  return process.env.SURVIVAL_MANUAL_FALLBACK_ENABLED === "true";
}

/** Ativa a redução de carga/circuit breakers de atividades não essenciais (Etapa 3). */
export function survivalLoadSheddingEnabled(): boolean {
  return process.env.SURVIVAL_LOAD_SHEDDING_ENABLED === "true";
}

/**
 * Ativa a REJEIÇÃO (400) de um `clientRequestId` presente porém inválido
 * (fora do formato de `sanitizeClientRequestId`) quando SURVIVAL_MODE_ENABLED
 * também está ligado — revisão de segurança, 4ª rodada, ponto 5. Separada de
 * `survivalModeEnabled` de propósito: permite ativar o núcleo de idempotência
 * (PR1/PR2) sem quebrar clientes antigos que ainda não geram/enviam um
 * clientRequestId ou enviam um formato desatualizado — a ausência do campo
 * NUNCA é rejeitada por esta flag (só um valor presente e malformado).
 * Padrão `false`: com o núcleo ligado mas esta flag desligada, um
 * clientRequestId inválido é apenas ignorado (comportamento pré-existente,
 * sem proteção de idempotência para aquela tentativa, mas o pedido continua
 * sendo criado normalmente).
 */
export function survivalClientRequestIdEnforcementEnabled(): boolean {
  return process.env.SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED === "true";
}

export type SurvivalForcedMode = "off" | "degraded" | "manual";

const FORCED_MODES: readonly SurvivalForcedMode[] = ["off", "degraded", "manual"];

/**
 * CHEFEBOT_SURVIVAL_MODE=off|degraded|manual — ativação manual de
 * emergência (fora do escopo de qualquer detecção automática). Padrão e
 * fallback de valor desconhecido são sempre "off": um erro de digitação na
 * env var nunca deve forçar silenciosamente um modo degradado.
 */
export function survivalForcedMode(): SurvivalForcedMode {
  const raw = (process.env.CHEFEBOT_SURVIVAL_MODE || "").trim().toLowerCase();
  return (FORCED_MODES as string[]).includes(raw) ? (raw as SurvivalForcedMode) : "off";
}
