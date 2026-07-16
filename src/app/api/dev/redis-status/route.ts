// GET /api/dev/redis-status — painel operacional de telemetria do Redis
// (Etapa C do Programa de Saúde de Dados). Somente leitura, protegido por
// role 'dev' (mesmo padrão de /api/dev/mcp). Nunca escreve dado de negócio,
// só (no máximo) uma marca de dedup de alerta com TTL curto.

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { obterSnapshotEmMemoria, lerUsoEstimado } from '@/lib/redisTelemetry'
import { avaliarLimiaresUso, logLimiarCruzado, limiteComandosMensal, type LimiarAlerta } from '@/lib/redisUsageAlerts'
import { checkAllHealth } from '@/lib/healthChecks'

/** Marca que este limiar já foi logado neste ciclo mensal — evita log repetido a cada carregamento do painel. TTL até o fim do mês (aprox. 32 dias, sempre folgado). */
async function marcarLimiarSeNovo(limiar: LimiarAlerta): Promise<boolean> {
  const ciclo = `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`
  const chave = `telemetry:redis:alerta-marcado:${limiar}:${ciclo}`
  try {
    const marcou = await redis.set(chave, '1', { nx: true, ex: 32 * 24 * 60 * 60 })
    return marcou === 'OK'
  } catch {
    return false // falha na marca não deve impedir o painel de responder
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (payload.role !== 'dev' && payload.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }

  try {
    const [health, usoEstimado] = await Promise.all([checkAllHealth(), lerUsoEstimado(redis)])
    const memoria = obterSnapshotEmMemoria()

    const totalMensalEstimado = usoEstimado.mesAtual.total ?? 0
    const avaliacao = avaliarLimiaresUso(totalMensalEstimado)

    if (avaliacao.limiarMaisAlto) {
      const novo = await marcarLimiarSeNovo(avaliacao.limiarMaisAlto)
      if (novo) logLimiarCruzado(avaliacao)
    }

    return NextResponse.json({
      health,
      memoria,
      usoEstimado,
      alerta: avaliacao,
      configuracao: {
        limiteComandosMensal: limiteComandosMensal(),
        avisoFonte: 'Números marcados como "estimativa_interna" vêm da telemetria amostrada deste app, não da Upstash. Confira o número oficial no console da Upstash — ver docs/operations/REDIS_RUNBOOK.md.',
      },
      geradoEm: Date.now(),
    })
  } catch (err) {
    console.error('[api/dev/redis-status] Falha inesperada:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Status de telemetria indisponível' }, { status: 503 })
  }
}

// Nenhum POST, PUT, DELETE ou PATCH — painel somente leitura
