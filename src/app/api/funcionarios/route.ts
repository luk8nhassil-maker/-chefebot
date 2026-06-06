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

async function checkAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return false;
  const user = await verifyToken(token);
  return user?.role === "admin";
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const funcionarios = await getFuncionarios();
  return NextResponse.json(funcionarios);
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json();

  // Criar novo funcionário
  if (body.action === "criar") {
    if (!body.username || !body.name || !body.password) {
      return NextResponse.json({ error: "Preencha todos os campos." }, { status: 400 });
    }
    const funcionarios = await getFuncionarios();
    const jaExiste = funcionarios.find(f => f.username === body.username.toLowerCase().trim());
    if (jaExiste) return NextResponse.json({ error: "Usuário já existe." }, { status: 400 });
    const novo: Funcionario = {
      username: body.username.toLowerCase().trim(),
      name: body.name.trim(),
      password: body.password.trim(),
      ativo: true,
      role: "atendente",
    };
    await redis.set("funcionarios", [...funcionarios, novo]);
    return NextResponse.json({ ok: true });
  }

  // Excluir funcionário
  if (body.action === "excluir") {
    const funcionarios = await getFuncionarios();
    const filtrados = funcionarios.filter(f => f.username !== body.username);
    await redis.set("funcionarios", filtrados);
    return NextResponse.json({ ok: true });
  }

  // Editar funcionário (nome, senha, ativo)
  const funcionarios = await getFuncionarios();
  const index = funcionarios.findIndex(f => f.username === body.username);
  if (index === -1) return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  if (body.password !== undefined && body.password.trim() !== "") funcionarios[index].password = body.password.trim();
  if (body.ativo !== undefined) funcionarios[index].ativo = body.ativo;
  if (body.name !== undefined && body.name.trim() !== "") funcionarios[index].name = body.name.trim();
  await redis.set("funcionarios", funcionarios);
  return NextResponse.json({ ok: true, funcionarios });
}