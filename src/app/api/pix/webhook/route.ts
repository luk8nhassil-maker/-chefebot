import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { avaliarWebhookPixPassivo, type PedidoComPix, type PixWebhookPayload } from "@/lib/pix";

type PedidoWebhookPix = PedidoComPix & {
  pixConfirmado?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as PixWebhookPayload;
    const pedidos = (await redis.get<PedidoWebhookPix[]>("pedidos")) || [];
    const resultado = avaliarWebhookPixPassivo(payload, pedidos);
    const autoConfirm = process.env.PIX_WEBHOOK_AUTO_CONFIRM === "true";

    if (!autoConfirm) {
      return NextResponse.json({
        ok: true,
        passive: true,
        ...resultado,
      });
    }

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
    atualizados[index] = { ...pedido, pixConfirmado: true, pix };
    await redis.set("pedidos", atualizados);

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
