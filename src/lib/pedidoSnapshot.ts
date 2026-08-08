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

export type PedidoSnapshotItem = {
  kind: ItemApp["kind"];
  nome: string;
  detalhe?: string;
  quantidade: number;
  precoUnitarioCents: number;
  totalCents: number;
  /** Presente só quando o item foi resolvido por seleção estruturada por ID
   * (Fase 2/2C) — ausente em itens legados (name/detail) e no presente da
   * Jornada do Chef (sempre reconstruído do snapshot da própria recompensa,
   * nunca do catálogo de pizza). */
  selecao?: { sizeId: string; flavorIds: string[]; borderId?: string };
};

export type PedidoSnapshotOficial = {
  itens: PedidoSnapshotItem[];
  subtotalCents: number;
  taxaEntregaCents: number;
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

export function construirSnapshotItem(params: {
  kind: ItemApp["kind"];
  nome: string;
  detalhe?: string;
  quantidade: number;
  precoUnitarioReais: number;
  selecao?: { sizeId: string; flavorIds: string[]; borderId?: string };
}): PedidoSnapshotItem {
  const precoUnitarioCents = centavos(params.precoUnitarioReais);
  return {
    kind: params.kind,
    nome: params.nome,
    ...(params.detalhe ? { detalhe: params.detalhe } : {}),
    quantidade: params.quantidade,
    precoUnitarioCents,
    totalCents: precoUnitarioCents * params.quantidade,
    ...(params.selecao ? { selecao: params.selecao } : {}),
  };
}

export function construirSnapshotOficial(params: {
  itens: PedidoSnapshotItem[];
  subtotalReais: number;
  taxaReais: number;
  totalReais: number;
  tipoEntrega: "delivery" | "retirada" | "dine_in";
  bairro?: string;
  pagamento: string;
  criadoEm: string;
}): PedidoSnapshotOficial {
  return {
    itens: params.itens,
    subtotalCents: centavos(params.subtotalReais),
    taxaEntregaCents: centavos(params.taxaReais),
    totalCents: centavos(params.totalReais),
    entrega: { tipo: params.tipoEntrega, ...(params.bairro ? { bairro: params.bairro } : {}) },
    pagamento: params.pagamento,
    criadoEm: params.criadoEm,
  };
}
