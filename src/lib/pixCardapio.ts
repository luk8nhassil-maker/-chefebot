// Helpers puros da tela final de Pix manual do /cardapio (sem API bancaria):
// estado de pagamento exposto ao cliente e link do WhatsApp para envio do
// comprovante. A validacao real continua no pipeline do webhook (hash, E2E,
// horario, beneficiario) — aqui e so apresentacao segura.

export type EstadoPagamentoPixCliente = "aguardando" | "em_analise" | "pago";

export type PedidoParaEstadoPix = {
  pixConfirmado?: boolean;
  pix?: { status?: string };
};

// Estado unico e minimo mostrado ao cliente. "em_revisao" E "suspeito" viram
// ambos "em_analise" de proposito: o cliente nunca fica sabendo que o
// comprovante foi marcado como suspeito (nao damos dica a fraudador), so que
// a equipe esta conferindo. A distincao completa fica no painel da equipe.
export function derivarEstadoPagamentoPixCliente(
  pedido: PedidoParaEstadoPix | null | undefined,
): EstadoPagamentoPixCliente | undefined {
  if (!pedido) return undefined;

  const statusPix = pedido.pix?.status;
  if (pedido.pixConfirmado === true || statusPix === "confirmado") return "pago";
  if (statusPix === "em_revisao" || statusPix === "suspeito" || statusPix === "comprovante_recebido") return "em_analise";
  if (statusPix || pedido.pix) return "aguardando";
  return undefined;
}

function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// Numero de WhatsApp BR no formato do wa.me: somente digitos, com DDI 55.
// Numero curto/invalido retorna undefined — melhor nao mostrar botao do que
// abrir conversa com numero errado.
export function normalizarWhatsappPizzaria(valor: string | null | undefined): string | undefined {
  let numero = apenasDigitos(String(valor || ""));
  if (!numero) return undefined;
  if (!numero.startsWith("55")) numero = "55" + numero;
  // 55 + DDD (2) + numero (8 ou 9)
  if (numero.length < 12 || numero.length > 13) return undefined;
  return numero;
}

export function montarMensagemComprovantePix(numeroPedido: number | undefined, total: number): string {
  const pedidoTexto = numeroPedido !== undefined ? `o pedido #${numeroPedido}` : "um pedido";
  const totalTexto = `R$ ${total.toFixed(2).replace(".", ",")}`;
  return `Olá! Fiz ${pedidoTexto} pelo cardápio, no valor de ${totalTexto}. Segue o comprovante do Pix.`;
}

export function montarLinkWhatsappComprovantePix(input: {
  whatsapp: string | null | undefined;
  numeroPedido?: number;
  total: number;
}): string | undefined {
  const numero = normalizarWhatsappPizzaria(input.whatsapp);
  if (!numero) return undefined;

  const mensagem = montarMensagemComprovantePix(input.numeroPedido, input.total);
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}
