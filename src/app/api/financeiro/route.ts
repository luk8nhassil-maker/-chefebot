import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { autenticarRequisicao, exigirRole } from '@/lib/apiAuth'

type Custo = {
  id: string
  descricao: string
  valor: number
  categoria: string
  data: string
  mes: string
}

type MesStatus = {
  fechado: boolean
  fechadoEm?: string
  fechadoPor?: string
}

// GET: lido por /financeiro (financeiro) e /contador (contador), além de /admin.
const ROLES_LEITURA: Parameters<typeof exigirRole>[1] = ['admin', 'dev', 'financeiro', 'contador']
// POST/DELETE: só /financeiro (e /admin) registram/removem custos — contador
// não tem call site de escrita comprovado.
const ROLES_ESCRITA_CUSTO: Parameters<typeof exigirRole>[1] = ['admin', 'dev', 'financeiro']
// PATCH (fechar mês): só /contador chama — nenhum call site em /financeiro.
const ROLES_FECHAR_MES: Parameters<typeof exigirRole>[1] = ['admin', 'dev', 'contador']

export async function GET(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_LEITURA)
  if (negado) return negado
  try {
    const { searchParams } = new URL(req.url)
    const mes = searchParams.get('mes') || new Date().toISOString().slice(0, 7)
    const custos = await redis.get<Custo[]>(`custos:${mes}`) || []
    const status = await redis.get<MesStatus>(`mes_status:${mes}`) || { fechado: false }
    return NextResponse.json({ custos, status })
  } catch {
    return NextResponse.json({ custos: [], status: { fechado: false } })
  }
}

export async function POST(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_ESCRITA_CUSTO)
  if (negado) return negado
  try {
    const body = await req.json()
    const mes = body.mes || new Date().toISOString().slice(0, 7)

    // Verifica se mês está fechado
    const status = await redis.get<MesStatus>(`mes_status:${mes}`)
    if (status?.fechado) return NextResponse.json({ ok: false, error: 'Mês fechado pelo contador.' }, { status: 403 })

    const custos = await redis.get<Custo[]>(`custos:${mes}`) || []

    if (body.id) {
      // Atualiza existente
      const atualizados = custos.map(c => c.id === body.id ? { ...c, descricao: body.descricao, valor: Number(body.valor), categoria: body.categoria } : c)
      await redis.set(`custos:${mes}`, atualizados, { ex: 365 * 24 * 60 * 60 })
      return NextResponse.json({ ok: true })
    } else {
      // Cria novo
      const novo: Custo = {
        id: Date.now().toString(),
        descricao: body.descricao,
        valor: Number(body.valor),
        categoria: body.categoria || 'outros',
        data: new Date().toLocaleDateString('pt-BR'),
        mes,
      }
      await redis.set(`custos:${mes}`, [...custos, novo], { ex: 365 * 24 * 60 * 60 })
      return NextResponse.json({ ok: true, custo: novo })
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_FECHAR_MES)
  if (negado) return negado
  try {
    const { mes, fechadoPor } = await req.json()
    const status: MesStatus = { fechado: true, fechadoEm: new Date().toISOString(), fechadoPor }
    await redis.set(`mes_status:${mes}`, status, { ex: 365 * 24 * 60 * 60 * 5 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_ESCRITA_CUSTO)
  if (negado) return negado
  try {
    const { id, mes } = await req.json()
    const status = await redis.get<MesStatus>(`mes_status:${mes}`)
    if (status?.fechado) return NextResponse.json({ ok: false, error: 'Mês fechado.' }, { status: 403 })
    const custos = await redis.get<Custo[]>(`custos:${mes}`) || []
    await redis.set(`custos:${mes}`, custos.filter(c => c.id !== id))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}