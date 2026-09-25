// Resultado imutável de uma temporada encerrada — snapshot do ranking no
// momento do encerramento, com pódio "Valendo prêmio" e decisão de vencedor.
//
// Regras centrais:
// - O snapshot é gravado UMA única vez por temporada (SET NX) e nunca é
//   reescrito depois — nem por um segundo encerramento, nem por uma leitura
//   repetida, nem por mudança posterior de configuração da temporada.
// - "Vencedor" só existe quando o admin aprovou explicitamente o prêmio
//   (`premioAprovado === true`) E definiu quantos premiados existem
//   (`premioQuantidadePremiados > 0`) ANTES do encerramento. Sem isso, o
//   resultado é arquivado como "sem vencedor declarado" — nunca inventamos
//   prêmio, quantidade de premiados ou descrição.
// - O snapshot guarda só clienteId/score/posicao (nunca nome/telefone
//   renderizados). Identidade pública é reprojetada em CADA leitura a partir
//   do consentimento ATUAL — se alguém revogar depois, o resultado
//   arquivado passa a mostrar essa pessoa anonimizada também, do mesmo jeito
//   que o ranking ao vivo já funciona. Isso preserva a regra de produto
//   ("retirar autorização tira da próxima leitura") mesmo em dados
//   históricos, sem precisar reescrever o snapshot.

import "server-only";

import { redis } from "./redis";
import { obterTemporada, type ConfigTemporada } from "./temporadas";
import { obterRankingCompleto, reindexarPorFiltro, type EntradaRanking } from "./rankingClientes";
import { projetarIdentidadesPublicasRanking, type IdentidadePublicaRanking } from "./rankingPrivacidade";

const LIMITE_ARQUIVADO = 50;

export type ResultadoTemporada = {
  tenantId: string;
  temporadaId: string;
  encerradaEm: string;
  // Cópia da configuração de prêmio vigente NO MOMENTO do encerramento —
  // mudar a config depois de encerrada nunca altera um resultado já gravado.
  premioDescricao: string | null;
  premioQuantidadePremiados: number | null;
  premioAprovado: boolean;
  vencedorDeclarado: boolean;
  // Top participantes (quem "vale prêmio"), reindexado 1..N só entre quem
  // autorizou — os primeiros `premioQuantidadePremiados` são os vencedores
  // quando vencedorDeclarado === true.
  participantesTopo: EntradaRanking[];
  // Top geral, só para contexto/auditoria — nunca usado para decidir vencedor.
  geralTopo: EntradaRanking[];
};

function chaveResultado(tenantId: string, temporadaId: string): string {
  return `temporada:resultado:${tenantId}:${temporadaId}`;
}

export async function obterResultadoTemporada(
  tenantId: string,
  temporadaId: string,
): Promise<ResultadoTemporada | null> {
  if (!tenantId || !temporadaId) return null;
  return redis.get<ResultadoTemporada>(chaveResultado(tenantId, temporadaId));
}

/**
 * Garante que uma temporada ENCERRADA tem um resultado arquivado. Idempotente
 * e seguro para chamar de qualquer caminho que possa fechar uma temporada
 * (ação manual do admin ou auto-expiry lazy de temporadas.ts) — só a
 * primeira chamada realmente grava; as demais são no-op.
 *
 * Retorna `null` quando a temporada não existe ou ainda não está encerrada
 * (nunca arquiva o resultado de uma temporada em andamento).
 */
export async function garantirResultadoTemporada(
  tenantId: string,
  temporadaId: string,
): Promise<ResultadoTemporada | null> {
  if (!tenantId || !temporadaId) return null;
  const config = await obterTemporada(tenantId, temporadaId);
  if (!config || config.estado !== "encerrada") return null;

  const existente = await obterResultadoTemporada(tenantId, temporadaId);
  if (existente) return existente;

  const completo = await obterRankingCompleto(tenantId, temporadaId);
  const identidades = await projetarIdentidadesPublicasRanking(completo.map((e) => e.clienteId));
  const participantes = reindexarPorFiltro(
    completo,
    (id) => identidades.get(id)?.participaCampanha === true,
  );

  const premioAprovado = config.premioAprovado === true;
  const qtd = Number.isFinite(config.premioQuantidadePremiados) && (config.premioQuantidadePremiados ?? 0) > 0
    ? Math.round(config.premioQuantidadePremiados as number)
    : null;
  const vencedorDeclarado = premioAprovado && qtd !== null && participantes.length > 0;

  const resultado: ResultadoTemporada = {
    tenantId,
    temporadaId,
    encerradaEm: config.encerradaEm ?? new Date().toISOString(),
    premioDescricao: config.premioDescricao ?? null,
    premioQuantidadePremiados: qtd,
    premioAprovado,
    vencedorDeclarado,
    participantesTopo: participantes.slice(0, LIMITE_ARQUIVADO),
    geralTopo: completo.slice(0, LIMITE_ARQUIVADO),
  };

  // SET NX: se duas chamadas concorrentes calcularem ao mesmo tempo (ex.:
  // dois admins abrindo a tela junto), só a primeira grava — a segunda lê de
  // volta o que já foi persistido, nunca sobrescreve.
  const gravou = await redis.set(chaveResultado(tenantId, temporadaId), resultado, { nx: true });
  if (gravou) return resultado;
  return (await obterResultadoTemporada(tenantId, temporadaId)) ?? resultado;
}

export type EntradaResultadoProjetada = {
  posicao: number;
  score: number;
  identidade: IdentidadePublicaRanking;
};

export type ResultadoTemporadaProjetado = Omit<ResultadoTemporada, "participantesTopo" | "geralTopo"> & {
  vencedores: EntradaResultadoProjetada[];
  participantesTopo: EntradaResultadoProjetada[];
};

/**
 * Reprojeta identidades a partir do consentimento ATUAL (nunca do momento do
 * encerramento) — quem revogou depois de ganhar deixa de ser exibido com
 * nome/telefone aqui também, exatamente como no ranking ao vivo.
 */
export async function projetarResultadoTemporada(
  resultado: ResultadoTemporada,
): Promise<ResultadoTemporadaProjetado> {
  const ids = resultado.participantesTopo.map((e) => e.clienteId);
  const identidades = await projetarIdentidadesPublicasRanking(ids);
  const participantesTopo = resultado.participantesTopo.map((e) => ({
    posicao: e.posicao,
    score: e.score,
    identidade: identidades.get(e.clienteId) ?? {
      participaCampanha: false,
      nomePublico: null,
      telefoneMascarado: null,
      fotoPerfilUrl: null,
    },
  }));
  const vencedores = resultado.vencedorDeclarado && resultado.premioQuantidadePremiados
    ? participantesTopo.slice(0, resultado.premioQuantidadePremiados)
    : [];

  return {
    tenantId: resultado.tenantId,
    temporadaId: resultado.temporadaId,
    encerradaEm: resultado.encerradaEm,
    premioDescricao: resultado.premioDescricao,
    premioQuantidadePremiados: resultado.premioQuantidadePremiados,
    premioAprovado: resultado.premioAprovado,
    vencedorDeclarado: resultado.vencedorDeclarado,
    vencedores,
    participantesTopo,
  };
}

// Reexportado só para o admin poder ler a config vigente junto do resultado
// sem precisar de dois imports separados nas rotas.
export type { ConfigTemporada };
