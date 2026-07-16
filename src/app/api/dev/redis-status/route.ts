// GET /api/dev/redis-status — painel operacional de AMOSTRA INTERNA do
// Redis (Etapa C do Programa de Saúde de Dados). Somente leitura, protegido
// por role 'dev'/'admin' (mesmo padrão de /api/dev/mcp). Nunca escreve dado
// de negócio, só (no máximo) uma marca de dedup de tendência com TTL curto.
//
// IMPORTANTE: todo número deste endpoint é AMOSTRA INTERNA, não o uso
// oficial da Upstash e não uma estimativa completa — ver
// src/lib/redisUsageAlerts.ts (AVISO_AMOSTRA_NAO_OFICIAL) e
// docs/architecture/REDIS_TELEMETRY.md. O campo `amostra.avisoOficial` e
// `alerta.avisoOficial` carregam esse aviso explicitamente em toda resposta
// — nenhum consumidor deve reescrever esse texto de forma resumida que
// perca o alerta.

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { obterSnapshotEmMemoria, lerAmostraInterna } from '@/lib/redisTelemetry'
import { avaliarLimiaresUso, logLimiarCruzado, limiteComandosMensal, AVISO_AMOSTRA_NAO_OFICIAL, type LimiarAlerta } from '@/lib/redisUsageAlerts'
import { checkAllHealth } from '@/lib/healthChecks'

/** Marca que este limiar de TENDÊNCIA já foi logado neste ciclo mensal — evita log repetido a cada carregamento do painel. TTL até o fim do mês (aprox. 32 dias, sempre folgado). */
async function marcarLimiarSeNovo(limiar: LimiarAlerta): Promise<boolean> {
  const ciclo = `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`
  const chave = `telemetry:redis:tendencia-marcada:${limiar}:${ciclo}`
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
    const [health, amostra] = await Promise.all([checkAllHealth(), lerAmostraInterna(redis)])
    const memoria = obterSnapshotEmMemoria()

    const totalMensalAmostrado = amostra.mesAtual.total ?? 0
    const tendencia = avaliarLimiaresUso(totalMensalAmostrado)

    if (tendencia.limiarMaisAlto) {
      const novo = await marcarLimiarSeNovo(tendencia.limiarMaisAlto)
      if (novo) logLimiarCruzado(tendencia)
    }

    return NextResponse.json({
      health,
      memoria,
      amostra,
      tendencia,
      configuracao: {
        limiteReferenciaComandosMensal: limiteComandosMensal(),
        avisoOficial: AVISO_AMOSTRA_NAO_OFICIAL,
      },
      geradoEm: Date.now(),
    })
  } catch (err) {
    console.error('[api/dev/redis-status] Falha inesperada:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Status de telemetria indisponível' }, { status: 503 })
  }
}

// Nenhum POST, PUT, DELETE ou PATCH — painel somente leitura
