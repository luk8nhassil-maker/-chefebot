import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { ROUTE_ROLES } from "@/lib/auth";

function getSecret() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "chefebot-dev-secret-troque-em-producao"
  );
}

function clearAuthAndRedirect(req: NextRequest) {
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
  const res = NextResponse.redirect(loginUrl);
  res.cookies.set("auth-token", "", { maxAge: 0, path: "/" });
  res.cookies.set("auth-user", "", { maxAge: 0, path: "/" });
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const rule = ROUTE_ROLES.find((r) => pathname.startsWith(r.path));
  if (!rule) return NextResponse.next();

  const token = req.cookies.get("auth-token")?.value;
  if (!token) return clearAuthAndRedirect(req);

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role = payload.role as string;
    if (!rule.roles.includes(role as any)) return clearAuthAndRedirect(req);
    return NextResponse.next();
  } catch {
    return clearAuthAndRedirect(req);
  }
}

export const config = {
  matcher: ["/pedidos/:path*", "/relatorios/:path*", "/admin/:path*", "/dev/:path*", "/api/orders/:path*", "/api/padroes/:path*", "/api/funcionarios/:path*"],
};