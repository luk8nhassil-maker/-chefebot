import { NextRequest, NextResponse } from 'next/server'
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

// Endpoint leve: apenas obtém o QR atual da instância existente.
// Não depende de Redis. Usado pelo botão e pelo auto-QR ao abrir a tela.
// Para reset completo (delete + create), usar POST /api/whatsapp/reset.
// Restrito a admin/dev — QR code dá acesso a conectar o WhatsApp da pizzaria.
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
      // quando a instância foi perdida/apagada) — o admin precisa saber que
      // precisa resetar a conexão, não só que "deu erro". Nunca repassa o
      // corpo bruto da Evolution API (pode conter URL/infra interna) nem a
      // apikey usada na chamada.
      const detalhe = typeof data?.message === 'string' ? data.message : null
      return NextResponse.json(
        { error: detalhe ? `Evolution API: ${detalhe}` : 'Evolution API retornou erro', status: res.status },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (e) {
    console.error('[QR] erro inesperado:', e)
    return NextResponse.json({ error: 'Falha ao conectar à Evolution API' }, { status: 502 })
  }
}
