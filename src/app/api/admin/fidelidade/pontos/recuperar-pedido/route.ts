import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { previsualizarRecuperacaoCreditoPontosPedidoAdmin, recuperarCreditoPontosPedidoAdmin } from "@/lib/fidelidade";

// Recuperação administrativa auditada de pontos (Nível 6.7): cobre só o caso
// em que o crédito automático foi corretamente recusado por
// `PEDIDO_ANTERIOR_ATIVACAO` mas a ativação individual foi comprovadamente
// executada antes da compra (falha de persistência/registro da ativação, não
// falha de regra). Mesmo padrão de autenticação de
// /api/admin/mercadopago/reconciliar-pix.

async function requireAdminOrDev(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { ok: false as const, status: 401 };

  const user = await verifyToken(token);
  if (!user) return { ok: false as const, status: 401 };
  if (user.role !== "admin" && user.role !== "dev") return { ok: false as const, status: 403 };

  return { ok: true as const, user };
}

// Prévia somente-leitura usada pela confirmação obrigatória no painel admin
// antes de reprocessar (não credita nada).
export async function GET(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "Nao autorizado" }, { status: auth.status });

  const pedidoId = req.nextUrl.searchParams.get("pedidoId")?.trim() ?? "";
  if (!pedidoId) return NextResponse.json({ ok: false, error: "pedidoId e obrigatorio" }, { status: 400 });

  const previa = await previsualizarRecuperacaoCreditoPontosPedidoAdmin(pedidoId);
  if (!previa.encontrado) return NextResponse.json({ ok: false, error: "Pedido nao encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true, ...previa });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "Nao autorizado" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const pedidoId = typeof body?.pedidoId === "string" ? body.pedidoId.trim() : "";
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
  if (!pedidoId || !motivo) {
    return NextResponse.json({ ok: false, error: "pedidoId e motivo sao obrigatorios" }, { status: 400 });
  }

  // Só pedidoId e motivo são aceitos do corpo — pontos, clienteId, telefone,
  // saldo, status e origem do proprietário nunca são lidos do request, ainda
  // que enviados: pontos e proprietário sempre vêm do servidor.
  const resultado = await recuperarCreditoPontosPedidoAdmin(pedidoId, {
    motivo,
    adminId: auth.user.username,
  });

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, pedidoId: resultado.pedidoId, numero: resultado.numero, motivoRecusa: resultado.motivoRecusa },
      { status: resultado.motivoRecusa === "PEDIDO_INVALIDO" ? 404 : 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    pedidoId: resultado.pedidoId,
    numero: resultado.numero,
    pontosCreditados: resultado.pontosCreditados,
    eventoId: resultado.eventoId,
    jaExistia: resultado.jaExistia,
  });
}
