import { NextResponse } from 'next/server'

const BASE = 'https://evolution-api-production-8f99.up.railway.app'
const KEY  = '6208711c1b6fdffcc30cb492a44d74601415c33ff717ef6032162f9c0056319e'

export async function GET() {
  try {
    const res  = await fetch(`${BASE}/instance/connectionState/chefe`, {
      headers: { apikey: KEY },
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Falha ao conectar à API' }, { status: 502 })
  }
}
