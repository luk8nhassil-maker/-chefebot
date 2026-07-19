import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigJornadaChef, adicionarClienteCanario, removerClienteCanario, listarClientesCanario } from "@/lib/jornadaChef";

// GET/POST/DELETE /api/admin/jornada-chef/canario — gerencia a lista de
// clientes autorizados no modo de rollout "canary" (rule 5). O telefone do
// cliente de teste é sanitizado e convertido em clienteId no servidor;
// nunca é persistido nem devolvido por completo em nenhuma resposta.

async function checkAuthLeitura(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await obterConfigJornadaChef();
  return NextResponse.json({ clientes: listarClientesCanario(config) });
}

export async function POST(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.role !== "admin" && auth.role !== "dev") {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const telefone = String(body?.telefone ?? "").trim();
  if (!telefone) return NextResponse.json({ ok: false, error: "telefone obrigatorio" }, { status: 400 });

  try {
    const { clienteId, identificadorMascarado } = await adicionarClienteCanario(telefone);
    return NextResponse.json({ ok: true, clienteId, identificadorMascarado });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Nao foi possivel adicionar o cliente canario" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.role !== "admin" && auth.role !== "dev") {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
  }

  const clienteId = new URL(req.url).searchParams.get("clienteId") ?? "";
  if (!clienteId) return NextResponse.json({ ok: false, error: "clienteId obrigatorio" }, { status: 400 });

  await removerClienteCanario(clienteId);
  return NextResponse.json({ ok: true });
}
