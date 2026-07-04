import { temPixNoPagamento, valorPixEsperado } from "./bot";
import { criarCobrancaPixMercadoPago } from "./mercadoPagoPix";
import type { CriteriosEvidenciaPix, DecisaoEvidenciaPix } from "./pixComprovanteAvaliacao";

// Status "em_revisao"/"suspeito" são escritos pela camada de avaliacao por evidencia
// (avaliarEvidenciaPix, Etapa 2E) quando a decisao nao e "aprovar". "comprovante_recebido"
// segue reservado para uso futuro. Pedidos antigos podem nao ter status algum (ou nem
// ter pix): todo leitor deve tratar ausencia como pendente.
export type PixStatus = "pendente" | "comprovante_recebido" | "em_revisao" | "suspeito" | "confirmado";
export type PixConfirmadoPor = "manual" | "webhook" | "comprovante";
export type PixEvidenciaOrigem = "texto" | "midia";
export type PixEvidencia = {
  e2eId?: string;
  codigoAutenticacao?: string;
  dataHoraPagamento?: string;
  motivo?: string;
  origem?: PixEvidenciaOrigem;
  registradoEm?: string;
  // Snapshot auditavel da decisao de avaliarEvidenciaPix (Etapa 2E).
  hash?: string;
  decisao?: DecisaoEvidenciaPix;
  score?: number;
  criterios?: CriteriosEvidenciaPix;
  motivos?: string[];
  avaliadoEm?: string;
};

export type PixMetadata = {
  txid?: string;
  valorEsperado?: number;
  status?: PixStatus;
  confirmadoPor?: PixConfirmadoPor;
  confirmadoEm?: string;
  evidencia?: PixEvidencia;
  provider?: "mercadopago";
  providerPaymentId?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  idempotencyKey?: string;
};

export type PixWebhookPayload = {
  txid?: string;
  valor?: number;
  status?: string;
  providerPaymentId?: string;
};

export type PedidoComPix = {
  id?: string;
  total?: number;
  pix?: PixMetadata;
};

export type PixWebhookResultado = {
  wouldConfirm: boolean;
  reason?: string;
  pedidoId?: string;
  txid?: string;
  valorEsperado?: number;
  valorRecebido?: number;
  providerPaymentId?: string;
};

export type PrepararPixProviderInput = {
  pedidoId: string;
  pix: PixMetadata | undefined;
  descricao?: string;
  clienteNome?: string;
  payerEmail?: string;
};

export type PixCliente = {
  provider: "mercadopago";
  qrCode: string;
  ticketUrl?: string;
  valorEsperado?: number;
};

const STATUS_PIX_PAGO = new Set(["pago", "paid", "liquidado", "settled", "confirmed", "confirmado"]);

function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function gerarTxidPixInterno(pedidoId: string): string {
  return `chefebot_${pedidoId}`;
}

// Registra a confirmação do Pix com origem e horário. Regras:
// - nunca sobrescreve uma confirmação já registrada (ex: um clique manual não
//   apaga confirmadoPor "webhook" nem o horário original);
// - aceita pix undefined (pedidos antigos sem metadata) criando o mínimo auditável;
// - preenche origem/horário em pedidos legados confirmados sem esses campos.
export function confirmarPixMetadata(
  pix: PixMetadata | undefined,
  confirmadoPor: PixConfirmadoPor,
  confirmadoEm: string = new Date().toISOString()
): PixMetadata {
  if (pix?.status === "confirmado" && pix.confirmadoPor) return pix;
  return {
    ...(pix || {}),
    status: "confirmado",
    confirmadoPor: pix?.confirmadoPor || confirmadoPor,
    confirmadoEm: pix?.confirmadoEm || confirmadoEm,
  };
}

