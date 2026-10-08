import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { consultarSimulacaoAutopilot } from '@/lib/rankingAutopilotReadModel.server'
import { TENANT_PADRAO_ANALYTICS } from '@/lib/historicoAnalitico'

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  return payload && ['admin', 'dev'].includes(payload.role as string) ? payload : null
}

/** Leitura pura: mostra o que o robô faria, sem executar a decisão. */
export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const tenantId = (req.nextUrl.searchParams.get('tenantId') ?? TENANT_PADRAO_ANALYTICS).trim() || TENANT_PADRAO_ANALYTICS
  if (tenantId !== TENANT_PADRAO_ANALYTICS) {
    return NextResponse.json({ error: 'tenantId indisponivel nesta loja' }, { status: 400 })
  }

  try {
    const simulacao = await consultarSimulacaoAutopilot(tenantId)
    return NextResponse.json({
      ok: true,
      modo: 'simulacao',
      executado: false,
      decisao: simulacao.decisao,
      plano: simulacao.plano,
      sinaisControle: simulacao.sinaisControle,
      entrada: simulacao.entrada,
      fonte: simulacao.fonte,
      janelas: {
        atual: { inicioIso: new Date(simulacao.janelaAtual.inicioMs).toISOString(), fimIso: new Date(simulacao.janelaAtual.fimMs).toISOString() },
        anterior: { inicioIso: new Date(simulacao.janelaAnterior.inicioMs).toISOString(), fimIso: new Date(simulacao.janelaAnterior.fimMs).toISOString() },
      },
      metricas: {
        atual: simulacao.metricasAtual,
        anterior: simulacao.metricasAnterior,
      },
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch {
    return NextResponse.json({ ok: false, error: 'Falha ao consultar historico para simulacao' }, { status: 500 })
  }
}

