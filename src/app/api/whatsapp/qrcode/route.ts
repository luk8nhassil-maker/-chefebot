import { NextResponse } from 'next/server'

const _baseUrl = process.env.EVOLUTION_API_URL ?? 'evolution-api-production-8f99.up.railway.app'
const BASE     = _baseUrl.startsWith('http') ? _baseUrl : `https://${_baseUrl}`
const KEY      = process.env.EVOLUTION_API_KEY!
const INSTANCE = 'chefebot'

// Endpoint leve: apenas obtém o QR atual da instância existente.
// Não depende de Redis. Usado pelo botão e pelo auto-QR ao abrir a tela.
// Para reset completo (delete + create), usar POST /api/whatsapp/reset.
export async function GET() {
  try {
    const res = await fetch(`${BASE}/instance/connect/${INSTANCE}`, {
      headers: { apikey: KEY },
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    console.log('[QR] connect status:', res.status, 'has base64:', !!data?.base64, 'keys:', Object.keys(data || {}).join(','))

    if (!res.ok) {
      console.error('[QR] connect error:', JSON.stringify(data).slice(0, 300))
      return NextResponse.json({ error: 'Evolution API retornou erro', detail: data }, { status: res.status })
    }

    return NextResponse.json(data)
  } catch (e) {
    console.error('[QR] erro inesperado:', e)
    return NextResponse.json({ error: 'Falha ao conectar à Evolution API', detail: String(e) }, { status: 502 })
  }
}
