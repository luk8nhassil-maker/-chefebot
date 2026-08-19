import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";
import { getFuncionarios, type Funcionario } from "@/lib/funcionarios";

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return false;
  const user = await verifyToken(token);
  return user?.role === "admin" || user?.role === "dev";
}

export async function GET(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const funcs = await getFuncionarios();
  return NextResponse.json(funcs.map(f => ({ ...f, password: "••••••" })));
}

export async function POST(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const body = await req.json();
  if (!body.username || !body.name || !body.password) return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  const funcs = await getFuncionarios();
  if (funcs.find(f => f.username === body.username)) return NextResponse.json({ error: "Usuario ja existe" }, { status: 400 });
  const novo: Funcionario = { username: body.username, name: body.name, password: body.password, ativo: true, role: body.role || "atendente" };
  await redis.set("funcionarios", [...funcs, novo]);
  return NextResponse.json({ ...novo, password: "••••••" });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const body = await req.json();
  if (!body.username) return NextResponse.json({ error: "Username obrigatorio" }, { status: 400 });
  const funcs = await getFuncionarios();
  const index = funcs.findIndex(f => f.username === body.username);
  if (index === -1) return NextResponse.json({ error: "Funcionario nao encontrado" }, { status: 404 });
  if (body.name) funcs[index].name = body.name;
  if (body.password) funcs[index].password = body.password;
  if (typeof body.ativo === "boolean") funcs[index].ativo = body.ativo;
  await redis.set("funcionarios", funcs);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const body = await req.json();
  if (!body.username) return NextResponse.json({ error: "Username obrigatorio" }, { status: 400 });
  const funcs = await getFuncionarios();
  const filtered = funcs.filter(f => f.username !== body.username);
  await redis.set("funcionarios", filtered);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const body = await req.json();
  if (!body.username || !body.name || !body.password) return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  const funcs = await getFuncionarios();
  if (funcs.find(f => f.username === body.username)) return NextResponse.json({ error: "Usuario ja existe" }, { status: 400 });
  const novo: Funcionario = { username: body.username, name: body.name, password: body.password, ativo: true, role: body.role || "atendente" };
  await redis.set("funcionarios", [...funcs, novo]);
  return NextResponse.json({ ok: true });
}
