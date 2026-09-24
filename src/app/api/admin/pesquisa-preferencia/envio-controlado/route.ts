// POST /api/admin/pesquisa-preferencia/envio-controlado
//
// Único ponto de entrada do primeiro envio real controlado.
// Segurança por camadas:
// - somente admin;
// - somente production;
// - feature flag explícita;
// - confirmação textual one-shot;
// - primeiro envio restrito a um candidato M5 selecionado no servidor;
// - os dois sinais ainda manuais precisam ser booleanos explícitos;
// - o serviço revalida candidato + gate dentro de lock antes do provider.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { executarEnvioPesquisaControlado } from "@/lib/pesquisaPreferenciaEnvioControlado.server";
import { resolverCandidatoPrimeiroEnvioM5 } from "@/lib/pesquisaPreferenciaPrimeiroEnvio.server";
import { envioControladoLiberadoNestaVersao } from "@/lib/pesquisaPreferenciaRelease";

const CONFIRMACAO_EXATA = "ENVIAR_PESQUISA_CONTROLADA";

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

  if (!envioControladoLiberadoNestaVersao()) {
    return NextResponse.json(
      { error: "Envio controlado ainda nao liberado nesta versao" },
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
    candidateRef?: unknown;
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

  if (
    typeof entrada.candidateRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(entrada.candidateRef)
  ) {
    return NextResponse.json(
      { error: "Referencia de candidato invalida" },
      { status: 400 }
    );
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

  const candidato = await resolverCandidatoPrimeiroEnvioM5({
    candidateRef: entrada.candidateRef,
  });
  if (!candidato) {
    return NextResponse.json(
      { error: "Candidato M5 nao esta mais disponivel" },
      { status: 409 }
    );
  }

  const resultado = await executarEnvioPesquisaControlado({
    telefone: candidato.telefone,
    momentId: "M5",
    triggerEventId: candidato.triggerEventId,
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
