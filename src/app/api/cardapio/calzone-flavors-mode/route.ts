import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getMENUDinamico } from '@/lib/menu.server'
import { verifyToken } from '@/lib/auth'
import { registrarAuditoriaCardapio } from '@/lib/auditoriaCardapio'

// Endpoint dedicado para a correção da regra comercial do Calzone: alterna
// `flavorsMode` ("pizza" reaproveita a Pizza, padrão aprovado | "own" usa a
// lista própria calzoneFlavors) — a mesma configuração explícita lida por
// @/lib/catalog/simpleProducts (buildSimpleCatalog). Não existe ainda uma
// tela de edição da seção `lanches` inteira (só a de marcar esgotado); em
// vez de expor um editor genérico, este endpoint faz um READ-MODIFY-WRITE
// pontual sobre o Menu já totalmente resolvido (getMENUDinamico(), que já
// aplica os fallbacks para o cardápio estático) — grava de volta o Menu
// inteiro com só esse um campo alterado, para nunca apagar outras seções já
// persistidas (POST /api/cardapio faz `redis.set` substituindo o objeto
// inteiro pelo corpo enviado; mandar só `{ lanches }` apagaria sizes,
// sabores, bairros etc. se já tivessem sido customizados).

const ROLES_PERMITIDAS = ['admin', 'atendente', 'dev']

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    const payload = token ? await verifyToken(token) : null
    if (!payload || !ROLES_PERMITIDAS.includes(payload.role)) {
      return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const modo = (body as { modo?: unknown } | null)?.modo
    if (modo !== 'pizza' && modo !== 'own') {
      return NextResponse.json({ ok: false, error: 'modo invalido' }, { status: 400 })
    }

    const menuAtual = await getMENUDinamico()
    const temCalzone = menuAtual.lanches.some((lanche) => lanche.flavorsKey === 'calzoneFlavors')
    if (!temCalzone) {
      return NextResponse.json({ ok: false, error: 'Calzone nao encontrado no cardapio' }, { status: 404 })
    }

    const lanchesAtualizados = menuAtual.lanches.map((lanche) =>
      lanche.flavorsKey === 'calzoneFlavors' ? { ...lanche, flavorsMode: modo } : lanche
    )
    const cardapioAtualizado = { ...menuAtual, lanches: lanchesAtualizados }

    await redis.set('cardapio', cardapioAtualizado)
    await registrarAuditoriaCardapio(payload.username, menuAtual, cardapioAtualizado)

    return NextResponse.json({ ok: true, modo })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
