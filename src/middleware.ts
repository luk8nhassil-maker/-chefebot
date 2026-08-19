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

async function bloquearNovoPedidoSeAssinaturaSuspensa(req: NextRequest) {
  try {
    // O middleware permanece Edge-safe: não importa Redis nem código Node.
    // Consulta apenas o endpoint interno mínimo, fora do próprio matcher.
    const statusUrl = req.nextUrl.clone();
    statusUrl.pathname = "/api/assinatura/operacao";
    statusUrl.search = "";
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.next();
    const data = (await response.json().catch(() => null)) as { blocked?: unknown } | null;
    if (data?.blocked !== true) return NextResponse.next();

    return NextResponse.json(
      {
        ok: false,
        code: "PEDIDOS_TEMPORARIAMENTE_INDISPONIVEIS",
        error: "Pedidos temporariamente indisponíveis. Tente novamente mais tarde.",
      },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  } catch {
    // Falha de cobrança/status é fail-open, nunca derruba checkout saudável.
    return NextResponse.next();
  }
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/api/pedido-app") {
    if (req.method !== "POST") return NextResponse.next();
    return bloquearNovoPedidoSeAssinaturaSuspensa(req);
  }

  // Compatibilidade histórica do painel, preservada exatamente no caminho
  // /api/orders. Esta é a correção que mantém o build Vercel estável.
  if (req.method !== "GET") return NextResponse.next();
  if (req.nextUrl.searchParams.get("arquivados") === "true") return NextResponse.next();
  if (!veioDaTelaPedidos(req)) return NextResponse.next();

  const destino = req.nextUrl.clone();
  destino.pathname = "/api/orders-painel";
  return NextResponse.rewrite(destino);
}

export const config = {
  matcher: ["/api/orders", "/api/pedido-app"],
};
