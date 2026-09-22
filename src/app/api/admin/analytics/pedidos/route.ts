// GET /api/admin/analytics/pedidos — métricas analíticas de pedidos entregues.
//
// Leitura pura: nenhum dado é criado, modificado ou excluído aqui.
// Autenticação: somente roles admin/dev (mesmo padrão das demais rotas admin).
//
// Parâmetros:
//   ?tenantId=<id>   (default: "default")
//   ?periodo=7|30|60|90  (default: 30 — dias retroativos a partir de agora)
//
// Resposta: MetricasAnaliticas agregadas + meta (período, pedidos no índice).
// Segurança: nenhuma PII na resposta; clienteId derivado nunca aparece; só
// contagens, valores monetários agregados e distribuições.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  consultarEventosPorPeriodo,
  consultarEventosAntesDe,
  calcularMetricas,
  periodo7Dias,
  periodo30Dias,
  periodo60Dias,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
} from "@/lib/historicoAnalitico";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

const PERIODOS_VALIDOS = [7, 30, 60, 90] as const;
type PeriodoDias = (typeof PERIODOS_VALIDOS)[number];

function resolverPeriodo(dias: PeriodoDias, agora: number) {
  if (dias === 7) return periodo7Dias(agora);
  if (dias === 60) return periodo60Dias(agora);
  if (dias === 90) return periodo90Dias(agora);
  return periodo30Dias(agora);
}

export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const tenantId = (params.get("tenantId") ?? TENANT_PADRAO_ANALYTICS).trim() || TENANT_PADRAO_ANALYTICS;

  const periodoParam = Number(params.get("periodo") ?? "30");
  const diasValidos: readonly number[] = PERIODOS_VALIDOS;
  if (!diasValidos.includes(periodoParam)) {
    return NextResponse.json({ error: "periodo deve ser 7, 30, 60 ou 90" }, { status: 400 });
  }
  const dias = periodoParam as PeriodoDias;

  const agora = Date.now();
  const { inicioMs, fimMs } = resolverPeriodo(dias, agora);

  try {
    const [eventos, eventosAnteriores] = await Promise.all([
      consultarEventosPorPeriodo(tenantId, inicioMs, fimMs),
      consultarEventosAntesDe(tenantId, inicioMs),
    ]);
    const clientesComHistoricoAnterior = new Set(
      eventosAnteriores
        .filter((evento) => evento.statusAnalitico === "entregue")
        .map((evento) => evento.clienteId)
    );
    const metricas = calcularMetricas(eventos, clientesComHistoricoAnterior);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        periodosDias: dias,
        inicioIso: new Date(inicioMs).toISOString(),
        fimIso: new Date(fimMs).toISOString(),
        totalEventosNoIndice: eventos.length,
        metricas,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Falha ao consultar historico analitico" }, { status: 500 });
  }
}
