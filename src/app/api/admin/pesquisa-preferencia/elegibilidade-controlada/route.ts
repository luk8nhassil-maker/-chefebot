// POST /api/admin/pesquisa-preferencia/elegibilidade-controlada
//
// Dry-run individual do gate do primeiro piloto. SOMENTE LEITURA:
// - não envia WhatsApp;
// - não registra contato;
// - não altera pedido/Pix/fidelidade/estoque;
// - não persiste telefone nem devolve PII.
//
// As duas fontes ainda não automatizadas (checkout web e disputa externa)
// precisam ser declaradas explicitamente; omissão mantém fail-closed.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { avaliarElegibilidadeContatoPesquisaCompleta } from "@/lib/pesquisaPreferenciaElegibilidadeCompleta.server";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function POST(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const entrada = body as {
    telefone?: unknown;
    checkoutWebEmAndamento?: unknown;
    disputaOuEstornoExternoAberto?: unknown;
  };

  if (typeof entrada.telefone !== "string" || !entrada.telefone.trim()) {
    return NextResponse.json({ error: "Telefone invalido" }, { status: 400 });
  }

  const sinaisControlados = {
    ...(typeof entrada.checkoutWebEmAndamento === "boolean"
      ? { checkoutWebEmAndamento: entrada.checkoutWebEmAndamento }
      : {}),
    ...(typeof entrada.disputaOuEstornoExternoAberto === "boolean"
      ? {
          disputaOuEstornoExternoAberto:
            entrada.disputaOuEstornoExternoAberto,
        }
      : {}),
  };

  const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
    telefone: entrada.telefone,
    sinaisControlados,
  });

  return NextResponse.json(
    {
      ok: true,
      modo: "dry-run-controlado",
      elegibilidade: resultado.elegibilidade,
      diagnostico: resultado.diagnostico,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-ChefeBot-Research-Mode": "dry-run-controlado",
      },
    }
  );
}
