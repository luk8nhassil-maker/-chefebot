import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { mensagemErroEvolution } from '@/lib/evolutionApi'

const _baseUrl = process.env.EVOLUTION_API_URL ?? 'evolution-api-production-8f99.up.railway.app'
const BASE     = _baseUrl.startsWith('http') ? _baseUrl : `https://${_baseUrl}`
const KEY      = process.env.EVOLUTION_API_KEY!
const INSTANCE = 'chefebot'

// Sem cookie ou token invalido/expirado -> 401 (sem sessao).
// Sessao valida mas papel sem permissao -> 403.
// Papel autorizado -> segue normalmente.
async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200; role: string }> {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return { status: 401 }
  const payload = await verifyToken(token)
  if (!payload) return { status: 401 }
  if (!['admin', 'dev'].includes(payload.role as string)) return { status: 403 }
  return { status: 200, role: payload.role as string }
}

// Endpoint leve: apenas obtém o QR atual da instância existente.
// Não depende de Redis. Usado pelo botão e pelo auto-QR ao abrir a tela.
// Para reset completo (delete + create), usar POST /api/whatsapp/reset.
// Restrito a admin/dev — QR code dá acesso a conectar o WhatsApp da pizzaria.
export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (auth.status === 401) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  if (auth.status === 403) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  try {
    const res = await fetch(`${BASE}/instance/connect/${INSTANCE}`, {
      headers: { apikey: KEY },
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
