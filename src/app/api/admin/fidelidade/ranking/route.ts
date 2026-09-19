// GET /api/admin/fidelidade/ranking — top ranking da temporada ativa.
//
// Somente roles admin/dev. Sem PII: clienteId é ID interno anonimizado (não nome/telefone).
// Pesos de ranking PENDENTES de decisão comercial (ver rankingClientes.ts).

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterTemporadaAtiva } from "@/lib/temporadas";
import { obterTopRanking } from "@/lib/rankingClientes";

const TENANT_PADRAO = "default";
const LIMITE_MAX = 50;

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const tenantId = (params.get("tenantId") ?? TENANT_PADRAO).trim() || TENANT_PADRAO;
  const limiteRaw = parseInt(params.get("limite") ?? "10", 10);
  const limite = Number.isFinite(limiteRaw) && limiteRaw >= 1 ? Math.min(limiteRaw, LIMITE_MAX) : 10;

  const temporada = await obterTemporadaAtiva(tenantId);
  if (!temporada) {
    return NextResponse.json({
      temporadaId: null,
      ranking: [],
      nota: "aguardando configuração — nenhuma temporada ativa",
    });
  }

  const entradas = await obterTopRanking(tenantId, temporada.temporadaId, limite);

  return NextResponse.json({
    temporadaId: temporada.temporadaId,
    temporadaNome: temporada.nome ?? null,
    ranking: entradas.map((e) => ({ posicao: e.posicao, score: e.score })),
    nota: "pesos de score pendentes de decisão comercial",
  });
}