export function registrarPixEvidencia(
  pix: PixMetadata,
  evidencia: Omit<PixEvidencia, "registradoEm">,
  registradoEm: string = new Date().toISOString()
): PixMetadata {
  const temConteudo = !!(
    evidencia.e2eId ||
    evidencia.codigoAutenticacao ||
    evidencia.dataHoraPagamento ||
    evidencia.motivo ||
    evidencia.hash ||
    evidencia.decisao ||
    typeof evidencia.score === "number" ||
    evidencia.criterios ||
    evidencia.motivos?.length
  );
  if (!temConteudo) return pix;

  return {
    ...pix,
    evidencia: {
      ...(pix.evidencia || {}),
      ...(evidencia.e2eId ? { e2eId: evidencia.e2eId } : {}),
      ...(evidencia.codigoAutenticacao ? { codigoAutenticacao: evidencia.codigoAutenticacao } : {}),
      ...(evidencia.dataHoraPagamento ? { dataHoraPagamento: evidencia.dataHoraPagamento } : {}),
      ...(evidencia.motivo ? { motivo: evidencia.motivo } : {}),
      ...(evidencia.origem ? { origem: evidencia.origem } : {}),
      ...(evidencia.hash ? { hash: evidencia.hash } : {}),
      ...(evidencia.decisao ? { decisao: evidencia.decisao } : {}),
      ...(typeof evidencia.score === "number" ? { score: evidencia.score } : {}),
      ...(evidencia.criterios ? { criterios: evidencia.criterios } : {}),
      ...(evidencia.motivos?.length ? { motivos: evidencia.motivos } : {}),
      registradoEm,
    },
  };
}

// Marca o Pix para fila de revisao humana quando a evidencia do comprovante
// nao e forte o suficiente para aprovacao automatica (Etapa 2E). "Seguro" aqui
// significa: nunca rebaixa um Pix que ja foi confirmado por outro caminho
// (webhook, manual ou comprovante anterior) — mesma logica defensiva de
// confirmarPixMetadata, que tambem nunca sobrescreve uma confirmacao existente.
export function marcarPixRevisaoOuSuspeito(
  pix: PixMetadata | undefined,
  status: "em_revisao" | "suspeito"
): PixMetadata {
  const base = pix || {};
  if (base.status === "confirmado") return base;
  return { ...base, status };
}

export function criarPixMetadata(pedidoId: string, pagamento: string | undefined, total: number): PixMetadata | undefined {
  if (!temPixNoPagamento(pagamento)) return undefined;

  return {
    txid: gerarTxidPixInterno(pedidoId),
    valorEsperado: valorPixEsperado(pagamento, total),
    status: "pendente",
  };
}

export async function prepararPixProviderMercadoPago(input: PrepararPixProviderInput): Promise<PixMetadata | undefined> {
  const pix = input.pix;
  if (!pix) return undefined;
  if (process.env.PIX_PROVIDER !== "mercadopago") return pix;
  if (!pix.txid || typeof pix.valorEsperado !== "number" || !Number.isFinite(pix.valorEsperado)) return pix;

  try {
    const cobranca = await criarCobrancaPixMercadoPago({
      pedidoId: input.pedidoId,
      txid: pix.txid,
      valorEsperado: pix.valorEsperado,
      descricao: input.descricao,
      clienteNome: input.clienteNome,
      payerEmail: input.payerEmail,
    });

    return {
      ...pix,
      provider: cobranca.provider,
      providerPaymentId: cobranca.providerPaymentId,
      qrCode: cobranca.qrCode,
      qrCodeBase64: cobranca.qrCodeBase64,
      ticketUrl: cobranca.ticketUrl,
      idempotencyKey: cobranca.idempotencyKey,
      status: "pendente",
    };
  } catch (error) {
    console.warn("[Pix] Mercado Pago indisponivel; mantendo Pix manual", error);
    return pix;
  }
}

export function serializarPixCliente(pix: PixMetadata | undefined): PixCliente | undefined {
  const qrCode = typeof pix?.qrCode === "string" ? pix.qrCode.trim() : "";
  if (pix?.provider !== "mercadopago" || !qrCode) return undefined;

  const ticketUrl = typeof pix.ticketUrl === "string" && pix.ticketUrl.trim() ? pix.ticketUrl.trim() : undefined;
  const valorEsperado = typeof pix.valorEsperado === "number" && Number.isFinite(pix.valorEsperado)
    ? pix.valorEsperado
    : undefined;

  return {
    provider: "mercadopago",
    qrCode,
    ...(ticketUrl ? { ticketUrl } : {}),
    ...(valorEsperado !== undefined ? { valorEsperado } : {}),
  };
}

