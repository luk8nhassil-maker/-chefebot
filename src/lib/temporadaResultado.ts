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
//   renderizados). Para entrar no resultado público final, o cliente precisa
//   ter aceitado a regra do jogo secreto. Durante os 30 dias de revelação,
//   sair do Ranking remove a pessoa da classificação pública e os demais são
//   reindexados; o snapshot interno continua imutável para auditoria.

import "server-only";

import { redis } from "./redis";
import { obterTemporada, type ConfigTemporada } from "./temporadas";
import { obterRankingCompleto, reindexarPorFiltro, type EntradaRanking } from "./rankingClientes";
import { buscarClientePorId, normalizarNomeCliente } from "./clientes";
import { obterRegrasJogoSecretoParaClientes } from "./consentimentoRanking";
import {
  codinomeSecretoRanking,
  fimJanelaRevelacao,
  janelaRevelacaoAtiva,
  REGRA_JOGO_SECRETO_VERSAO,
} from "./rankingJogoSecreto";

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
  regraJogoVersao?: typeof REGRA_JOGO_SECRETO_VERSAO;
  revelacaoAte?: string | null;
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
  const regrasJogo = await obterRegrasJogoSecretoParaClientes(completo.map((e) => e.clienteId));
  const participantes = reindexarPorFiltro(
    completo,
    (id) => {
      const regra = regrasJogo.get(id);
      return regra?.participa === true && regra.aceitaRevelacao30d === true;
    },
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
    regraJogoVersao: REGRA_JOGO_SECRETO_VERSAO,
    revelacaoAte: fimJanelaRevelacao(config.encerradaEm ?? new Date().toISOString()),
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

export type IdentidadeResultadoRanking = {
  participaCampanha: boolean;
  nomePublico: string | null;
  telefoneMascarado: null;
  fotoPerfilUrl: string | null;
  codinomeSecreto: string;
  revelado: boolean;
};

export type EntradaResultadoProjetada = {
  posicao: number;
  score: number;
  identidade: IdentidadeResultadoRanking;
};

export type ResultadoTemporadaProjetado = Omit<ResultadoTemporada, "participantesTopo" | "geralTopo"> & {
  vencedores: EntradaResultadoProjetada[];
  participantesTopo: EntradaResultadoProjetada[];
};

/**
 * Projeta o resultado público do jogo secreto. Durante a janela de 30 dias,
 * só permanece na classificação quem continua no Ranking e mantém a regra
 * de revelação aceita. Fora da janela, a projeção volta aos codinomes.
 */
export async function projetarResultadoTemporada(
  resultado: ResultadoTemporada,
  agora = Date.now(),
): Promise<ResultadoTemporadaProjetado> {
  const ids = resultado.participantesTopo.map((e) => e.clienteId);
  const regras = await obterRegrasJogoSecretoParaClientes(ids);
  const revelar = janelaRevelacaoAtiva(resultado.encerradaEm, agora);

  const projetados = await Promise.all(resultado.participantesTopo.map(async (e) => {
    const regra = regras.get(e.clienteId);
    const mantemPosicao = regra?.participa === true && regra.aceitaRevelacao30d === true;
    const codinomeSecreto = codinomeSecretoRanking(e.clienteId, resultado.temporadaId);

    let nomePublico: string | null = null;
    let fotoPerfilUrl: string | null = null;
    let revelado = false;

    if (revelar && mantemPosicao) {
      const cliente = await buscarClientePorId(e.clienteId).catch(() => null);
      if (cliente) {
        const nome = normalizarNomeCliente(cliente.nome);
        nomePublico = nome ? nome.split(" ")[0]?.slice(0, 30) || null : null;
        if (cliente.fotoPerfilPathname) {
          fotoPerfilUrl = `/api/cliente/ranking/resultado-foto?temporadaId=${encodeURIComponent(resultado.temporadaId)}&posicao=${e.posicao}`;
        }
        revelado = Boolean(nomePublico || fotoPerfilUrl);
      }
    }

    return {
      posicao: e.posicao,
      score: e.score,
      identidade: {
        participaCampanha: mantemPosicao,
        nomePublico,
        telefoneMascarado: null as const,
        fotoPerfilUrl,
        codinomeSecreto,
        revelado,
      },
    };
  }));

  const participantesTopo = (revelar
    ? projetados.filter((item) => item.identidade.participaCampanha)
    : projetados
  ).map((item, index) => ({ ...item, posicao: index + 1 }));

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
    regraJogoVersao: resultado.regraJogoVersao ?? REGRA_JOGO_SECRETO_VERSAO,
    revelacaoAte: resultado.revelacaoAte ?? fimJanelaRevelacao(resultado.encerradaEm),
    vencedores,
    participantesTopo,
  };
}

// Reexportado só para o admin poder ler a config vigente junto do resultado
// sem precisar de dois imports separados nas rotas.
export type { ConfigTemporada };
