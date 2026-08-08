// Snapshot oficial e estruturado do pedido — Fase 3.
//
// Representação ADITIVA (nunca substitui itens/total/taxaEntrega/itensDetalhados
// legados, que continuam sendo gravados exatamente como hoje) do que o
// servidor validou e vai cobrar — preços sempre em centavos inteiros e,
// quando disponível, os IDs estáveis do catálogo oficial (Fase 2) por item.
// Construído só a partir de valores JÁ calculados/validados no servidor
// (nunca confia em price/taxa/total vindos do cliente) — ver
// POST /api/pedido-app e POST /api/pedido-app/[id]/editar/salvar.
//
// Ninguém além de quem grava o pedido lê este campo ainda nesta fase —
// WhatsApp, Pix, impressão, fidelidade, Salão e pedido manual continuam
// 100% nos campos legados. É fundação para religar esses consumidores numa
// etapa futura, não uma migração deles agora.
import type { ItemApp } from "@/lib/pedidoAppItens";

/** Seleção estruturada de pizza — sizeId/flavorIds/borderId (Fase 2/2C). */
export type SelecaoSnapshotPizza = { sizeId: string; flavorIds: string[]; borderId?: string };
/** Seleção estruturada de produto simples — Calzone, Mini-Pizza, Macarronada,
 * sucos (Fase 6). Discriminada de SelecaoSnapshotPizza por `productId`. */
export type SelecaoSnapshotSimples = { productId: string; sizeId?: string; flavorId?: string; milk?: "com" | "sem" };
export type SelecaoSnapshot = SelecaoSnapshotPizza | SelecaoSnapshotSimples;

export type PedidoSnapshotItem = {
  kind: ItemApp["kind"];
  nome: string;
  detalhe?: string;
  quantidade: number;
  precoUnitarioCents: number;
  totalCents: number;
  /** Presente só quando o item foi resolvido por seleção estruturada por ID
   * (Fase 2/2C, Fase 6) — ausente em itens legados (name/detail) e no
   * presente da Jornada do Chef (sempre reconstruído do snapshot da própria
   * recompensa, nunca do catálogo). */
  selecao?: SelecaoSnapshot;
};

export type PedidoSnapshotOficial = {
  itens: PedidoSnapshotItem[];
  subtotalCents: number;
  /** Mesmo desconto já calculado pelo servidor hoje — `descontoFidelidade`
   * na criação (resgate de pontos), a mesma derivação de `subtotalComDesconto`
   * na edição. Nunca uma regra nova; 0 quando não há desconto. Nome espelha
   * o campo já existente em PedidoRedis.descontoFidelidade e em
   * SnapshotFinanceiroAttempt.descontoFidelidade (@/survival/pedidoIdempotencia). */
  descontoFidelidadeCents: number;
  taxaEntregaCents: number;
  /** Sempre derivado de subtotalCents - descontoFidelidadeCents + taxaEntregaCents
   * — nunca arredondado independentemente, para que a invariante valha por
   * construção, não por coincidência de arredondamento. */
  totalCents: number;
  entrega: { tipo: "delivery" | "retirada" | "dine_in"; bairro?: string };
  /** Informativo — a forma de pagamento já validada pelo fluxo existente
   * (troco, Pix, pagamento composto); este módulo não valida nada novo. */
  pagamento: string;
  criadoEm: string;
};

function centavos(reais: number): number {
  return Math.round(reais * 100);
}

// `params.selecao` pode vir, em última instância, de
// `body.itens[i].pizzaSelection`/`body.itens[i].simpleSelection` — JSON do
// cliente, sem garantia nenhuma em runtime de que só tem os campos do tipo TS
// (que só protege object literals, nunca uma referência vinda de fora). Copia
// explicitamente só os campos oficiais de cada formato — qualquer propriedade
// extra adulterada no payload nunca chega a ser persistida. Discrimina pela
// PRESENÇA de `productId`: só a seleção de produto simples tem esse campo.
function sanitizarSelecao(selecao: SelecaoSnapshot | undefined): SelecaoSnapshot | undefined {
  if (!selecao) return undefined;
  if ("productId" in selecao) {
    return {
      productId: selecao.productId,
      ...(selecao.sizeId !== undefined ? { sizeId: selecao.sizeId } : {}),
      ...(selecao.flavorId !== undefined ? { flavorId: selecao.flavorId } : {}),
      ...(selecao.milk !== undefined ? { milk: selecao.milk } : {}),
    };
  }
  return {
    sizeId: selecao.sizeId,
    flavorIds: [...selecao.flavorIds],
    ...(selecao.borderId !== undefined ? { borderId: selecao.borderId } : {}),
  };
}

export function construirSnapshotItem(params: {
  kind: ItemApp["kind"];
  nome: string;
  detalhe?: string;
  quantidade: number;
  precoUnitarioReais: number;
  selecao?: SelecaoSnapshot;
}): PedidoSnapshotItem {
  const precoUnitarioCents = centavos(params.precoUnitarioReais);
  const selecaoSanitizada = sanitizarSelecao(params.selecao);
  return {
    kind: params.kind,
    nome: params.nome,
    ...(params.detalhe ? { detalhe: params.detalhe } : {}),
    quantidade: params.quantidade,
    precoUnitarioCents,
    totalCents: precoUnitarioCents * params.quantidade,
    ...(selecaoSanitizada ? { selecao: selecaoSanitizada } : {}),
  };
}

export function construirSnapshotOficial(params: {
  itens: PedidoSnapshotItem[];
  subtotalReais: number;
  /** Mesmo valor já calculado pelo servidor (descontoFidelidade na criação,
   * a derivação de subtotalComDesconto na edição) — 0 quando não há
   * desconto. Nunca uma regra nova de desconto. */
  descontoReais: number;
  taxaReais: number;
  tipoEntrega: "delivery" | "retirada" | "dine_in";
  bairro?: string;
  pagamento: string;
  criadoEm: string;
}): PedidoSnapshotOficial {
  const subtotalCents = centavos(params.subtotalReais);
  const descontoFidelidadeCents = centavos(params.descontoReais);
  const taxaEntregaCents = centavos(params.taxaReais);
  return {
    itens: params.itens,
    subtotalCents,
    descontoFidelidadeCents,
    taxaEntregaCents,
    // Derivado, nunca arredondado independentemente — garante
    // subtotalCents - descontoFidelidadeCents + taxaEntregaCents === totalCents
    // por construção.
    totalCents: subtotalCents - descontoFidelidadeCents + taxaEntregaCents,
    entrega: { tipo: params.tipoEntrega, ...(params.bairro ? { bairro: params.bairro } : {}) },
    pagamento: params.pagamento,
    criadoEm: params.criadoEm,
  };
}
