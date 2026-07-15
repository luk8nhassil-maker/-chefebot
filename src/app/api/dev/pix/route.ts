// GET /api/dev/pix — painel técnico somente leitura do Sentinela Pix.
// Requer role 'dev' via JWT no cookie auth-token (mesmo padrão de
// /api/dev/mcp). Nenhum método de escrita existe neste endpoint — nenhuma
// ação financeira, nenhum reprocessamento, nenhuma consulta ao Mercado Pago
// é disparada por esta rota.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { montarPainelPixDashboard, type PainelPixDashboard } from "@/lib/pixDashboardMetricas";

// Cache curto em memória do processo — só evita reler "pedidos" inteiro em
// cliques repetidos/rápidos no botão "Atualizar dados" dentro da mesma
// instância serverless quente. Nunca serve dados de outra sessão/usuário
// (a resposta não contém PII), nunca é usado para decisão financeira, e
// nunca impede uma leitura fresca além da janela abaixo.
const CACHE_TTL_MS = 15_000;
let cache: { dados: PainelPixDashboard; expiraEm: number } | null = null;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (payload.role !== "dev") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const agora = Date.now();
  if (cache && cache.expiraEm > agora) {
    return NextResponse.json(cache.dados);
  }

  const dados = await montarPainelPixDashboard(agora);
  cache = { dados, expiraEm: agora + CACHE_TTL_MS };
  return NextResponse.json(dados);
}

// Nenhum POST, PUT, DELETE ou PATCH — painel somente leitura