export function sanitizarPedidoPixResposta<T extends object>(pedido: T): T {
  const pixOriginal = (pedido as { pix?: PixMetadata }).pix;
  if (!pixOriginal || !("qrCodeBase64" in pixOriginal)) return pedido;

  const { qrCodeBase64: _qrCodeBase64, ...pix } = pixOriginal;
  return { ...pedido, pix } as T;
}

export function montarTextoPixMercadoPagoCliente(pix: PixCliente | undefined): string {
  if (!pix?.qrCode) return "";

  const valor = typeof pix.valorEsperado === "number" && Number.isFinite(pix.valorEsperado)
    ? `\nValor do Pix: R$ ${pix.valorEsperado.toFixed(2).replace(".", ",")}`
    : "";
  const ticket = pix.ticketUrl ? `\nLink de pagamento: ${pix.ticketUrl}` : "";

  return `\n\nPix Mercado Pago copia e cola:${valor}\n${pix.qrCode}${ticket}`;
}

export function anexarPixMercadoPagoEmMensagens(messages: string[], pix: PixCliente | undefined): string[] {
  const textoPix = montarTextoPixMercadoPagoCliente(pix);
  if (!textoPix || messages.length === 0) return messages;

  return messages.map((message, index) => (
    index === messages.length - 1 ? `${message}${textoPix}` : message
  ));
}

export function avaliarWebhookPixPassivo(payload: PixWebhookPayload, pedidos: PedidoComPix[]): PixWebhookResultado {
  const txid = typeof payload.txid === "string" ? payload.txid.trim() : "";
  const valorRecebido = Number(payload.valor);
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";

  if (!txid) return { wouldConfirm: false, reason: "txid_obrigatorio" };
  if (!Number.isFinite(valorRecebido)) return { wouldConfirm: false, reason: "valor_invalido", txid };

  const pedido = pedidos.find((p) => p.pix?.txid === txid);
  if (!pedido) return { wouldConfirm: false, reason: "pedido_nao_encontrado", txid, valorRecebido };
  if (!pedido.pix) return { wouldConfirm: false, reason: "pedido_sem_pix", pedidoId: pedido.id, txid, valorRecebido };
  if (pedido.pix.status === "confirmado") {
    return {
      wouldConfirm: false,
      reason: "pix_ja_confirmado",
      pedidoId: pedido.id,
      txid,
      valorEsperado: pedido.pix.valorEsperado,
      valorRecebido,
      providerPaymentId: payload.providerPaymentId,
    };
  }
  const valorEsperado = pedido.pix.valorEsperado;
  if (typeof valorEsperado !== "number" || !Number.isFinite(valorEsperado)) {
    return { wouldConfirm: false, reason: "pix_valor_esperado_ausente", pedidoId: pedido.id, txid, valorRecebido };
  }
  if (emCentavos(valorRecebido) !== emCentavos(valorEsperado)) {
    return {
      wouldConfirm: false,
      reason: "valor_divergente",
      pedidoId: pedido.id,
      txid,
      valorEsperado,
      valorRecebido,
      providerPaymentId: payload.providerPaymentId,
    };
  }
  if (!STATUS_PIX_PAGO.has(status)) {
    return {
      wouldConfirm: false,
      reason: "status_nao_pago",
      pedidoId: pedido.id,
      txid,
      valorEsperado,
      valorRecebido,
      providerPaymentId: payload.providerPaymentId,
    };
  }

  return {
    wouldConfirm: true,
    pedidoId: pedido.id,
    txid,
    valorEsperado,
    valorRecebido,
    providerPaymentId: payload.providerPaymentId,
  };
}
