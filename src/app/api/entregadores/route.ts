import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { autenticarRequisicao, exigirRole } from '@/lib/apiAuth'

type Entregador = {
  id: string
  nome: string
  telefone: string
  ativo: boolean
}

// GET: lido por /pedidos (para atribuir entregador) e por /admin.
const ROLES_LEITURA: Parameters<typeof exigirRole>[1] = ['admin', 'dev', 'atendente']
// POST/DELETE (cadastrar, editar, ativar/desativar, remover): só /admin chama.
const ROLES_GESTAO: Parameters<typeof exigirRole>[1] = ['admin', 'dev']

export async function GET(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_LEITURA)
  if (negado) return negado
  try {
    const entregadores = await redis.get<Entregador[]>('entregadores') || []
    return NextResponse.json(entregadores)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_GESTAO)
  if (negado) return negado
  try {
    const body = await req.json()
    const entregadores = await redis.get<Entregador[]>('entregadores') || []
    if (body.id) {
      // Atualiza existente
      const atualizados = entregadores.map(e => e.id === body.id ? { ...e, ...body } : e)
      await redis.set('entregadores', atualizados)
      return NextResponse.json({ ok: true })
    } else {
      // Cria novo
      const novo: Entregador = { id: Date.now().toString(), nome: body.nome, telefone: body.telefone.replace(/\D/g, ''), ativo: true }
      await redis.set('entregadores', [...entregadores, novo])
      return NextResponse.json({ ok: true, entregador: novo })
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_GESTAO)
  if (negado) return negado
  try {
    const { id } = await req.json()
    const entregadores = await redis.get<Entregador[]>('entregadores') || []
    await redis.set('entregadores', entregadores.filter(e => e.id !== id))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}