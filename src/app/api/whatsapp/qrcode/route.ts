import { NextResponse } from 'next/server'
import { salvarStatusConexao } from '@/lib/conexaoWhatsapp'

const BASE = process.env.EVOLUTION_API_URL ?? 'https://evolution-api-production-8f99.up.railway.app'
const KEY  = process.env.EVOLUTION_API_KEY  ?? '6208711c1b6fdffcc30cb492a44d74601415c33ff717ef6032162f9c0056319e'

export async function GET() {
  try {
    // Sempre faz logout antes de conectar para garantir QR novo.
    // Sem esse passo, se a instância já estiver em estado "connecting", a Evolution API
    // pode devolver o QR anterior (já expirado) em vez de gerar um novo.
    await fetch(`${BASE}/instance/logout/chefe`, {
      method: 'DELETE',
      headers: { apikey: KEY },
      cache: 'no-store',
    }).catch(() => {})

    await salvarStatusConexao('disconnected')

    const res  = await fetch(`${BASE}/instance/connect/chefe`, {
      headers: { apikey: KEY },
      cache: 'no-store',
    })
    const data = await res.json()

    await salvarStatusConexao('connecting')

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Falha ao conectar à API' }, { status: 502 })
  }
}
