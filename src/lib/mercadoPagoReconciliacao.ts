import { redis } from "./redis";
import { buscarPagamentoMercadoPago, mapearStatusMercadoPago } from "./mercadoPagoWebhook";
import type { PedidoComPix } from "./pix";

// Conciliador manual/sob-demanda do Pix Mercado Pago (Nivel 6.2A) — usado
// enquanto nao ha webhook configurado no painel MP. Consulta a API do MP pelo
// providerPaymentId ja salvo em cada pedido pendente e confirma quando (e só
// quando) o pagamento está "approved" e valor/txid batem. NAO gera Pix, NAO
// mexe no serializador do cliente nem no fallback manual — só lê pedidos já
// existentes e, quando elegível, atualiza pix.status/pixConfirmado, igual ao
// que o webhook (route.ts) já faz.

type PedidoReconciliavel = PedidoComPix & { pixConfirmado?: boolean };

export type ReconciliacaoOutcome = "confirmado" | "pendente" | "ignorado" | "erro";

export type ReconciliacaoDetalhe = {
  pedidoId: string;
  outcome: ReconciliacaoOutcome;
  motivo?: string;
};

export type ResumoReconciliacaoPix = {
  verificados: number;
  confirmados: number;
  pendentes: number;
  ignorados: number;
  erros: number;
  detalhes: ReconciliacaoDetalhe[];
};

function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

// Critérios de elegibilidade (Nivel 6.2A, item 3): provider mercadopago,
// providerPaymentId salvo, ainda não confirmado por nenhum caminho, e com id
// de pedido válido (defensivo — nunca deveria faltar em pedidos reais).
export function elegivelParaReconciliacao(pedido: PedidoReconciliavel): boolean {
  return (
    typeof pedido.id === "string" &&
    pedido.id.length > 0 &&
    pedido.pix?.provider === "mercadopago" &&
    typeof pedido.pix?.providerPaymentId === "string" &&
    pedido.pix.providerPaymentId.trim().length > 0 &&
    pedido.pix?.status !== "confirmado" &&
    pedido.pixConfirmado !== true
  );
}

export function selecionarPedidosPixMercadoPagoPendentes(
  pedidos: PedidoReconciliavel[]
): PedidoReconciliavel[] {
  return pedidos.filter(elegivelParaReconciliacao);
}

export async function reconciliarPixMercadoPago(): Promise<ResumoReconciliacaoPix> {
  const pedidos = (await redis.get<PedidoReconciliavel[]>("pedidos")) || [];
  const elegiveis = selecionarPedidosPixMercadoPagoPendentes(pedidos);

  const resumo: ResumoReconciliacaoPix = {
    verificados: 0,
    confirmados: 0,
    pendentes: 0,
    ignorados: 0,
    erros: 0,
    detalhes: [],
  };
  if (elegiveis.length === 0) return resumo;

  let atualizados = pedidos;
  let mudou = false;

  for (const pedido of elegiveis) {
    resumo.verificados++;
    const pedidoId = pedido.id as string;
    const paymentId = (pedido.pix?.providerPaymentId as string).trim();

    try {
      const pagamento = await buscarPagamentoMercadoPago(paymentId);
      if (!pagamento) {
        resumo.erros++;
        resumo.detalhes.push({ pedidoId, outcome: "erro", motivo: "pagamento_indisponivel" });
        continue;
      }

      const statusInterno = mapearStatusMercadoPago(pagamento.status);
      if (statusInterno === "pendente") {
        resumo.pendentes++;
        resumo.detalhes.push({ pedidoId, outcome: "pendente", motivo: pagamento.status });
        continue;
      }
      if (statusInterno !== "pago") {
        // rejected/cancelled/refunded e demais: nunca confirma.
        resumo.ignorados++;
        resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: pagamento.status });
        continue;
      }

      const valorEsperado = pedido.pix?.valorEsperado;
      if (typeof valorEsperado !== "number" || !Number.isFinite(valorEsperado)) {
        resumo.ignorados++;
        resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: "pix_valor_esperado_ausente" });
        continue;
      }
      if (pagamento.transactionAmount === null || emCentavos(pagamento.transactionAmount) !== emCentavos(valorEsperado)) {
        resumo.ignorados++;
        resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: "valor_divergente" });
        continue;
      }
      // external_reference só bloqueia quando ambos existem e divergem —
      // ausência de qualquer um dos dois lados não impede a confirmação.
      if (pedido.pix?.txid && pagamento.externalReference && pagamento.externalReference !== pedido.pix.txid) {
        resumo.ignorados++;
        resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: "external_reference_divergente" });
        continue;
      }

      const index = atualizados.findIndex((p) => p.id === pedidoId);
      if (index < 0) {
        resumo.erros++;
        resumo.detalhes.push({ pedidoId, outcome: "erro", motivo: "pedido_nao_encontrado" });
        continue;
      }

      const confirmadoEm = new Date().toISOString();
      atualizados = [...atualizados];
      atualizados[index] = {
        ...atualizados[index],
        pixConfirmado: true,
        pix: {
          ...atualizados[index].pix,
          status: "confirmado",
          confirmadoPor: "conciliador_mercadopago",
          confirmadoEm,
          providerPaymentId: pagamento.id,
        },
      };
      mudou = true;

      resumo.confirmados++;
      resumo.detalhes.push({ pedidoId, outcome: "confirmado" });
    } catch (err) {
      resumo.erros++;
      resumo.detalhes.push({
        pedidoId,
        outcome: "erro",
        motivo: err instanceof Error ? err.message : "erro_desconhecido",
      });
    }
  }

  if (mudou) await redis.set("pedidos", atualizados);

  return resumo;
}
