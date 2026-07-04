export type MensagemComprovantePixInput = {
  pedidoId: string;
  numero?: number;
  total: number;
};

export function formatarMoedaBR(valor: number): string {
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

export function normalizarWhatsAppPizzaria(telefone: string | null | undefined): string | undefined {
  const digits = String(telefone || "").replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

export function montarMensagemComprovantePix(input: MensagemComprovantePixInput): string {
  const referencia = typeof input.numero === "number" ? `#${input.numero}` : `#${input.pedidoId}`;
  return `Olá, fiz o pedido ${referencia} pelo cardápio no valor de ${formatarMoedaBR(input.total)}. Segue o comprovante do Pix.`;
}

export function montarLinkWhatsAppComprovante(
  telefone: string | null | undefined,
  input: MensagemComprovantePixInput
): string | undefined {
  const numero = normalizarWhatsAppPizzaria(telefone);
  if (!numero) return undefined;
  return `https://wa.me/${numero}?text=${encodeURIComponent(montarMensagemComprovantePix(input))}`;
}
