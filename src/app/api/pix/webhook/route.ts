import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { avaliarWebhookPixPassivo, type PedidoComPix, type PixWebhookPayload } from "@/lib/pix";

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as PixWebhookPayload;
    const pedidos = (await redis.get<PedidoComPix[]>("pedidos")) || [];
    const resultado = avaliarWebhookPixPassivo(payload, pedidos);

    return NextResponse.json({
      ok: true,
      passive: true,
      ...resultado,
    });
  } catch {
    return NextResponse.json(
      { ok: false, passive: true, wouldConfirm: false, reason: "payload_invalido" },
      { status: 400 }
    );
  }
}
