// Fatos de negócio da Gamificação V2 do Ranking do Chefe — SEMPRE
// registrados no servidor, nunca a partir do navegador. Diferença central
// para a telemetria de interação (rankingRetencaoTelemetria.ts): um fato diz
// respeito a algo que realmente aconteceu no domínio (indicação convertida,
// subiu de posição, missão concluída, bônus aplicado) e precisa ser
// idempotente — o mesmo fato nunca pode ser contado duas vezes por causa de
// um retry de webhook, reprocessamento de efeito ou uma segunda leitura do
// mesmo snapshot diário.
//
// Correção do #445: a versão anterior de telemetria usava o padrão
// GET array inteiro → append → SET array inteiro, que não é atômico sob
// concorrência (duas escritas simultâneas podem se sobrescrever). Aqui cada
// fato é uma chave própria (SET NX, idempotente e atômica) e o agregado é um
// contador (INCR, atômico), nunca uma lista que cresce sem limite.

import "server-only";
import { redis } from "./redis";

export const TIPOS_FATO_RANKING_GAMIFICACAO = [
  "indicacao_convertida",
  "subiu_posicao",
  "entrou_top10",
  "entrou_top3",
  "chegou_top1",
  "perdeu_lideranca",
  "recuperou_lideranca",
  "participacao_revogada",
  "missao_semanal_desbloqueada",
  "missao_semanal_consumida",
  "missao_indicacao_concluida",
  "bonus_competicao_aplicado",
  "nivel_subiu",
  "virou_campeao",
] as const;

export type FatoRankingGamificacao = (typeof TIPOS_FATO_RANKING_GAMIFICACAO)[number];

// ~13 meses: cobre uma temporada longa mais margem, sem crescer para sempre.
const TTL_SEGUNDOS = 400 * 24 * 60 * 60;

function chaveFato(tipo: FatoRankingGamificacao, eventoId: string): string {
  return `ranking:gamificacao:fato:${tipo}:${eventoId}`;
}

function chaveContador(tipo: FatoRankingGamificacao): string {
  return `ranking:gamificacao:contador:${tipo}`;
}

export function fatoRankingGamificacaoValido(tipo: unknown): tipo is FatoRankingGamificacao {
  return typeof tipo === "string" && (TIPOS_FATO_RANKING_GAMIFICACAO as readonly string[]).includes(tipo);
}

/**
 * Registra um fato de forma idempotente e atômica. `eventoId` deve
 * identificar unicamente a OCORRÊNCIA do fato (ex.:
 * `{clienteId}:{temporadaId}:{dataReferenciaUtc}` para "subiu de posição",
 * ou o eventoId do próprio movimento de crédito para "indicação
 * convertida") — chamar de novo com o mesmo eventoId é sempre um no-op no
 * contador (retorna `false`), nunca conta duas vezes o mesmo fato.
 * Best-effort: uma falha de Redis aqui nunca derruba o fluxo principal.
 */
export async function registrarFatoRankingGamificacao(
  tipo: FatoRankingGamificacao,
  eventoId: string,
): Promise<boolean> {
  if (!fatoRankingGamificacaoValido(tipo) || !eventoId) return false;
  try {
    const gravou = await redis.set(
      chaveFato(tipo, eventoId),
      { criadoEm: new Date().toISOString() },
      { nx: true, ex: TTL_SEGUNDOS },
    );
    if (!gravou) return false;
    await redis.incr(chaveContador(tipo));
    await redis.expire(chaveContador(tipo), TTL_SEGUNDOS);
    return true;
  } catch {
    return false;
  }
}

function chaveJaFoiLider(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:gamificacao:jafoilider:${tenantId}:${temporadaId}:${clienteId}`;
}

/**
 * Marca atomicamente que o cliente alcançou o #1 nesta temporada e informa
 * se essa marca JÁ existia antes desta chamada — usado para distinguir
 * "chegou ao #1" (primeira vez) de "recuperou a liderança" (já tinha sido
 * #1, perdeu, voltou) sem guardar todo o histórico de posições da
 * temporada. Chamar de novo depois de já marcado é um no-op seguro.
 */
export async function marcarLiderancaEVerificarSeJaFoiLider(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<boolean> {
  try {
    const gravou = await redis.set(chaveJaFoiLider(tenantId, temporadaId, clienteId), true, {
      nx: true,
      ex: TTL_SEGUNDOS,
    });
    return !gravou; // SET NX falhou → a chave já existia → já tinha sido líder antes
  } catch {
    return false; // fail-safe: na dúvida, prefere "chegou_top1" a quebrar a leitura do painel
  }
}

/** Agregados de prova (dashboards/dev) — nunca PII, só contagens por tipo. */
export async function obterContadoresFatosRankingGamificacao(): Promise<Record<FatoRankingGamificacao, number>> {
  const chaves = TIPOS_FATO_RANKING_GAMIFICACAO.map((tipo) => chaveContador(tipo));
  const valores = await redis.mget<Array<number | string | null>>(...chaves);
  const resultado = {} as Record<FatoRankingGamificacao, number>;
  TIPOS_FATO_RANKING_GAMIFICACAO.forEach((tipo, index) => {
    resultado[tipo] = Number(valores[index]) || 0;
  });
  return resultado;
}
