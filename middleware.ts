import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { ROUTE_ROLES } from "@/lib/auth";

function getSecret() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "chefebot-dev-secret-troque-em-producao"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const rule = ROUTE_ROLES.find((r) => pathname.startsWith(r.path));
  if (!rule) return NextResponse.next();

  const token = req.cookies.get("auth-token")?.value;
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role = payload.role as string;
    if (!rule.roles.includes(role as any)) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  } catch {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/pedidos/:path*", "/relatorios/:path*", "/admin/:path*", "/dev/:path*", "/configuracoes/:path*"],
};