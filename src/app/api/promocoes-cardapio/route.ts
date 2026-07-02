import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getMENUDinamico } from '@/lib/menu'
import { PROMOS_KEY, promocoesPublicas, type Promocao } from '@/lib/promocoes'

// Promoções visíveis ao cliente mudam em tempo real (ativar/desativar,
// esgotados): nunca cachear.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const menu = await getMENUDinamico()
    const promos = (await redis.get<Promocao[]>(PROMOS_KEY)) || []
    const esgotados = (await redis.get<string[]>('esgotados')) || []
    return NextResponse.json(promocoesPublicas(promos, menu as never, esgotados))
  } catch {
    // Sem Redis/erro: cardápio segue funcionando sem promoções.
    return NextResponse.json([])
  }
}
