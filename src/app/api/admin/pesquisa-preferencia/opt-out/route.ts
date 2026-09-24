// POST /api/admin/pesquisa-preferencia/opt-out
//
// Registro operacional de opt-out do primeiro piloto.
// Única escrita permitida: namespace isolado pesquisa:optout:v1:*.
// Preview/dev são bloqueados no servidor para nunca escrever no Redis real.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { registrarOptOutPesquisa } from "@/lib/pesquisaPreferenciaOptOutRedis";

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
      { error: "Opt-out real bloqueado fora de producao" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const telefone = (body as { telefone?: unknown }).telefone;
  if (typeof telefone !== "string" || !telefone.trim()) {
    return NextResponse.json({ error: "Telefone invalido" }, { status: 400 });
  }

  const registrado = await registrarOptOutPesquisa({ telefone });
  if (!registrado) {
    return NextResponse.json(
      { error: "Identidade invalida para opt-out" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { ok: true, optOut: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
