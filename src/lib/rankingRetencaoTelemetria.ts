// Telemetria de INTERAÇÃO client-side da experiência de retenção do Ranking
// do Chefe (quem JÁ participa) — cliques e visualizações que só existem no
// navegador (abrir a tela, ver a disputa, clicar num CTA). Domínio novo e
// aditivo — não reaproveita `telemetria()`/`/api/cliente/telemetria`, que é
// explicitamente temporária (diagnóstico da migração Perfil 3.0).
//
// Importante: FATOS de negócio (indicação convertida, subiu de posição,
// entrou no Top 10/Top 3, missão concluída, bônus aplicado, participação
// revogada) NUNCA são registrados aqui — o navegador não pode ser
// autoridade sobre um fato. Esses vivem em rankingGamificacaoFatos.ts,
// gravados no servidor no exato instante em que o fato acontece, de forma
// idempotente (SET NX por eventoId). Ver correção do #445.
//
// Sem PII por construção: só contadores agregados por tipo e por dia — nunca
// uma chave com clienteId, telefone ou nome. Correção do #445: a versão
// anterior usava o padrão GET array inteiro → append → SET array inteiro,
// que não é atômico sob concorrência (duas requisições simultâneas podem se
// sobrescrever, perdendo um evento). Agora cada incremento é um INCR
// atômico numa chave por (tipo, dia) — sem lista, sem corrida, bounded por
// TTL (nunca cresce para sempre).

import "server-only";
import { redis } from "./redis";

export const TIPOS_EVENTO_RANKING_RETENCAO = [
  "ranking_aberto",
  "ranking_retorno",
  "disputa_visualizada",
  "cta_subir_clicado",
  "indicacao_clicada",
  "link_indicacao_gerado",
  "compartilhamento_clicado",
] as const;

export type EventoRankingRetencao = (typeof TIPOS_EVENTO_RANKING_RETENCAO)[number];

const TTL_SEGUNDOS = 400 * 24 * 60 * 60;

function dataReferenciaUtc(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}

function chaveContadorDoDia(tenantId: string, tipo: EventoRankingRetencao, dia: string): string {
  return `ranking:retencao:contador:${tenantId}:${tipo}:${dia}`;
}

export function eventoRankingRetencaoValido(tipo: unknown): tipo is EventoRankingRetencao {
  return typeof tipo === "string" && (TIPOS_EVENTO_RANKING_RETENCAO as readonly string[]).includes(tipo);
}

/**
 * Best-effort e anônimo — nunca lança, nunca recebe identificador de
 * cliente. Um contador atômico por (tenant, tipo, dia); uma falha de Redis
 * aqui nunca pode derrubar a tela do ranking.
 */
export async function registrarEventoRankingRetencao(
  tenantId: string,
  tipo: EventoRankingRetencao,
  agora: Date = new Date(),
): Promise<void> {
  if (!tenantId || !eventoRankingRetencaoValido(tipo)) return;
  try {
    const chave = chaveContadorDoDia(tenantId, tipo, dataReferenciaUtc(agora));
    await redis.incr(chave);
    await redis.expire(chave, TTL_SEGUNDOS);
  } catch {
    // Telemetria nunca pode quebrar a experiência do participante.
  }
}
