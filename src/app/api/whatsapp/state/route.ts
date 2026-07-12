import { NextRequest, NextResponse } from 'next/server'
import { salvarStatusConexao } from '@/lib/conexaoWhatsapp'
import { verifyToken } from '@/lib/auth'
import { obterConfigEvolution } from '@/lib/evolutionApi'

// Sem cookie ou token invalido/expirado -> 401 (sem sessao).
// Sessao valida mas papel sem permissao -> 403.
// Papel autorizado -> segue normalmente.
async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return { status: 401 }
  const payload = await verifyToken(token)
  if (!payload) return { status: 401 }
  if (!['admin', 'dev'].includes(payload.role as string)) return { status: 403 }
  return { status: 200 }
}

// Consumido só por /admin e /setup (telas de admin/dev) — nenhum outro
// papel precisa consultar o estado da conexão do WhatsApp.
export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (auth.status === 401) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  if (auth.status === 403) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  const config = obterConfigEvolution()
  if (!config) {
    return NextResponse.json({
      estado: 'provider_not_configured',
      error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados.',
    })
  }

  try {
    const res  = await fetch(`${config.baseUrl}/instance/connectionState/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: 'no-store',
    })
    const data = await res.json()

    // Sincroniza o Redis com o estado real da Evolution API (fonte de verdade em caso de dúvida)
    const state = data?.instance?.state as string | undefined
    if (state) {
      const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      await salvarStatusConexao(status)
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Falha ao conectar à API' }, { status: 502 })
  }
}
