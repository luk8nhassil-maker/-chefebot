// GET /api/dev/infra — painel somente leitura da "Saúde da Infraestrutura"
// Railway (postgres-volume, crescimento, previsão, alertas, serviços).
// Mesmo padrão de autenticação de /api/dev/mcp (JWT no cookie auth-token,
// role 'dev'). Não altera o contrato de /api/dev/mcp. Sem POST/PUT/PATCH/DELETE.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { buildInfraSnapshot } from "@/infra/railway/readModel";

function isFeatureEnabled(): boolean {
  return process.env.DEV_INFRA_MONITOR_ENABLED === "true";
}

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

  try {
    const snapshot = await buildInfraSnapshot(isFeatureEnabled());
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("[api/dev/infra] Falha inesperada:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Monitor de infraestrutura indisponível" }, { status: 503 });
  }
}

// Nenhum POST, PUT, DELETE ou PATCH — painel somente leitura
