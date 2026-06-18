import { NextResponse } from 'next/server'
import { salvarStatusConexao } from '@/lib/conexaoWhatsapp'

const _baseUrl = process.env.EVOLUTION_API_URL ?? 'evolution-api-production-8f99.up.railway.app'
const BASE     = _baseUrl.startsWith('http') ? _baseUrl : `https://${_baseUrl}`
const KEY      = process.env.EVOLUTION_API_KEY!

export async function GET() {
  try {
    const res  = await fetch(`${BASE}/instance/connectionState/chefebot`, {
      headers: { apikey: KEY },
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
