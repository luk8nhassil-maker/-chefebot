import { NextRequest, NextResponse } from "next/server";
import { createToken, type Role } from "@/lib/auth";

const ALLOWED_ROLES: Role[] = ["admin", "atendente", "dev"];

export async function GET(req: NextRequest) {
  const isNonProd = process.env.NODE_ENV !== "production";
  const explicitlyEnabled = process.env.ENABLE_DEV_AUTH === "true";
  if (!isNonProd || !explicitlyEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const role = req.nextUrl.searchParams.get("role") as Role | null;
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "role inválida. Use admin | atendente | dev" }, { status: 400 });
  }

  const user = { username: `dev-${role}`, name: `Dev QA (${role})`, role };
  const token = await createToken(user);
  const destino = role === "dev" ? "/dev" : role === "admin" ? "/admin" : "/pedidos";

  const res = NextResponse.redirect(new URL(destino, req.url));
  const cookieOpts = { path: "/", maxAge: 60 * 60 * 8, sameSite: "lax" as const, secure: false };
  res.cookies.set("auth-token", token, { ...cookieOpts, httpOnly: true });
  res.cookies.set("auth-user", JSON.stringify({ name: user.name, role: user.role }), { ...cookieOpts, httpOnly: false });
  return res;
}
