import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { behaviorAnalyticsEnabled } from "@/lib/behaviorAnalytics";
import { consultarTimelineComportamentalCliente } from "@/lib/behaviorAnalyticsRead";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { buscarClientePorTelefone, sanitizeTelefoneCliente } from "@/lib/clientes";

const PERIODOS = new Set([7, 30, 60, 90]);

async function adminAutorizado(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return !!payload && (payload.role === "admin" || payload.role === "dev");
}

export async function POST(req: NextRequest) {
  if (!behaviorAnalyticsEnabled()) {
    return NextResponse.json(
      { error: "Recurso indisponivel" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!(await adminAutorizado(req))) {
    return NextResponse.json(
      { error: "Nao autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { telefone?: unknown; periodo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "JSON invalido" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const telefone = sanitizeTelefoneCliente(body.telefone);
  const clienteId = derivarClienteIdPorTelefone(telefone);
  if (!clienteId) {
    return NextResponse.json(
      { error: "Telefone invalido" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const dias = Number(body.periodo ?? 30);
  if (!PERIODOS.has(dias)) {
    return NextResponse.json(
      { error: "periodo deve ser 7, 30, 60 ou 90" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const endMs = Date.now();
  const startMs = endMs - dias * 24 * 60 * 60 * 1000;
  const [timeline, perfil] = await Promise.all([
    consultarTimelineComportamentalCliente({ clienteId, startMs, endMs }),
    buscarClientePorTelefone(telefone).catch(() => null),
  ]);

  return NextResponse.json(
    {
      ok: true,
      periodoDias: dias,
      cliente: perfil
        ? {
            nome: perfil.nome ?? null,
            apelido: perfil.apelido ?? null,
            cadastradoEm: perfil.createdAt,
          }
        : null,
      timeline,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-ChefeBot-Analytics": "behavior-customer-v1",
      },
    },
  );
}
