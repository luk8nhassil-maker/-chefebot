import {
  estrelasV1Ativa,
  obterConfigFidelidadePontos,
  registrarMovimentoPontosIdempotente,
} from "./fidelidade";
import { REGRA_ESTRELAS_V1 } from "./estrelas";

export type ResultadoCreditoEstrelas = "creditado" | "ja_creditado" | "nao_elegivel";

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
    pontos: 6,
    motivo: "Estrelas por indicação válida",
    regraVersao: REGRA_ESTRELAS_V1,
    unidade: "estrelas",
  });
  return movimento ? "creditado" : "ja_creditado";
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
