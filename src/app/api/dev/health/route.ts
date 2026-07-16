// GET /api/dev/health — health check agregado, independente do painel de
// telemetria (Etapa C). Protegido por role 'dev'/'admin', mesmo padrão de
// /api/dev/redis-status. Cada componente é checado de forma isolada — a
// falha de um nunca mascara nem impede a checagem dos outros.

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { checkAllHealth } from '@/lib/healthChecks'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (payload.role !== 'dev' && payload.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }

  const health = await checkAllHealth()
  // 200 sempre que a checagem em si funcionou (mesmo reportando componente
  // "down") — 503 só se a própria checagem quebrar de forma inesperada,
  // nunca para não confundir "sistema fora" com "checagem indisponível".
  return NextResponse.json(health, { status: 200 })
}
