import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getMENUDinamico } from '@/lib/menu.server'
import { verifyToken } from '@/lib/auth'
import { registrarAuditoriaCardapio } from '@/lib/auditoriaCardapio'
import type { Menu } from '@/lib/menu'

// Endpoint dedicado para a correção da regra comercial do Calzone: alterna
// `flavorsMode` ("pizza" reaproveita a Pizza, padrão aprovado | "own" usa a
// lista própria calzoneFlavors) — a mesma configuração explícita lida por
// @/lib/catalog/simpleProducts (buildSimpleCatalog). Não existe ainda uma
// tela de edição da seção `lanches` inteira (só a de marcar esgotado); em
// vez de expor um editor genérico, este endpoint faz um PATCH CIRÚRGICO só
// na seção `lanches` do cardápio BRUTO persistido (nunca o Menu inteiro já
// resolvido) — POST /api/cardapio substitui o objeto INTEIRO no Redis, então
// gravar `{ lanches }` sozinho apagaria sizes/sabores/bairros já persistidos;
// gravar o Menu inteiro resolvido, por outro lado, materializaria à toa
// todas as demais seções que hoje só existem via fallback estático (uma
// mudança futura no MENU-base pararia de valer pra elas). Nenhuma segunda
// fonte de configuração: `flavorsMode` mora só em `lanches[i]`, aqui e em
// @/lib/catalog/simpleProducts.

const ROLES_PERMITIDAS = ['admin', 'atendente', 'dev']

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    const payload = token ? await verifyToken(token) : null
    if (!payload || !ROLES_PERMITIDAS.includes(payload.role)) {
      return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const modoRecebido = (body as { modo?: unknown } | null)?.modo
    if (modoRecebido !== 'pizza' && modoRecebido !== 'own') {
      return NextResponse.json({ ok: false, error: 'modo invalido' }, { status: 400 })
    }
    const modo: 'pizza' | 'own' = modoRecebido

    // Menu já resolvido (com fallback estático aplicado) — usado só para
    // achar o Calzone e montar a lista de `lanches` EFETIVA (mesma regra de
    // secaoPersistida em @/lib/menu.server), e como referência "antes" na
    // auditoria (reflete o que estava realmente valendo, não o objeto cru).
    const menuResolvido = await getMENUDinamico()
    const temCalzone = menuResolvido.lanches.some((lanche) => lanche.flavorsKey === 'calzoneFlavors')
    if (!temCalzone) {
      return NextResponse.json({ ok: false, error: 'Calzone nao encontrado no cardapio' }, { status: 404 })
    }

    const lanchesAtualizados = menuResolvido.lanches.map((lanche) =>
      lanche.flavorsKey === 'calzoneFlavors' ? { ...lanche, flavorsMode: modo } : lanche
    )

    // Grava só `lanches` por cima do que já estava persistido (bruto, sem
    // fallback) — outras seções nunca customizadas continuam genuinamente
    // ausentes do Redis, sem depender deste endpoint pra existirem.
    const cardapioBruto = (await redis.get<Record<string, unknown>>('cardapio')) || {}
    const cardapioPersistido = { ...cardapioBruto, lanches: lanchesAtualizados }
    await redis.set('cardapio', cardapioPersistido)

    // Auditoria compara o Menu EFETIVO antes/depois (com fallback aplicado),
    // não o objeto bruto — evita um diff artificial ("lanches: 0 → 8") numa
    // instalação que nunca tinha customizado `lanches` antes.
    const menuEfetivoDepois: Menu = { ...menuResolvido, lanches: lanchesAtualizados }
    await registrarAuditoriaCardapio(payload.username, menuResolvido, menuEfetivoDepois)

    return NextResponse.json({ ok: true, modo })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
