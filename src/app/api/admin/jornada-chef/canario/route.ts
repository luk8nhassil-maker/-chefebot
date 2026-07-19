import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigJornadaChef, adicionarClienteCanario, removerClienteCanario, listarClientesCanario } from "@/lib/jornadaChef";

// GET/POST/DELETE /api/admin/jornada-chef/canario — gerencia a lista de
// clientes autorizados no modo de rollout "canary" (rule 5). O telefone do
// cliente de teste é sanitizado e convertido em clienteId só em memória, no
// servidor; a persistência e todas as respostas usam apenas uma referência
// opaca (idPublico) e um rótulo mascarado — nunca telefone, clienteId ou o
// HMAC completo.

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
    const { idPublico, labelMascarado } = await adicionarClienteCanario(telefone);
    return NextResponse.json({ ok: true, idPublico, labelMascarado });
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

  const idPublico = new URL(req.url).searchParams.get("idPublico") ?? "";
  if (!idPublico) return NextResponse.json({ ok: false, error: "idPublico obrigatorio" }, { status: 400 });

  await removerClienteCanario(idPublico);
  return NextResponse.json({ ok: true });
}
