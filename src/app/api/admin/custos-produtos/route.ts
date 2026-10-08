import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  obterConfigCustosProdutos,
  salvarConfigCustosProdutos,
  resumirConfigCustosProdutosComHistorico,
  validarIngrediente,
  validarReceita,
} from "@/lib/produtoCustosConfig.server";

async function autorizado(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return Boolean(payload && ["admin", "dev"].includes(String(payload.role)));
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await obterConfigCustosProdutos();
  const resumo = await resumirConfigCustosProdutosComHistorico(config);
  return NextResponse.json({ ok: true, ...resumo });
}

/**
 * Salva um ingrediente ou receita por vez. A escrita é pequena e idempotente:
 * a mesma chave atualiza o registro, sem criar histórico por cada leitura.
 */
export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }
  const config = await obterConfigCustosProdutos();
  const tipo = body.tipo;
  if (tipo === "ingrediente") {
    const ingrediente = validarIngrediente(body.ingrediente);
    if (!ingrediente) return NextResponse.json({ error: "Ingrediente invalido" }, { status: 400 });
    const ingredientes = [...config.ingredientes.filter((item) => item.id !== ingrediente.id), ingrediente].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    await salvarConfigCustosProdutos({ ...config, ingredientes });
    return NextResponse.json({ ok: true, ingrediente });
  }
  if (tipo === "receita") {
    const receita = validarReceita(body.receita);
    if (!receita) return NextResponse.json({ error: "Receita invalida" }, { status: 400 });
    const receitas = [...config.receitas.filter((item) => item.produtoId !== receita.produtoId), receita].sort((a, b) => a.nomeProduto.localeCompare(b.nomeProduto, "pt-BR"));
    await salvarConfigCustosProdutos({ ...config, receitas });
    return NextResponse.json({ ok: true, receita });
  }
  return NextResponse.json({ error: "tipo deve ser ingrediente ou receita" }, { status: 400 });
}
