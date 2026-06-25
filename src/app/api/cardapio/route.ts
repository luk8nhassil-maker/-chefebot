import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { MENU, getMENUDinamico } from '@/lib/menu'
import { verifyToken } from '@/lib/auth'

// Esgotados precisam refletir em tempo real no cardapio publico: nunca cachear.
export const dynamic = 'force-dynamic'

const ROLES_PERMITIDAS = ['admin', 'atendente', 'dev']

type EsgMetadata = Record<string, { desde: string; ultimaRevisao?: string }>

function hoje(): string {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export async function GET() {
  try {
    const menu = await getMENUDinamico()
    const esgotados = (await redis.get<string[]>('esgotados')) || []
    const esgotadosMetadata = (await redis.get<EsgMetadata>('esgotadosMetadata')) || {}
    return NextResponse.json({ ...menu, esgotados, esgotadosMetadata })
  } catch {
    return NextResponse.json({ ...MENU, esgotados: [], esgotadosMetadata: {} })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await redis.set('cardapio', body)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    const payload = token ? await verifyToken(token) : null
    if (!payload || !ROLES_PERMITIDAS.includes(payload.role)) {
      return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
    }

    const { nome, esgotado, revisaoHoje } = await req.json()
    if (!nome) return NextResponse.json({ ok: false, error: 'nome obrigatorio' }, { status: 400 })

    const metadata = (await redis.get<EsgMetadata>('esgotadosMetadata')) || {}

    if (revisaoHoje) {
      if (metadata[nome]) {
        metadata[nome] = { ...metadata[nome], ultimaRevisao: hoje() }
        await redis.set('esgotadosMetadata', metadata)
      }
      return NextResponse.json({ ok: true, esgotadosMetadata: metadata })
    }

    const lista = (await redis.get<string[]>('esgotados')) || []
    let nova: string[]
    if (esgotado) {
      nova = lista.includes(nome) ? lista : [...lista, nome]
      if (!metadata[nome]) {
        metadata[nome] = { desde: hoje(), ultimaRevisao: hoje() }
      }
    } else {
      nova = lista.filter((n: string) => n !== nome)
      delete metadata[nome]
    }
    await redis.set('esgotados', nova)
    await redis.set('esgotadosMetadata', metadata)
    return NextResponse.json({ ok: true, esgotados: nova, esgotadosMetadata: metadata })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
