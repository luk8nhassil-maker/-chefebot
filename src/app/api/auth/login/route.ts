import { NextRequest, NextResponse } from "next/server";
import { createToken, validateCredentials } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const u = username?.toLowerCase().trim();

  const user = validateCredentials(u, password);
  if (!user) return NextResponse.json({ error: "Usuário ou senha incorretos." }, { status: 401 });

  const token = await createToken(user);
  const res = NextResponse.json({ name: user.name, role: user.role });
  const cookieOpts = { path: "/", maxAge: 60 * 60 * 24 * 7, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  res.cookies.set("auth-token", token, { ...cookieOpts, httpOnly: true });
  res.cookies.set("auth-user", JSON.stringify({ name: user.name, role: user.role }), { ...cookieOpts, httpOnly: false });
  return res;
}