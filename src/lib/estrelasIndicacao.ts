import {
  estrelasV1Ativa,
  obterConfigFidelidadePontos,
  obterExtratoPontos,
  registrarMovimentoPontosIdempotente,
} from "./fidelidade";
import { REGRA_ESTRELAS_V1 } from "./estrelas";
import { redis } from "./redis";
import { comBloqueioGamificacao } from "./rankingGamificacaoLock";

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

function chaveApoioExpediente(indicadoId: string, expedienteId: string): string {
  return `apoio:expediente:${indicadoId}:${expedienteId}`;
}

function chaveApoioBreadcrumbPedido(pedidoId: string): string {
  return `apoio:pedido:${pedidoId}`;
}

type RegistroApoioExpediente = { pedidosQualificados: string[] };

type ApoioBreadcrumbPedido = { indicadorId: string; indicadoId: string; expedienteId: string };

function eventoIdApoioExpediente(indicadoId: string, expedienteId: string): string {
  return `apoio:${indicadoId}:expediente:${expedienteId}`;
}

/**
 * Registra ESTE pedido como um dos que qualificam para o apoio deste
 * expediente — mesmo quando o crédito real (idempotente por expediente) já
 * tinha sido dado por outro pedido antes. Necessário para o cancelamento
 * tardio saber se outro pedido válido do MESMO expediente ainda sustenta o
 * crédito antes de estornar (nunca remove uma Estrela indevidamente).
 */
async function registrarPedidoQualificadoApoio(params: ApoioBreadcrumbPedido & { pedidoId: string }): Promise<void> {
  const chaveLock = `apoio:lock:${params.indicadoId}:${params.expedienteId}`;
  await comBloqueioGamificacao(chaveLock, async () => {
    const chave = chaveApoioExpediente(params.indicadoId, params.expedienteId);
    const atual = (await redis.get<RegistroApoioExpediente>(chave)) ?? { pedidosQualificados: [] };
    if (!atual.pedidosQualificados.includes(params.pedidoId)) {
      await redis.set(chave, { pedidosQualificados: [...atual.pedidosQualificados, params.pedidoId] } satisfies RegistroApoioExpediente);
    }
    await redis.set(chaveApoioBreadcrumbPedido(params.pedidoId), {
      indicadorId: params.indicadorId,
      indicadoId: params.indicadoId,
      expedienteId: params.expedienteId,
    } satisfies ApoioBreadcrumbPedido);
  });
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

  await registrarPedidoQualificadoApoio({
    indicadorId: params.indicadorId,
    indicadoId: params.indicadoId,
    expedienteId: params.expedienteId,
    pedidoId: params.pedidoId,
  });

  const movimento = await registrarMovimentoPontosIdempotente(params.indicadorId, {
    eventoId: eventoIdApoioExpediente(params.indicadoId, params.expedienteId),
    pedidoId: params.pedidoId,
    tipo: "confirmado",
    pontos: 1,
    motivo: "Estrela de apoio recorrente",
    regraVersao: REGRA_ESTRELAS_V1,
    unidade: "estrelas",
  });
  return movimento ? "creditado" : "ja_creditado";
}

export type ResultadoEstornoApoio = "estornado" | "mantido_outro_pedido_sustenta" | "nao_encontrado" | "ja_estornado";

/**
 * Cancelamento tardio de um pedido que contribuiu para o apoio recorrente de
 * um expediente. Nunca remove a Estrela quando outro pedido comercial VÁLIDO
 * do mesmo indicado no mesmo expediente ainda a sustenta — só estorna quando
 * este era o ÚLTIMO pedido qualificado restante. Idempotente e sem efeito
 * para um pedido que nunca qualificou para apoio nenhum.
 */
export async function estornarEstrelaApoioRecorrente(params: {
  pedidoId: string;
  motivo: string;
}): Promise<ResultadoEstornoApoio> {
  if (!params.pedidoId) return "nao_encontrado";
  const breadcrumb = await redis.get<ApoioBreadcrumbPedido>(chaveApoioBreadcrumbPedido(params.pedidoId));
  if (!breadcrumb) return "nao_encontrado";

  const chaveLock = `apoio:lock:${breadcrumb.indicadoId}:${breadcrumb.expedienteId}`;
  return comBloqueioGamificacao(chaveLock, async () => {
    const chave = chaveApoioExpediente(breadcrumb.indicadoId, breadcrumb.expedienteId);
    const atual = (await redis.get<RegistroApoioExpediente>(chave)) ?? { pedidosQualificados: [] };
    if (!atual.pedidosQualificados.includes(params.pedidoId)) {
      // Já foi processado antes (idempotência de retry) — nunca reavalia de novo.
      return "ja_estornado";
    }
    const restantes = atual.pedidosQualificados.filter((id) => id !== params.pedidoId);
    await redis.set(chave, { pedidosQualificados: restantes } satisfies RegistroApoioExpediente);

    if (restantes.length > 0) {
      // Outro pedido comercial válido do mesmo expediente ainda sustenta o
      // crédito — nunca remove a Estrela indevidamente.
      return "mantido_outro_pedido_sustenta";
    }

    const eventoIdOriginal = eventoIdApoioExpediente(breadcrumb.indicadoId, breadcrumb.expedienteId);
    const extrato = await obterExtratoPontos(breadcrumb.indicadorId);
    const original = extrato.find((m) => m.eventoId === eventoIdOriginal);
    if (!original) return "nao_encontrado";
    const eventoIdEstorno = `estorno:${eventoIdOriginal}`;
    if (extrato.some((m) => m.eventoId === eventoIdEstorno)) return "ja_estornado";
    const movimento = await registrarMovimentoPontosIdempotente(breadcrumb.indicadorId, {
      eventoId: eventoIdEstorno,
      pedidoId: params.pedidoId,
      tipo: "estornado",
      pontos: original.pontos,
      motivo: params.motivo,
      regraVersao: REGRA_ESTRELAS_V1,
      unidade: "estrelas",
    });
    return movimento ? "estornado" : "ja_estornado";
  });
}
