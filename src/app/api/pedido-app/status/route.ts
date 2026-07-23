import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { buscarPedidoUnico } from "@/lib/pedidosStore";
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

  // Busca única central — nunca escolhe arbitrariamente entre registros
  // duplicados: este é o status público consultado pelo polling do
  // cardápio do cliente (autenticado só por id+token, sem sessão de
  // staff) — `multiplos_encontrados` é erro crítico sanitizado (503),
  // nunca expõe o status de um pedido possivelmente errado.
  const resultado = await buscarPedidoUnico<PedidoComToken>(id);
  if (resultado.tipo === "leitura_incerta") {
    return NextResponse.json({ error: "Não foi possível consultar o pedido agora. Tente de novo." }, { status: 503 });
  }
  if (resultado.tipo === "multiplos_encontrados") {
    console.error("[ChefeBot] pedido-app/status: múltiplos pedidos com o mesmo id — inconsistência crítica", { id });
    return NextResponse.json({ error: "Não foi possível consultar o pedido agora. Tente de novo." }, { status: 503 });
  }
  if (resultado.tipo === "nao_encontrado" || !tokensIguais(tokenDoPedido(resultado.pedido), token)) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  return NextResponse.json(montarStatusPublicoPedido(resultado.pedido));
}
