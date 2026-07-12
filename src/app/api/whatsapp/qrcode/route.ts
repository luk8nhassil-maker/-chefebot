import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { mensagemErroEvolution, obterConfigEvolution } from '@/lib/evolutionApi'

async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return { status: 401 }
  const payload = await verifyToken(token)
  if (!payload) return { status: 401 }
  if (!['admin', 'dev'].includes(payload.role as string)) return { status: 403 }
  return { status: 200 }
}

// Endpoint leve: apenas obtém o QR atual da instância existente (sem criar,
// sem retry, sem logout/delete). Usado pelo auto-QR ao abrir a tela.
// Para o fluxo completo (cria se não existir + retry), usar
// POST /api/whatsapp/connect. Para reconstrução destrutiva, usar
// POST /api/whatsapp/rebuild. Restrito a admin/dev.
export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (auth.status === 401) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  if (auth.status === 403) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  const config = obterConfigEvolution()
  if (!config) {
    return NextResponse.json(
      { error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados.', estado: 'provider_not_configured' },
      { status: 503 }
    )
  }

  try {
    const res = await fetch(`${config.baseUrl}/instance/connect/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    console.log('[QR] connect status:', res.status, 'has base64:', !!data?.base64, 'keys:', Object.keys(data || {}).join(','))

    if (!res.ok) {
      console.error('[QR] connect error:', JSON.stringify(data).slice(0, 300))
      // Repassa só a mensagem da Evolution API (ex.: "Application not found"
      // quando a instância foi perdida/apagada, ou o diagnóstico de
      // infraestrutura quando o próprio host configurado em
      // EVOLUTION_API_URL não responde) — nunca o corpo bruto nem a apikey.
      return NextResponse.json(
        { error: mensagemErroEvolution(res.status, data), status: res.status },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (e) {
    console.error('[QR] erro inesperado:', e)
    return NextResponse.json({ error: 'Falha ao conectar à Evolution API' }, { status: 502 })
  }
}
