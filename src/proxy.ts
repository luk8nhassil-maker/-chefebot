import { NextRequest, NextResponse } from "next/server";
import { ROUTE_ROLES, verifyToken, type Role } from "@/lib/auth";
import { ehRotaOperacionalAssinatura } from "@/lib/assinaturaChefeBotUi";

const CARDAPIO_DOMAIN = "chefedapizza.com.br";
const LEGACY_PRODUCTION_ALIAS = "chefebot-pjif.vercel.app";

function getHostname(req: NextRequest): string {
  const raw = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return raw.split(",")[0]!.trim().split(":")[0]!.toLowerCase();
}

function veioDaTelaPedidos(req: NextRequest): boolean {
  const referer = req.headers.get("referer");
  if (!referer) return false;
  try {
    return (new URL(referer).pathname.replace(/\/+$/, "") || "/") === "/pedidos";
  } catch {
    return false;
  }
}

async function bloquearNovoPedidoSeAssinaturaSuspensa(req: NextRequest) {
  try {
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
    // Falha na consulta operacional é fail-open; a API de criação mantém as
    // próprias validações server-side e não derruba um checkout saudável.
    return NextResponse.next();
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hostname = getHostname(req);

  if (hostname === LEGACY_PRODUCTION_ALIAS && ehRotaOperacionalAssinatura(pathname)) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.hostname = CARDAPIO_DOMAIN;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (hostname === LEGACY_PRODUCTION_ALIAS && pathname === "/api/pedido-app" && req.method === "POST") {
    return NextResponse.json(
      {
        ok: false,
        code: "PEDIDOS_TEMPORARIAMENTE_INDISPONIVEIS",
        error: "Pedidos temporariamente indisponíveis. Tente novamente mais tarde.",
      },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  }

  if (pathname === "/" && hostname === CARDAPIO_DOMAIN) {
    const url = req.nextUrl.clone();
    url.pathname = "/cardapio";
    return NextResponse.rewrite(url);
  }

  if (pathname === "/api/pedido-app") {
    if (req.method !== "POST") return NextResponse.next();
    return bloquearNovoPedidoSeAssinaturaSuspensa(req);
  }

  const rule = ROUTE_ROLES.find((route) => pathname.startsWith(route.path));
  if (rule) {
    const token = req.cookies.get("auth-token")?.value;
    const usuario = token ? await verifyToken(token) : null;
    if (!usuario || !rule.roles.includes(usuario.role as Role)) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (
    pathname === "/api/orders" &&
    req.method === "GET" &&
    req.nextUrl.searchParams.get("arquivados") !== "true" &&
    veioDaTelaPedidos(req)
  ) {
    const destino = req.nextUrl.clone();
    destino.pathname = "/api/orders-painel";
    return NextResponse.rewrite(destino);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/pedidos/:path*",
    "/conversas/:path*",
    "/cardapio/:path*",
    "/relatorios/:path*",
    "/admin/:path*",
    "/dev/:path*",
    "/configuracoes/:path*",
    "/integracoes/:path*",
    "/setup/:path*",
    "/financeiro/:path*",
    "/contador/:path*",
    "/api/orders",
    "/api/pedido-app",
  ],
};
