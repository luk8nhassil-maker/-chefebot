import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { montarStatusPublicoPedido, type PedidoStatusPublicoFonte } from "@/lib/pedidoStatusPublico";

type PedidoComToken = PedidoStatusPublicoFonte & {
  statusToken?: string;
  acompanhamentoToken?: string;
};

function tokenDoPedido(pedido: PedidoComToken): string {
  return String(pedido.statusToken || pedido.acompanhamentoToken || "");
}

function tokensIguais(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  const token = req.nextUrl.searchParams.get("token")?.trim();

  if (!id || !token) {
    return NextResponse.json({ error: "id e token obrigatórios" }, { status: 400 });
  }

  const pedidos = (await redis.get<PedidoComToken[]>("pedidos")) || [];
  const pedido = pedidos.find((item) => item.id === id);

  if (!pedido || !tokensIguais(tokenDoPedido(pedido), token)) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  return NextResponse.json(montarStatusPublicoPedido(pedido));
}
