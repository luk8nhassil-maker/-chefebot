import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { mutarLotePedidosAtomico } from '@/lib/pedidosStore'

const FRASE_CONFIRMACAO = 'RESETAR CHEFEBOT'

async function deletarPorPadrao(padrao: string) {
  let cursor = 0
  const chaves: string[] = []
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: padrao, count: 100 })
    cursor = Number(nextCursor)
    chaves.push(...(keys as string[]))
  } while (cursor !== 0)
  for (const chave of chaves) {
    await redis.del(chave)
  }
  return chaves.length
}

export async function POST(req: NextRequest) {
  // Auth: só dev
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'dev') {
    return NextResponse.json({ ok: false, error: 'Acesso negado' }, { status: 403 })
  }

  const { senha, frase } = await req.json()

  // Valida senha via env — nunca exposta ao client
  const senhaCorreta = process.env.DEV_RESET_PASSWORD
  if (!senhaCorreta) {
    return NextResponse.json({ ok: false, error: 'DEV_RESET_PASSWORD não configurada' }, { status: 500 })
  }
  if (senha !== senhaCorreta) {
    return NextResponse.json({ ok: false, error: 'Senha incorreta' }, { status: 401 })
  }
  if (frase !== FRASE_CONFIRMACAO) {
    return NextResponse.json({ ok: false, error: 'Frase de confirmação incorreta' }, { status: 400 })
  }

  // Reset: apenas dados operacionais
  await mutarLotePedidosAtomico(() => [])
  const nSessoes = await deletarPorPadrao('session:*')
  const nManuais = await deletarPorPadrao('manual:*')
  const nResolvendo = await deletarPorPadrao('resolvendo:*')

  return NextResponse.json({
    ok: true,
    detalhes: {
      pedidos: 'limpo',
      sessoes: nSessoes,
      manuais: nManuais,
      resolvendo: nResolvendo,
    },
  })
}

// GET não permitido
export async function GET() {
  return NextResponse.json({ error: 'Método não permitido' }, { status: 405 })
}
