import "server-only";

import {
  calcularSaldoEstrelas,
  estrelasV1Ativa,
  obterConfigFidelidadePontos,
  obterExtratoPontos,
} from "./fidelidade";
import {
  consultarEventosCliente,
  TENANT_PADRAO_ANALYTICS,
  type EventoAnalitico,
} from "./historicoAnalitico";
import {
  obterParticipacaoRanking,
  obterParticipacaoRankingParaClientes,
} from "./consentimentoRanking";
import {
  obterRankingCompleto,
  reindexarPorFiltro,
} from "./rankingClientes";
import { obterTemporadaAtivaSomenteLeitura } from "./temporadas";
import {
  decidirProximaMelhorAcaoCofre,
  resumirComportamentoCofre,
  type DecisaoCofre,
  type ResumoComportamentalCofre,
} from "./cofreChef";

export type MotivoIndisponibilidadeCofre =
  | "nao_participa_ranking"
  | "estrelas_inativas";

export type CofreClienteReadModel = {
  schemaVersao: 1;
  modo: "somente_leitura";
  disponivel: boolean;
  motivoIndisponibilidade: MotivoIndisponibilidadeCofre | null;
  estrelas: {
    disponiveis: number;
    scoreRankingTemporada: number;
  };
  ranking: {
    temporadaId: string;
    nomeTemporada: string | null;
    posicaoParticipantes: number | null;
    totalParticipantes: number;
  } | null;
  comportamento: ResumoComportamentalCofre | null;
  proximaAcao: DecisaoCofre | null;
  ofertas: [];
  economia: {
    beneficiosFinanceirosLiberados: false;
    motivo: "regras_economicas_nao_aprovadas";
  };
};

const ECONOMIA_BLOQUEADA = {
  beneficiosFinanceirosLiberados: false,
  motivo: "regras_economicas_nao_aprovadas",
} as const;

function bloqueado(motivo: MotivoIndisponibilidadeCofre): CofreClienteReadModel {
  return {
    schemaVersao: 1,
    modo: "somente_leitura",
    disponivel: false,
    motivoIndisponibilidade: motivo,
    estrelas: {
      disponiveis: 0,
      scoreRankingTemporada: 0,
    },
    ranking: null,
    comportamento: null,
    proximaAcao: null,
    ofertas: [],
    economia: ECONOMIA_BLOQUEADA,
  };
}

function eventosParaMotor(eventos: EventoAnalitico[]) {
  return eventos.map((evento) => ({
    pedidoId: evento.pedidoId,
    criadoEmMs: evento.criadoEmMs,
    valorElegivelCents: evento.valorElegivelCents,
    statusAnalitico: evento.statusAnalitico,
  }));
}

/**
 * Read-model do Cofre do Chefe.
 *
 * Invariantes desta fase:
 * - somente leitura;
 * - nenhuma configuração comercial é inferida;
 * - não reserva nem debita Estrelas;
 * - não cria cupom;
 * - não altera Ranking;
 * - não usa telefone/nome/endereço em retorno;
 * - histórico consultado é exclusivamente do cliente autenticado.
 */
export async function obterCofreClienteSomenteLeitura(params: {
  clienteId: string;
  tenantId?: string;
  agoraMs?: number;
}): Promise<CofreClienteReadModel> {
  const tenantId = params.tenantId ?? TENANT_PADRAO_ANALYTICS;
  const agoraMs = Number.isFinite(params.agoraMs) ? Math.max(0, Math.trunc(params.agoraMs as number)) : Date.now();

  const [participaRanking, configFidelidade] = await Promise.all([
    obterParticipacaoRanking(params.clienteId).catch(() => false),
    obterConfigFidelidadePontos(),
  ]);

  if (!participaRanking) return bloqueado("nao_participa_ranking");
  if (!estrelasV1Ativa(configFidelidade)) return bloqueado("estrelas_inativas");

  const [temporada, extrato, eventos] = await Promise.all([
    obterTemporadaAtivaSomenteLeitura(tenantId, new Date(agoraMs)),
    obterExtratoPontos(params.clienteId),
    consultarEventosCliente(tenantId, params.clienteId, 0, agoraMs),
  ]);

  const estrelasDisponiveis = Math.max(0, calcularSaldoEstrelas(extrato));

  let ranking: CofreClienteReadModel["ranking"] = null;
  let scoreRankingTemporada = 0;
  let posicaoParticipantes: number | null = null;

  if (temporada) {
    const completo = await obterRankingCompleto(tenantId, temporada.temporadaId);
    const ids = completo.map((entrada) => entrada.clienteId);
    const participacoes = await obterParticipacaoRankingParaClientes(ids);
    const participantes = reindexarPorFiltro(
      completo,
      (clienteId) => participacoes.get(clienteId) === true,
    );
    const propria = participantes.find((entrada) => entrada.clienteId === params.clienteId) ?? null;

    scoreRankingTemporada = propria?.score ?? 0;
    posicaoParticipantes = propria?.posicao ?? null;
    ranking = {
      temporadaId: temporada.temporadaId,
      nomeTemporada: temporada.nome ?? null,
      posicaoParticipantes,
      totalParticipantes: participantes.length,
    };
  }

  const comportamento = resumirComportamentoCofre(
    eventosParaMotor(eventos),
    agoraMs,
  );

  // Fase 1 deliberadamente sem thresholds comerciais reais:
  // config=null => o motor não classifica atraso/ticket por números de fixture.
  // Top 3 continua podendo receber o estado não-financeiro de exclusividade,
  // já aprovado como conceito do produto.
  const proximaAcao = decidirProximaMelhorAcaoCofre({
    contexto: {
      participaRanking: true,
      posicaoRanking: posicaoParticipantes,
      estrelasDisponiveis,
      estrelasConquistadasTemporada: scoreRankingTemporada,
    },
    resumo: comportamento,
    config: null,
  });

  return {
    schemaVersao: 1,
    modo: "somente_leitura",
    disponivel: true,
    motivoIndisponibilidade: null,
    estrelas: {
      disponiveis: estrelasDisponiveis,
      scoreRankingTemporada,
    },
    ranking,
    comportamento,
    proximaAcao,
    ofertas: [],
    economia: ECONOMIA_BLOQUEADA,
  };
}
