import type { BotSession, CartItem } from "./bot";

export interface StatusFechamento {
  nivel: "incompleto" | "quase_pronto" | "pronto";
  titulo: string;
  descricao: string;
}

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
  statusFechamento: StatusFechamento;
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
// Usa SEMPRE o dado oficial da sessão quando ele existir; só cai no rascunho de
// tempo real (session.rascunhoAtendimento) quando o oficial ainda não foi
// preenchido pelo fluxo do bot. Assim o resumo nunca regride o que já é oficial.
export function calcularResumoAtendimentoHumano(
  session: BotSession,
): ResumoAtendimentoHumano {
  const rascunho = session.rascunhoAtendimento;

  const cart = session.cart ?? [];
  const itensOficiais = cart.map(formatarItem).filter(Boolean);
  const itens = itensOficiais.length > 0 ? itensOficiais : (rascunho?.itens ?? []);
  // Total só soma itens oficiais com preço — o rascunho não tem preços confiáveis.
  const total = cart.reduce((acc, i) => acc + i.price, 0) + (session.deliveryFee ?? 0);

  const tipoOficial: "delivery" | "retirada" | "dine_in" | "" =
    TIPO_MAP[session.deliveryType ?? ""] ?? "";
  const tipoEntrega: "delivery" | "retirada" | "dine_in" | "" =
    tipoOficial || (rascunho?.tipoEntrega ?? "");

  const cliente = session.customerName?.trim()
    ? session.customerName
    : (rascunho?.nome ?? "");
  const bairro = session.neighborhood?.trim()
    ? session.neighborhood
    : (rascunho?.bairro ?? "");
  const endereco = session.address?.trim()
    ? session.address
    : (rascunho?.endereco ?? "");
  const pagamento = (session.paymentMethod?.trim()
    ? session.paymentMethod
    : (rascunho?.pagamento ?? "")
  ).trim();
  const troco = session.troco?.trim() ? session.troco : (rascunho?.troco ?? "");

  const pendencias: string[] = [];
  if (!cliente.trim()) pendencias.push("Confirmar nome do cliente");
  if (itens.length === 0) pendencias.push("Confirmar itens do pedido");
  if (!tipoEntrega)
    pendencias.push("Confirmar se é entrega, retirada ou consumo no local");
  if (tipoEntrega === "delivery" && !bairro.trim())
    pendencias.push("Confirmar bairro");
  if (tipoEntrega === "delivery" && !endereco.trim())
    pendencias.push("Confirmar endereço");
  if (!pagamento) pendencias.push("Confirmar forma de pagamento");
  // Troco só é pendência se pagamento envolver dinheiro/espécie
  const precisaTroco =
    pagamento.toLowerCase().includes("dinheiro") ||
    pagamento.toLowerCase().includes("espécie") ||
    pagamento.toLowerCase().includes("especie");
  if (precisaTroco && !troco.trim()) pendencias.push("Confirmar troco");

  let statusFechamento: StatusFechamento;
  if (pendencias.length === 0) {
    statusFechamento = { nivel: "pronto", titulo: "Pronto para finalizar", descricao: "Revise e crie o pedido." };
  } else if (pendencias.length === 1 && itens.length > 0) {
    statusFechamento = { nivel: "quase_pronto", titulo: "Quase pronto", descricao: "Falta só confirmar um detalhe." };
  } else {
    statusFechamento = { nivel: "incompleto", titulo: "Pedido incompleto", descricao: "Ainda faltam informações para finalizar." };
  }

  return {
    cliente,
    itens,
    total,
    tipoEntrega,
    tipoEntregaLabel: TIPO_LABEL[tipoEntrega] ?? "",
    bairro,
    endereco,
    pagamento,
    troco,
    observacao: session.observacao ?? "",
    pendencias,
    statusFechamento,
  };
}
