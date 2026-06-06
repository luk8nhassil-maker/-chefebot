import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";

export type Funcionario = {
  username: string;
  name: string;
  password: string;
  ativo: boolean;
  role: "atendente";
};

const FUNCIONARIOS_PADRAO: Funcionario[] = [
  { username: "kellyne", name: "Kellyne", password: process.env.KELLYNE_PASSWORD ?? "kellyne123", ativo: true, role: "atendente" },
  { username: "salao", name: "Atendente Salão", password: process.env.SALAO_PASSWORD ?? "salao123", ativo: true, role: "atendente" },
];

export async function getFuncionarios(): Promise<Funcionario[]> {
  const saved = await redis.get<Funcionario[]>("funcionarios");
  return saved ?? FUNCIONARIOS_PADRAO;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await verifyToken(token);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const funcionarios = await getFuncionarios();
  return NextResponse.json(funcionarios);
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await verifyToken(token);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json();
  const funcionarios = await getFuncionarios();
  const index = funcionarios.findIndex(f => f.username === body.username);
  if (index === -1) return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  if (body.password !== undefined && body.password.trim() !== "") {
    funcionarios[index].password = body.password.trim();
  }
  if (body.ativo !== undefined) {
    funcionarios[index].ativo = body.ativo;
  }
  if (body.name !== undefined && body.name.trim() !== "") {
    funcionarios[index].name = body.name.trim();
  }
  await redis.set("funcionarios", funcionarios);
  return NextResponse.json({ ok: true, funcionarios });
}