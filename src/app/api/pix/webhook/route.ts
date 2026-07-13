import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { avaliarWebhookPixPassivo, type PedidoComPix, type PixWebhookPayload } from "@/lib/pix";
import {
  isMercadoPagoWebhook,
  extrairPaymentIdMercadoPago,
  validarAssinaturaMercadoPago,
  buscarPagamentoMercadoPago,
  mapearPagamentoParaPayloadInterno,
} from "@/lib/mercadoPagoWebhook";
import { confirmarCompraECreditarPontos } from "@/lib/fidelidade";

type PedidoWebhookPix = PedidoComPix & {
  id: string;
  status: string;
  telefone?: string;
  clienteId?: string;
  clienteVinculo?: "sessao" | "telefone";
  confirmacaoCompra?: { confirmadoEm: string; origem: "pix_manual" | "pix_automatico" | "pix_webhook" | "confirmacao_operacional" };
  taxaEntrega?: number;
  criadoEm?: string;
  pixConfirmado?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json();
    const pedidos = (await redis.get<PedidoWebhookPix[]>("pedidos")) || [];
    const autoConfirm = process.env.PIX_WEBHOOK_AUTO_CONFIRM === "true";

    // Branch adaptador Mercado Pago: notificacao real do MP ({ type: "payment",
    // data: { id } }). Traduz para o payload interno e reutiliza toda a logica
    // passiva/idempotente abaixo. O webhook generico (x-pix-webhook-secret)
    // segue intacto no `else`.
    let payload: PixWebhookPayload;
    let mpAutorizado = false;

    if (isMercadoPagoWebhook(corpo)) {
      const paymentId = extrairPaymentIdMercadoPago(corpo);
      const assinaturaValida = validarAssinaturaMercadoPago({
        dataId: paymentId ?? "",
        xSignature: req.headers.get("x-signature"),
        xRequestId: req.headers.get("x-request-id"),
        secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
      });

      // Passivo (flag desligada): nunca grava e nunca chama a API do MP.
      if (!autoConfirm) {
        return NextResponse.json({ ok: true, passive: true, provider: "mercadopago", assinaturaValida });
      }
      // Ativo exige assinatura MP valida: ausente/invalida -> 401, sem gravar.
      if (!assinaturaValida || !paymentId) {
        return NextResponse.json(
          { ok: true, passive: false, provider: "mercadopago", wouldConfirm: false, reason: "assinatura_invalida" },
          { status: 401 }
        );
      }
      // Busca autoritativa: status/valor/external_reference vem da API do MP,
      // nunca do corpo da notificacao.
      const pagamento = await buscarPagamentoMercadoPago(paymentId);
      if (!pagamento) {
        return NextResponse.json({ ok: true, passive: false, provider: "mercadopago", wouldConfirm: false, reason: "pagamento_indisponivel" });
      }
      payload = mapearPagamentoParaPayloadInterno(pagamento);
      mpAutorizado = true;
    } else {
      payload = corpo as PixWebhookPayload;
    }

    const resultado = avaliarWebhookPixPassivo(payload, pedidos);

    if (!autoConfirm) {
      return NextResponse.json({
        ok: true,
        passive: true,
        ...resultado,
      });
    }

    // Autorizacao para gravar: MP ja validou por assinatura; o webhook generico
    // continua exigindo o segredo compartilhado.
    if (!mpAutorizado) {
      const expectedSecret = process.env.PIX_WEBHOOK_SECRET;
      const receivedSecret = req.headers.get("x-pix-webhook-secret");
      if (!expectedSecret || receivedSecret !== expectedSecret) {
        return NextResponse.json({
          ok: true,
          passive: false,
          wouldConfirm: false,
          reason: "segredo_invalido",
        });
      }
    }

    const index = pedidos.findIndex((p) => p.pix?.txid === payload.txid);
    const pedido = index >= 0 ? pedidos[index] : null;
    if (pedido?.pixConfirmado || pedido?.pix?.status === "confirmado") {
      return NextResponse.json({
        ok: true,
        passive: false,
        wouldConfirm: false,
        confirmed: true,
        idempotent: true,
        reason: "pix_ja_confirmado",
        pedidoId: pedido.id,
        txid: pedido.pix?.txid,
      });
    }

    if (!resultado.wouldConfirm || index < 0 || !pedido?.pix) {
      return NextResponse.json({
        ok: true,
        passive: false,
        ...resultado,
      });
    }

    const confirmadoEm = new Date().toISOString();
    const pix = {
      ...pedido.pix,
      status: "confirmado" as const,
      confirmadoPor: "webhook" as const,
      confirmadoEm,
      ...(payload.providerPaymentId ? { providerPaymentId: payload.providerPaymentId } : {}),
    };
    const atualizados = [...pedidos];
    atualizados[index] = { ...pedido, pixConfirmado: true, pix, confirmacaoCompra: pedido.confirmacaoCompra ?? { confirmadoEm, origem: "pix_webhook" } };
    await redis.set("pedidos", atualizados);
    try {
      await confirmarCompraECreditarPontos(atualizados[index].id, "pix_webhook");
    } catch (err) {
      console.error("[ChefeBot] Erro ao confirmar pontos por webhook Pix (ignorado):", err);
    }

    return NextResponse.json({
      ok: true,
      passive: false,
      confirmed: true,
      ...resultado,
      confirmadoEm,
    });
  } catch {
    return NextResponse.json(
      { ok: false, passive: true, wouldConfirm: false, reason: "payload_invalido" },
      { status: 400 }
    );
  }
}
