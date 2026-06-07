import { NextRequest, NextResponse } from "next/server";
import { createToken } from "@/lib/auth";
import { getFuncionarios } from "@/app/api/funcionarios/route";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const u = username.toLowerCase().trim();

  // Dev — acesso exclusivo Ominix (hardcoded, nunca exposto)
  if (u === "ominix" && password === "@Controle250") {
    const devUser = { username: "ominix", name: "Ominix Dev", role: "dev" as const };
    const token = await createToken(devUser);
    const res = NextResponse.json({ name: "Ominix Dev", role: "dev" });
    const cookieOpts = { path: "/", maxAge: 60 * 60 * 24 * 7, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
    res.cookies.set("auth-token", token, { ...cookieOpts, httpOnly: true });
    res.cookies.set("auth-user", JSON.stringify({ name: "Ominix Dev", role: "dev" }), { ...cookieOpts, httpOnly: false });
    return res;
  }

  // Admin — hardcoded por segurança
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";
  if (u === "brito" && password === adminPassword) {
    const adminUser = { username: "brito", name: "Brito", role: "admin" as const };
    const token = await createToken(adminUser);
    const res = NextResponse.json({ name: "Brito", role: "admin" });
    const cookieOpts = { path: "/", maxAge: 60 * 60 * 24 * 7, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
    res.cookies.set("auth-token", token, { ...cookieOpts, httpOnly: true });
    res.cookies.set("auth-user", JSON.stringify({ name: "Brito", role: "admin" }), { ...cookieOpts, httpOnly: false });
    return res;
  }

  // Funcionários — busca no Redis
  const funcionarios = await getFuncionarios();
  const funcionario = funcionarios.find(f => f.username === u);
  if (!funcionario) return NextResponse.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
  if (!funcionario.ativo) return NextResponse.json({ error: "Acesso bloqueado. Fale com o administrador." }, { status: 401 });
  if (funcionario.password !== password) return NextResponse.json({ error: "Usuário ou senha incorretos." }, { status: 401 });

  const authUser = { username: funcionario.username, name: funcionario.name, role: funcionario.role };
  const token = await createToken(authUser);
  const res = NextResponse.json({ name: funcionario.name, role: funcionario.role });
  const cookieOpts = { path: "/", maxAge: 60 * 60 * 24 * 7, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  res.cookies.set("auth-token", token, { ...cookieOpts, httpOnly: true });
  res.cookies.set("auth-user", JSON.stringify({ name: funcionario.name, role: funcionario.role }), { ...cookieOpts, httpOnly: false });
  return res;
}