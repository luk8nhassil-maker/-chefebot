import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { consultarEventosAnaliticosComFallback } from '@/lib/analyticsPedidosReadModel.server'
import { obterTemporadaAtiva } from '@/lib/temporadas'
import { obterRankingCompleto } from '@/lib/rankingClientes'
import { cruzarGrupoComRanking } from '@/lib/rankingAuditoria'

const TENANT_PADRAO = 'default'
const MS_DIA = 24 * 60 * 60 * 1000

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['admin', 'dev'].includes(payload.role as string)) return null
  return payload
}

/** Auditoria sob demanda: somente contagem e posições, nunca PII. */
export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const tenantId = (req.nextUrl.searchParams.get('tenantId') ?? TENANT_PADRAO).trim() || TENANT_PADRAO
  const temporada = await obterTemporadaAtiva(tenantId)
  if (!temporada?.ativadaEm) {
    return NextResponse.json({ ok: true, temporadaAtiva: false, totalClientes5Mais: 0, totalNoTop10: 0, posicoes: [] })
  }

  const inicioMs = Date.parse(temporada.ativadaEm)
  if (!Number.isFinite(inicioMs)) {
    return NextResponse.json({ error: 'inicio_temporada_invalido' }, { status: 500 })
  }

  const agora = Date.now()
  const fimConfigurado = temporada.fimEm ? Date.parse(temporada.fimEm) : inicioMs + (temporada.duracaoDias ?? 30) * MS_DIA
  const fimMs = Math.min(agora, Number.isFinite(fimConfigurado) ? fimConfigurado : agora)
  const leitura = await consultarEventosAnaliticosComFallback(tenantId, inicioMs, fimMs, agora, { incluirIndiceCompleto: true })
  const pedidosPorCliente = new Map<string, number>()
  for (const evento of leitura.eventos) {
    if (evento.statusAnalitico !== 'entregue' || !evento.clienteId) continue
    pedidosPorCliente.set(evento.clienteId, (pedidosPorCliente.get(evento.clienteId) ?? 0) + 1)
  }

  const ranking = await obterRankingCompleto(tenantId, temporada.temporadaId)
  const resultado = cruzarGrupoComRanking(
    [...pedidosPorCliente].map(([clienteId, pedidos]) => ({ clienteId, pedidos })),
    ranking,
  )

  return NextResponse.json({
    ok: true,
    temporadaAtiva: true,
    janelaInicioIso: new Date(inicioMs).toISOString(),
    janelaFimIso: new Date(fimMs).toISOString(),
    ...resultado,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
