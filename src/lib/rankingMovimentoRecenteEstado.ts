// "Movimento recente" — conceito SEPARADO do snapshot diário auditável de
// rankingHistorico.ts (que continua servindo o "subiu/desceu desde ontem").
// Este módulo compara a posição atual com a ÚLTIMA VEZ que o cliente abriu
// o painel, seja isso há 5 minutos ou há 3 semanas — nunca chama isso de
// "desde ontem" quando a referência real é outra data. Correção da
// auditoria do #446: "não inventar" força a UI a mostrar a data real da
// última visita quando quiser exibir esse selo.
import "server-only";
import { redis } from "./redis";
import { calcularVariacaoPosicao, type VariacaoPosicao } from "./rankingHistorico";

type UltimaVisualizacao = { posicao: number; em: string };

function chave(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:movimentoRecente:${tenantId}:${temporadaId}:${clienteId}`;
}

export type MovimentoRecente = { variacao: VariacaoPosicao; desde: string };

/**
 * Compara a posição atual com a marca da visita anterior e atualiza a marca
 * para a posição atual (a PRÓXIMA leitura vai comparar contra esta). `null`
 * na primeira visita (nunca há uma "anterior" para comparar) ou em
 * parâmetros inválidos.
 */
export async function sincronizarMovimentoRecente(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
  posicaoAtual: number,
): Promise<MovimentoRecente | null> {
  if (!tenantId || !temporadaId || !clienteId || !Number.isFinite(posicaoAtual)) return null;
  const chaveRegistro = chave(tenantId, temporadaId, clienteId);
  const anterior = await redis.get<UltimaVisualizacao>(chaveRegistro);
  await redis.set(chaveRegistro, { posicao: posicaoAtual, em: new Date().toISOString() } satisfies UltimaVisualizacao);
  if (!anterior) return null;
  const variacao = calcularVariacaoPosicao(anterior.posicao, posicaoAtual);
  if (!variacao) return null;
  return { variacao, desde: anterior.em };
}
