import {
  estrelasV1Ativa,
  obterConfigFidelidadePontos,
  obterExtratoPontos,
  registrarMovimentoPontosIdempotente,
} from "./fidelidade";
import { REGRA_ESTRELAS_V1 } from "./estrelas";

export type ResultadoCreditoEstrelas = "creditado" | "ja_creditado" | "nao_elegivel";

/**
 * Regra oficial de estrelas por indicação (primeira compra válida do
 * indicado). Única fonte da verdade — a UI nunca deve hardcodar este valor;
 * quando precisar informá-lo, importa esta constante (ex.: agregador do
 * painel do cliente).
 */
export const ESTRELAS_INDICACAO_PRIMEIRA_COMPRA = 6;

/**
 * Crédito do evento de aquisição. A validação de primeira compra deve ser
 * feita pelo chamador que conhece o pedido comercial; este módulo só aceita o
 * fato já qualificado e o torna idempotente no ledger canônico.
 */
export async function creditarEstrelasIndicacaoValida(params: {
  indicadorId: string;
  indicadoId: string;
  pedidoId: string;
  primeiraCompraComercialValida: boolean;
}): Promise<ResultadoCreditoEstrelas> {
  if (!params.indicadorId || !params.indicadoId || !params.pedidoId || params.indicadorId === params.indicadoId) return "nao_elegivel";
  if (!params.primeiraCompraComercialValida) return "nao_elegivel";
  const config = await obterConfigFidelidadePontos();
  if (!estrelasV1Ativa(config)) return "nao_elegivel";
  const movimento = await registrarMovimentoPontosIdempotente(params.indicadorId, {
    eventoId: `indicacao:${params.indicadoId}:primeira-compra:${params.pedidoId}`,
    pedidoId: params.pedidoId,
    tipo: "confirmado",
    pontos: ESTRELAS_INDICACAO_PRIMEIRA_COMPRA,
    motivo: "Estrelas por indicação válida",
    regraVersao: REGRA_ESTRELAS_V1,
    unidade: "estrelas",
  });
  return movimento ? "creditado" : "ja_creditado";
}

export type ResultadoEstornoIndicacao = "estornado" | "ja_estornado" | "credito_nao_encontrado";

/**
 * Cancelamento tardio: reverte o crédito de indicação quando o pedido que
 * originou a primeira compra do indicado é corrigido para cancelado DEPOIS
 * de já ter creditado. Idempotente por eventoId — nunca estorna duas vezes
 * nem um crédito que nunca existiu. Nunca apaga o movimento original: grava
 * um movimento "estornado" novo, igual ao resto do ledger de fidelidade.
 */
export async function estornarEstrelasIndicacaoValida(params: {
  indicadorId: string;
  indicadoId: string;
  pedidoId: string;
  motivo: string;
}): Promise<ResultadoEstornoIndicacao> {
  const eventoIdOriginal = `indicacao:${params.indicadoId}:primeira-compra:${params.pedidoId}`;
  const extrato = await obterExtratoPontos(params.indicadorId);
  const original = extrato.find((m) => m.eventoId === eventoIdOriginal);
  if (!original) return "credito_nao_encontrado";
  const eventoIdEstorno = `estorno:${eventoIdOriginal}`;
  if (extrato.some((m) => m.eventoId === eventoIdEstorno)) return "ja_estornado";
  const movimento = await registrarMovimentoPontosIdempotente(params.indicadorId, {
    eventoId: eventoIdEstorno,
    pedidoId: params.pedidoId,
    tipo: "estornado",
    pontos: original.pontos,
    motivo: params.motivo,
    regraVersao: REGRA_ESTRELAS_V1,
    unidade: "estrelas",
  });
  return movimento ? "estornado" : "ja_estornado";
}

/**
 * Crédito de apoio recorrente. `expedienteId` é obrigatório e vem da fonte
 * operacional do pedido; nunca é substituído por uma virada civil à meia-noite.
 */
export async function creditarEstrelaApoioRecorrente(params: {
  indicadorId: string;
  indicadoId: string;
  pedidoId: string;
  expedienteId: string;
  pedidoComercialValido: boolean;
  pedidoTemPartePaga: boolean;
}): Promise<ResultadoCreditoEstrelas> {
  if (!params.indicadorId || !params.indicadoId || !params.pedidoId || !params.expedienteId) return "nao_elegivel";
  if (params.indicadorId === params.indicadoId || !params.pedidoComercialValido || !params.pedidoTemPartePaga) return "nao_elegivel";
  const config = await obterConfigFidelidadePontos();
  if (!estrelasV1Ativa(config)) return "nao_elegivel";
  const movimento = await registrarMovimentoPontosIdempotente(params.indicadorId, {
    eventoId: `apoio:${params.indicadoId}:expediente:${params.expedienteId}`,
    pedidoId: params.pedidoId,
    tipo: "confirmado",
    pontos: 1,
    motivo: "Estrela de apoio recorrente",
    regraVersao: REGRA_ESTRELAS_V1,
    unidade: "estrelas",
  });
  return movimento ? "creditado" : "ja_creditado";
}
