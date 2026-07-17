import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import type { PedidoEntregador } from '@/types/entregador'
import { creditarPontosPedidoEntregue } from '@/lib/fidelidade'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

type Entregador = { id: string; nome: string; telefone: string; ativo: boolean }

// RISCO RESIDUAL DOCUMENTADO — NÃO RESOLVIDO NESTA PR.
//
// A área do entregador (/entregador) não usa o sistema de login da equipe:
// não existe usuário com role "entregador" em src/lib/auth.ts (USERS), a
// página não passa por /login e nunca recebe o cookie auth-token. O acesso
// hoje é só por um entregadorId enviado por WhatsApp (link
// `/entregador?id=...`, ver src/app/api/orders/route.ts) ou digitado à mão —
// sem senha, OTP ou token assinado provando a posse desse id.
//
// Por isso, esta rota NÃO PODE "vincular a operação ao usuário autenticado"
// como pedido pelo escopo desta PR: não existe usuário autenticado no
// modelo atual para um entregador. Fazer essa rota exigir um auth-token de
// equipe quebraria a entrega para todo entregador real (nenhum tem esse
// cookie); e inventar uma associação (ex.: presumir que um JWT com
// role="entregador" corresponde a um entregadorId específico) seria uma
// proteção falsa, não uma correção real — por isso não foi feita.
//
// O que esta PR faz, com segurança e sem quebrar o fluxo real: valida que o
// entregadorId corresponde a um registro ATIVO em `entregadores` (cadastrado
// pelo admin via /api/entregadores) antes de responder — rejeita ids
// inventados, com erro de digitação, ou de entregadores desativados.
//
// O que continua em aberto: um entregador que conheça (ou receba
// repassado) o id de outro entregador ativo ainda consegue consultar e
// alterar os pedidos dele — esse ponto crítico exige uma PR própria
// introduzindo autenticação real de entregador (ex.: OTP por WhatsApp,
// no mesmo padrão de cliente-token) antes de poder ser considerado resolvido.
async function entregadorAtivo(entregadorId: string): Promise<boolean> {
  const entregadores = await redis.get<Entregador[]>('entregadores') || []
  return entregadores.some(e => e.id === entregadorId && e.ativo)
}

export async function GET(req: NextRequest) {
  const entregadorId = req.nextUrl.searchParams.get('entregadorId')
  if (!entregadorId) {
    return NextResponse.json({ error: 'entregadorId obrigatório' }, { status: 400 })
  }
  if (!(await entregadorAtivo(entregadorId))) {
    return NextResponse.json({ error: 'Entregador não encontrado' }, { status: 404 })
  }

  const pedidos = await redis.get<PedidoEntregador[]>(`entregador:pedidos:${entregadorId}`) || []
  return NextResponse.json(pedidos)
}

export async function POST(req: NextRequest) {
  const { entregadorId, pedidoId, acao } = await req.json()

  if (!entregadorId || !pedidoId || !acao) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
  }
  if (!(await entregadorAtivo(entregadorId))) {
    return NextResponse.json({ error: 'Entregador não encontrado' }, { status: 404 })
  }

  const pedidos = await redis.get<PedidoEntregador[]>(`entregador:pedidos:${entregadorId}`) || []
  const index = pedidos.findIndex(p => p.pedidoId === pedidoId)

  if (index === -1) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  }

  if (acao === 'iniciar') {
    pedidos[index] = { ...pedidos[index], status: 'em_rota' }
  } else if (acao === 'entregar') {
    pedidos[index] = { ...pedidos[index], status: 'entregue' }

    // Atualiza o pedido principal
    type PedidoMain = { id: string; status: string; telefone?: string; total?: number; taxaEntrega?: number; clienteId?: string }
    const todosPedidos = await redis.get<PedidoMain[]>('pedidos') || []
    const pi = todosPedidos.findIndex(p => p.id === pedidoId)
    if (pi !== -1) {
      todosPedidos[pi] = { ...todosPedidos[pi], status: 'entregue' }
      await redis.set('pedidos', todosPedidos)

      // Fidelidade por pontos: idempotente por pedidoId, isolada em
      // try/catch proprio — falha aqui nunca pode impedir a confirmacao de
      // entrega pelo entregador, que ja foi salva acima.
      try {
        await creditarPontosPedidoEntregue({
          id: todosPedidos[pi].id,
          status: 'entregue',
          telefone: todosPedidos[pi].telefone,
          clienteId: todosPedidos[pi].clienteId,
          total: todosPedidos[pi].total ?? 0,
          taxaEntrega: todosPedidos[pi].taxaEntrega,
        })
      } catch (err) {
        console.error('[ChefeBot] Erro ao creditar pontos de fidelidade (ignorado):', err)
      }
    }
  } else {
    return NextResponse.json({ error: 'acao inválida' }, { status: 400 })
  }

  await redis.set(`entregador:pedidos:${entregadorId}`, pedidos, { ex: 86400 })
  return NextResponse.json({ ok: true, pedido: pedidos[index] })
}
