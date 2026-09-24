// POST /api/admin/pesquisa-preferencia/envio-controlado
//
// Único ponto de entrada do primeiro envio real controlado.
// Segurança por camadas:
// - somente admin;
// - somente production;
// - feature flag explícita;
// - confirmação textual one-shot;
// - apenas M1/M2/M5;
// - os dois sinais ainda manuais precisam ser booleanos explícitos;
// - o serviço revalida candidato + gate dentro de lock antes do provider.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import type { MomentoPesquisaId } from "@/lib/pesquisaPreferencia";
import { executarEnvioPesquisaControlado } from "@/lib/pesquisaPreferenciaEnvioControlado.server";

const CONFIRMACAO_EXATA = "ENVIAR_PESQUISA_CONTROLADA";
const MOMENTOS_PERMITIDOS = new Set<MomentoPesquisaId>(["M1", "M2", "M5"]);

async function checkAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== "admin") return null;
  return payload;
}

export async function POST(req: NextRequest) {
  const auth = await checkAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { error: "Envio real bloqueado fora de producao" },
      { status: 403 }
    );
  }

  if (process.env.PESQUISA_PREFERENCIA_ENVIO_CONTROLADO_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Envio controlado desativado" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const entrada = body as {
    telefone?: unknown;
    momentId?: unknown;
    triggerEventId?: unknown;
    checkoutWebEmAndamento?: unknown;
    disputaOuEstornoExternoAberto?: unknown;
    confirmacao?: unknown;
  };

  if (entrada.confirmacao !== CONFIRMACAO_EXATA) {
    return NextResponse.json(
      { error: "Confirmacao de envio ausente ou invalida" },
      { status: 400 }
    );
  }

  if (typeof entrada.telefone !== "string" || !entrada.telefone.trim()) {
    return NextResponse.json({ error: "Telefone invalido" }, { status: 400 });
  }

  if (
    typeof entrada.momentId !== "string" ||
    !MOMENTOS_PERMITIDOS.has(entrada.momentId as MomentoPesquisaId)
  ) {
    return NextResponse.json({ error: "Momento invalido" }, { status: 400 });
  }

  if (
    typeof entrada.triggerEventId !== "string" ||
    !entrada.triggerEventId.trim()
  ) {
    return NextResponse.json({ error: "Gatilho invalido" }, { status: 400 });
  }

  if (
    typeof entrada.checkoutWebEmAndamento !== "boolean" ||
    typeof entrada.disputaOuEstornoExternoAberto !== "boolean"
  ) {
    return NextResponse.json(
      { error: "Sinais controlados precisam ser confirmados explicitamente" },
      { status: 400 }
    );
  }

  const resultado = await executarEnvioPesquisaControlado({
    telefone: entrada.telefone,
    momentId: entrada.momentId as MomentoPesquisaId,
    triggerEventId: entrada.triggerEventId,
    checkoutWebEmAndamento: entrada.checkoutWebEmAndamento,
    disputaOuEstornoExternoAberto: entrada.disputaOuEstornoExternoAberto,
  });

  const statusHttp =
    resultado.status === "enviado" ||
    resultado.status === "ja_enviado_reconciliado"
      ? 200
      : resultado.status === "envio_nao_realizado"
        ? 502
        : 409;

  return NextResponse.json(
    {
      ok:
        resultado.status === "enviado" ||
        resultado.status === "ja_enviado_reconciliado",
      resultado,
    },
    {
      status: statusHttp,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-ChefeBot-Research-Mode": "controlled-one-shot",
      },
    }
  );
}
