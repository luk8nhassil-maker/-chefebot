import "server-only";

import { randomUUID } from "node:crypto";
import { redis } from "./redis";
import { garantirResultadoTemporada, obterResultadoTemporada } from "./temporadaResultado";

export type StatusResgatePremio = "solicitado";

export type ResgatePremioTemporada = {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  codigoPublico: string;
  descricaoPremio: string;
  posicao: number;
  score: number;
  status: StatusResgatePremio;
  solicitadoEm: string;
};

export type ResultadoSolicitacaoResgate =
  | { ok: true; resgate: ResgatePremioTemporada; jaExistia: boolean }
  | { ok: false; codigo: "resultado_indisponivel" | "premio_nao_aprovado" | "nao_elegivel"; resgate: null };

function chaveResgate(tenantId: string, temporadaId: string, clienteId: string): string {
  return `temporada:premio-resgate:${tenantId}:${temporadaId}:${clienteId}`;
}

function codigoPublico(): string {
  return `PREM-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export async function obterResgatePremio(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<ResgatePremioTemporada | null> {
  if (!tenantId || !temporadaId || !clienteId) return null;
  return redis.get<ResgatePremioTemporada>(chaveResgate(tenantId, temporadaId, clienteId));
}

/**
 * Registra a intenção de resgate somente para o vencedor real arquivado.
 * A chave é única por cliente/temporada e SET NX torna o clique repetido
 * seguro: nunca são criados dois códigos para o mesmo prêmio.
 */
export async function solicitarResgatePremio(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
}): Promise<ResultadoSolicitacaoResgate> {
  const { tenantId, temporadaId, clienteId } = params;
  // O encerramento manual e o encerramento automático usam o mesmo snapshot.
  // Se ele ainda não tiver sido criado, esta chamada o materializa uma vez.
  const resultado = await garantirResultadoTemporada(tenantId, temporadaId);
  if (!resultado) return { ok: false, codigo: "resultado_indisponivel", resgate: null };

  const descricaoPremio = resultado.premioDescricao?.trim() ?? "";
  const quantidadePremiados = resultado.premioQuantidadePremiados ?? 0;
  if (!resultado.vencedorDeclarado || !resultado.premioAprovado || !descricaoPremio || quantidadePremiados < 1) {
    return { ok: false, codigo: "premio_nao_aprovado", resgate: null };
  }

  const vencedor = resultado.participantesTopo.find((entrada) => entrada.clienteId === clienteId);
  if (!vencedor || vencedor.posicao > quantidadePremiados) {
    return { ok: false, codigo: "nao_elegivel", resgate: null };
  }

  const chave = chaveResgate(tenantId, temporadaId, clienteId);
  const existente = await redis.get<ResgatePremioTemporada>(chave);
  if (existente) return { ok: true, resgate: existente, jaExistia: true };

  const candidato: ResgatePremioTemporada = {
    tenantId,
    temporadaId,
    clienteId,
    codigoPublico: codigoPublico(),
    descricaoPremio,
    posicao: vencedor.posicao,
    score: vencedor.score,
    status: "solicitado",
    solicitadoEm: new Date().toISOString(),
  };
  const gravou = await redis.set(chave, candidato, { nx: true });
  if (gravou) return { ok: true, resgate: candidato, jaExistia: false };

  // Outra requisição concorrente ganhou o SET NX. Retorna o mesmo registro
  // para o cliente, em vez de emitir um segundo código.
  const vencedorDaCorrida = await redis.get<ResgatePremioTemporada>(chave);
  return vencedorDaCorrida
    ? { ok: true, resgate: vencedorDaCorrida, jaExistia: true }
    : { ok: false, codigo: "resultado_indisponivel", resgate: null };
}
