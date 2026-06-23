import type { BotSession, CartItem } from "./bot";

export interface ResumoAtendimentoHumano {
  cliente: string;
  itens: string[];
  total: number;
  tipoEntrega: "delivery" | "retirada" | "dine_in" | "";
  tipoEntregaLabel: string;
  bairro: string;
  endereco: string;
  pagamento: string;
  troco: string;
  observacao: string;
  pendencias: string[];
}

function formatarItem(item: CartItem): string {
  const size = item.size ? ` ${item.size}` : "";
  const flavor = item.flavor ? ` ${item.flavor}` : "";
  const border = item.border && item.border !== "Sem borda" ? ` + ${item.border}` : "";
  return `${item.name}${size}${flavor}${border}`.trim();
}

const TIPO_MAP: Record<string, "delivery" | "retirada" | "dine_in"> = {
  delivery: "delivery",
  pickup: "retirada",
  retirada: "retirada",
  dine_in: "dine_in",
};

const TIPO_LABEL: Record<string, string> = {
  delivery: "Entrega",
  retirada: "Retirada na loja",
  dine_in: "Consumo no local",
};

// Função pura — não lê Redis, não tem efeitos colaterais, não altera a sessão.
export function calcularResumoAtendimentoHumano(
  session: BotSession,
): ResumoAtendimentoHumano {
  const cart = session.cart ?? [];
  const itens = cart.map(formatarItem).filter(Boolean);
  const totalItens = cart.reduce((acc, i) => acc + i.price, 0);
  const total = totalItens + (session.deliveryFee ?? 0);

  const tipoEntrega: "delivery" | "retirada" | "dine_in" | "" =
    TIPO_MAP[session.deliveryType ?? ""] ?? "";

  const pagamento = (session.paymentMethod ?? "").trim();

  const pendencias: string[] = [];
  if (!session.customerName?.trim()) pendencias.push("Confirmar nome do cliente");
  if (itens.length === 0) pendencias.push("Confirmar itens do pedido");
  if (!tipoEntrega)
    pendencias.push("Confirmar se é entrega, retirada ou consumo no local");
  if (tipoEntrega === "delivery" && !session.neighborhood?.trim())
    pendencias.push("Confirmar bairro");
  if (tipoEntrega === "delivery" && !session.address?.trim())
    pendencias.push("Confirmar endereço");
  if (!pagamento) pendencias.push("Confirmar forma de pagamento");
  // Troco só é pendência se pagamento envolver dinheiro/espécie
  const precisaTroco =
    pagamento.toLowerCase().includes("dinheiro") ||
    pagamento.toLowerCase().includes("espécie") ||
    pagamento.toLowerCase().includes("especie");
  if (precisaTroco && !session.troco?.trim()) pendencias.push("Confirmar troco");

  return {
    cliente: session.customerName ?? "",
    itens,
    total,
    tipoEntrega,
    tipoEntregaLabel: TIPO_LABEL[tipoEntrega] ?? "",
    bairro: session.neighborhood ?? "",
    endereco: session.address ?? "",
    pagamento,
    troco: session.troco ?? "",
    observacao: session.observacao ?? "",
    pendencias,
  };
}
