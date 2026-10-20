import "server-only";

import { obterElegibilidadeRankingNoCorte } from "../consentimentoRanking";
import { obterRankingCompleto, type EntradaRanking } from "../rankingClientes";
import { obterResgatePremio } from "../temporadaPremioResgate";
import { obterResultadoTemporada } from "../temporadaResultado";
import { obterTemporada } from "../temporadas";
import { redis } from "../redis";
import { Ranking3Store, type BancoRanking3 } from "./store";
import type { Premio } from "./domain";

export const PRIMEIRA_TEMPORADA_HISTORICA = "t-1789830947840";

export type AuditoriaPremioHistorico =
  | { estado: "sem_vencedor_elegivel" | "resultado_historico_ja_existe" | "resgate_legado_ja_existe"; temporadaId: string }
  | { estado: "pronto_para_conceder"; temporadaId: string; vencedor: EntradaRanking; corteEm: string }
  | { estado: "concedido"; temporadaId: string; vencedor: EntradaRanking; corteEm: string; premio: Premio };

/**
 * Apura o vencedor sem materializar `temporada:resultado`. A lista chega
 * previamente ordenada pelo ranking legado (score, primeiro crédito, ID), e
 * a elegibilidade é lida no corte, não no estado atual de privacidade.
 */
export async function auditarPrimeiroParticipanteLegitimo(
  tenantId = "default",
  temporadaId = PRIMEIRA_TEMPORADA_HISTORICA,
  deps: {
    temporada?: typeof obterTemporada;
    resultado?: typeof obterResultadoTemporada;
    ranking?: typeof obterRankingCompleto;
    elegivel?: typeof obterElegibilidadeRankingNoCorte;
    resgate?: typeof obterResgatePremio;
    store?: Ranking3Store;
  } = {},
): Promise<AuditoriaPremioHistorico> {
  if (tenantId !== "default" || temporadaId !== PRIMEIRA_TEMPORADA_HISTORICA) throw new Error("temporada_historica_nao_autorizada");
  const temporada = await (deps.temporada ?? obterTemporada)(tenantId, temporadaId);
  if (!temporada || temporada.estado !== "encerrada" || !temporada.fimEm || !Number.isFinite(Date.parse(temporada.fimEm))) throw new Error("temporada_historica_invalida");
  if (await (deps.resultado ?? obterResultadoTemporada)(tenantId, temporadaId)) return { estado: "resultado_historico_ja_existe", temporadaId };

  const corteMs = Date.parse(temporada.fimEm);
  const ranking = await (deps.ranking ?? obterRankingCompleto)(tenantId, temporadaId);
  for (const entrada of ranking) {
    if (!await (deps.elegivel ?? obterElegibilidadeRankingNoCorte)(entrada.clienteId, corteMs)) continue;
    if (await (deps.resgate ?? obterResgatePremio)(tenantId, temporadaId, entrada.clienteId)) {
      return { estado: "resgate_legado_ja_existe", temporadaId };
    }
    const store = deps.store ?? new Ranking3Store(redis as unknown as BancoRanking3, tenantId);
    const id = `r3-legado-${temporadaId}-liga-1`;
    const existente = await store.premio(id);
    if (existente) {
      if (existente.clienteId !== entrada.clienteId || existente.origem !== "excecao_historica") throw new Error("concessao_historica_inconsistente");
      return { estado: "concedido", temporadaId, vencedor: entrada, corteEm: temporada.fimEm, premio: existente };
    }
    return { estado: "pronto_para_conceder", temporadaId, vencedor: entrada, corteEm: temporada.fimEm };
  }
  return { estado: "sem_vencedor_elegivel", temporadaId };
}

export async function concederPremioExcepcionalPrimeiraTemporada(
  tenantId = "default",
  deps: Parameters<typeof auditarPrimeiroParticipanteLegitimo>[2] = {},
): Promise<AuditoriaPremioHistorico> {
  const auditoria = await auditarPrimeiroParticipanteLegitimo(tenantId, PRIMEIRA_TEMPORADA_HISTORICA, deps);
  if (auditoria.estado !== "pronto_para_conceder") return auditoria;
  const store = deps.store ?? new Ranking3Store(redis as unknown as BancoRanking3, tenantId);
  const { premio } = await store.concederExcecaoHistorica({
    temporadaId: auditoria.temporadaId,
    clienteId: auditoria.vencedor.clienteId,
    posicao: auditoria.vencedor.posicao,
    score: auditoria.vencedor.score,
    corteEm: auditoria.corteEm,
  });
  return { ...auditoria, estado: "concedido", premio };
}
