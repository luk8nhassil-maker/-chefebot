import { NextRequest, NextResponse } from "next/server";

function veioDaTelaPedidos(req: NextRequest): boolean {
  const referer = req.headers.get("referer");
  if (!referer) return false;
  try {
    const pathname = new URL(referer).pathname.replace(/\/+$/, "") || "/";
    return pathname === "/pedidos";
  } catch {
    return false;
  }
}

/**
 * Next.js 16 Proxy, restrito EXCLUSIVAMENTE a GET /api/orders originado da
 * tela /pedidos. Assim o painel ganha a projeção do expediente sem alterar o
 * contrato histórico de /api/orders para Financeiro, detalhe, integrações ou
 * qualquer outro consumidor.
 */
export function proxy(req: NextRequest) {
  if (req.method !== "GET") return NextResponse.next();
  if (req.nextUrl.searchParams.get("arquivados") === "true") return NextResponse.next();
  if (!veioDaTelaPedidos(req)) return NextResponse.next();

  const destino = req.nextUrl.clone();
  destino.pathname = "/api/orders-painel";
  return NextResponse.rewrite(destino);
}

export const config = {
  matcher: "/api/orders",
};
