// Transição entre temporadas da Gamificação V2: vantagem de largada
// (carryover) e status social (Campeão/Prata/Bronze/Elite) herdado do Top 10
// da temporada anterior para a temporada nova.
//
// Padrão de avaliação: igual ao auto-expiry de temporadas.ts — não existe
// cron. Cada leitura do painel do cliente (um por vez, nunca em lote) chama
// as funções abaixo; a idempotência de cada uma garante que reprocessar não
// tem custo nem risco (SET NX no ledger de bônus / comparação de origem no
// status social).
import "server-only";
import { redis } from "./redis";
import { listarTemporadas, type ConfigTemporada } from "./temporadas";
import { obterResultadoTemporada } from "./temporadaResultado";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { calcularBonusCarryover, calcularStatusPorPosicao, type StatusTemporada } from "./rankingGamificacao";
import { creditarBonusCompeticao } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporada";

/**
 * Encontra a temporada mais recentemente ENCERRADA antes da temporada atual
 * ter sido ativada. Nunca escolhe a própria temporada atual nem uma futura —
 * sem isso, "temporada anterior" fica indefinido e nada de transição roda
 * (fail-closed).
 */
export async function obterTemporadaAnteriorEncerrada(
  tenantId: string,
  temporadaAtual: ConfigTemporada,
): Promise<ConfigTemporada | null> {
  if (!tenantId || !temporadaAtual.ativadaEm) return null;
  const ativadaEmMs = new Date(temporadaAtual.ativadaEm).getTime();
  if (!Number.isFinite(ativadaEmMs)) return null;
  const todas = await listarTemporadas(tenantId);
  const anteriores = todas.filter((t) => {
    if (t.temporadaId === temporadaAtual.temporadaId) return false;
    if (t.estado !== "encerrada" || !t.encerradaEm) return false;
    const encerradaEmMs = new Date(t.encerradaEm).getTime();
    return Number.isFinite(encerradaEmMs) && encerradaEmMs <= ativadaEmMs;
  });
  if (anteriores.length === 0) return null;
  anteriores.sort((a, b) => new Date(b.encerradaEm as string).getTime() - new Date(a.encerradaEm as string).getTime());
  return anteriores[0];
}

/**
 * Aplica a vantagem de largada UMA única vez por (temporada anterior,
 * temporada nova, cliente) — o eventoId do ledger é a própria chave de
 * idempotência, então repetir a chamada (cada leitura do painel) nunca
 * duplica o crédito. Sem config de carryover ativa, ou sem o cliente ter
 * ficado no Top 10 da temporada anterior, não credita nada.
 */
export async function aplicarCarryoverClienteSeNecessario(
  tenantId: string,
  temporadaAtual: ConfigTemporada,
  clienteId: string,
): Promise<void> {
  if (!clienteId) return;
  const config = await obterConfigGamificacao();
  if (!config.carryoverAtivo) return;
  const anterior = await obterTemporadaAnteriorEncerrada(tenantId, temporadaAtual);
  if (!anterior) return;
  const resultado = await obterResultadoTemporada(tenantId, anterior.temporadaId);
  if (!resultado) return;
  const entrada = resultado.participantesTopo.find((e) => e.clienteId === clienteId && e.posicao <= 10);
  if (!entrada) return;
  const bonus = calcularBonusCarryover(entrada.posicao, config.carryoverTabela);
  if (bonus <= 0) return;
  const resultadoCredito = await creditarBonusCompeticao({
    tenantId,
    temporadaId: temporadaAtual.temporadaId,
    clienteId,
    eventoId: `carryover:${anterior.temporadaId}:${temporadaAtual.temporadaId}:${clienteId}`,
    tipo: "carryover",
    pontos: bonus,
    motivo: `Vantagem de largada — #${entrada.posicao} na temporada anterior`,
  });
  if (resultadoCredito === "creditado") {
    await sincronizarScoreTemporadaComBonus(tenantId, temporadaAtual.temporadaId, clienteId);
  }
}

export type StatusSocialVigente = {
  status: StatusTemporada;
  /** Temporada encerrada de onde esse status veio — usado só para saber se já sincronizou esta transição. */
  temporadaOrigemId: string;
  atribuidoEm: string;
};

function chaveStatusSocial(tenantId: string, clienteId: string): string {
  return `ranking:statusSocial:${tenantId}:${clienteId}`;
}

export async function obterStatusSocialVigente(tenantId: string, clienteId: string): Promise<StatusSocialVigente | null> {
  if (!tenantId || !clienteId) return null;
  return redis.get<StatusSocialVigente>(chaveStatusSocial(tenantId, clienteId));
}

/**
 * Sincroniza o status social (Campeão/Prata/Bronze/Elite) a partir do
 * resultado arquivado da temporada anterior. Só recalcula quando a origem
 * mudou (nova temporada encerrou desde a última sincronização) — leituras
 * repetidas dentro da mesma transição são no-op. Dispara o fato
 * "virou_campeao" só na transição em que o status vira campeão pela
 * primeira vez (nunca em toda leitura).
 */
export async function sincronizarStatusSocialCliente(
  tenantId: string,
  temporadaAtual: ConfigTemporada,
  clienteId: string,
): Promise<StatusSocialVigente | null> {
  if (!clienteId) return null;
  const anterior = await obterTemporadaAnteriorEncerrada(tenantId, temporadaAtual);
  const atual = await obterStatusSocialVigente(tenantId, clienteId);
  if (!anterior) return atual;
  if (atual && atual.temporadaOrigemId === anterior.temporadaId) return atual;

  const resultado = await obterResultadoTemporada(tenantId, anterior.temporadaId);
  const entrada = resultado?.participantesTopo.find((e) => e.clienteId === clienteId);
  const status = calcularStatusPorPosicao(entrada?.posicao ?? null);
  const novo: StatusSocialVigente = { status, temporadaOrigemId: anterior.temporadaId, atribuidoEm: new Date().toISOString() };
  await redis.set(chaveStatusSocial(tenantId, clienteId), novo);

  if (status === "campeao") {
    await registrarFatoRankingGamificacao("virou_campeao", `${clienteId}:${anterior.temporadaId}`);
  }
  return novo;
}
