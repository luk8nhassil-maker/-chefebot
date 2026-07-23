import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, validateCredentials } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { confirmarPixMetadata, type PixMetadata } from '@/lib/pix'
import { registrarAuditoriaPixManual } from '@/lib/pixAuditoria'
import { encerrarSentinela } from '@/lib/pixSentinela'
import { incrementarContadorPix } from '@/lib/pixMetricas'
import { atualizarPedidoAtomico } from '@/lib/pedidosStore'

type Status = 'novo' | 'em_preparo' | 'saiu_entrega' | 'entregue' | 'cancelado'
type Pedido = {
  id: string
  cliente: string
  total: number
  status: Status
  pagamento?: string
  pixConfirmado?: boolean
  pix?: PixMetadata
}

async function getPedidos(): Promise<Pedido[]> {
  const data = await redis.get<Pedido[]>('pedidos')
  return data || []
}

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin'].includes(payload.role as string)) return null
  return payload as { username: string; name: string; role: string }
}

function pixJaConfirmado(pedido: Pedido): boolean {
  return pedido.pixConfirmado === true || pedido.pix?.status === 'confirmado'
}

function respostaJaConfirmado(pedido: Pedido) {
  return NextResponse.json(
    {
      error: 'Este pagamento já foi confirmado.',
      confirmadoPor: pedido.pix?.confirmadoPor ?? 'manual',
      confirmadoPorNome: pedido.pix?.confirmadoPorNome,
      confirmadoEm: pedido.pix?.confirmadoEm,
      pedido: { id: pedido.id, status: pedido.status, pixConfirmado: true, pix: pedido.pix },
    },
    { status: 409 }
  )
}

// Endpoint dedicado e restrito à confirmação manual segura do Pix no painel
// /pedidos. Não confia em nada vindo do corpo além do id do pedido e da
// senha: valor, status e identidade sempre vêm do servidor. A confirmação
// automática (webhook, conciliador) continua gravando direto no pedido por
// fora deste endpoint — aqui só reaproveitamos confirmarPixMetadata, a mesma
// função de idempotência que ela usa, então quem chegou primeiro vence.
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let body: { id?: unknown; senha?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const senha = typeof body.senha === 'string' ? body.senha : ''
  if (!id || !senha) {
    return NextResponse.json({ error: 'Pedido e senha são obrigatórios.' }, { status: 400 })
  }

  const pedidos = await getPedidos()
  const pedido = pedidos.find(p => p.id === id)
  if (!pedido) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })

  if (pedido.status === 'cancelado') {
    return NextResponse.json({ error: 'Este pedido foi cancelado e não pode mais ser confirmado.' }, { status: 409 })
  }
  if (pixJaConfirmado(pedido)) return respostaJaConfirmado(pedido)

  // Senha verificada no servidor com a mesma lógica usada no login
  // (validateCredentials), sempre contra o username da sessão autenticada —
  // nunca um usuário enviado pelo frontend. Nunca logada, nunca persistida.
  const usuario = validateCredentials(auth.username, senha)
  if (!usuario) {
    return NextResponse.json({ error: 'Senha incorreta. O pagamento não foi confirmado.' }, { status: 401 })
  }

  // Revalida direto no servidor, dentro do lock global de "pedidos", o mais
  // próximo possível da gravação — reduz a janela de corrida com a
  // confirmação automática (webhook/conciliador Mercado Pago) e com qualquer
  // outro writer concorrente do array. O mutator é síncrono e nunca faz I/O
  // externo (só monta o metadata Pix a partir do pedido lido fresco dentro
  // do lock). Rejeições (cancelado/já confirmado) abortam via exceção
  // sentinela para NUNCA gravar um no-op (nunca bump de revision indevido).
  class ConfirmacaoAbortada extends Error {
    constructor(public motivo: 'cancelado' | 'ja_confirmado', public pedido: Pedido) {
      super('confirmacao_abortada')
    }
  }

  let statusAnterior: string = 'pendente'
  let confirmadoEm = ''
  let valorConfirmado = 0
  let pixConfirmadoMeta: PixMetadata | undefined

  let resultadoAtualizar
  try {
    resultadoAtualizar = await atualizarPedidoAtomico<Pedido>(id, null, (pedidoNaGravacao) => {
      if (pedidoNaGravacao.status === 'cancelado') {
        throw new ConfirmacaoAbortada('cancelado', pedidoNaGravacao)
      }
      if (pixJaConfirmado(pedidoNaGravacao)) {
        throw new ConfirmacaoAbortada('ja_confirmado', pedidoNaGravacao)
      }
      statusAnterior = pedidoNaGravacao.pix?.status ?? 'pendente'
      confirmadoEm = new Date().toISOString()
      valorConfirmado =
        typeof pedidoNaGravacao.pix?.valorEsperado === 'number' && Number.isFinite(pedidoNaGravacao.pix.valorEsperado)
          ? pedidoNaGravacao.pix.valorEsperado
          : pedidoNaGravacao.total
      pixConfirmadoMeta = confirmarPixMetadata(pedidoNaGravacao.pix, 'manual', confirmadoEm, {
        usuario: usuario.username,
        nome: usuario.name,
        role: usuario.role,
      })
      return { ...pedidoNaGravacao, pixConfirmado: true, pix: pixConfirmadoMeta }
    })
  } catch (err) {
    if (err instanceof ConfirmacaoAbortada) {
      if (err.motivo === 'cancelado') {
        return NextResponse.json({ error: 'Este pedido foi cancelado e não pode mais ser confirmado.' }, { status: 409 })
      }
      return respostaJaConfirmado(err.pedido)
    }
    throw err
  }

  if (resultadoAtualizar.tipo === 'nao_encontrado') {
    return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })
  }
  if (resultadoAtualizar.tipo !== 'sucesso' || !pixConfirmadoMeta) {
    return NextResponse.json({ error: 'Não foi possível confirmar agora. Tente de novo.' }, { status: 503 })
  }

  // Best-effort — nunca pode afetar a confirmação acima, que já foi
  // persistida. A confirmação manual NUNCA é bloqueada pelo Sentinela; aqui
  // só encerramos a cadeia server-side do Guardião (se existir) para que
  // nenhum tick QStash já agendado tente consultar o Mercado Pago à toa.
  try {
    await encerrarSentinela(id, 'confirmado_manual')
    await incrementarContadorPix('sentinela_encerrado_manual')
  } catch (err) {
    console.error('[ChefeBot] Falha ao encerrar Sentinela na confirmação manual (ignorado):', err)
  }

  try {
    await registrarAuditoriaPixManual({
      pedidoId: id,
      metodo: 'manual',
      usuario: usuario.username,
      nome: usuario.name,
      role: usuario.role,
      dataHora: confirmadoEm,
      valorConfirmado,
      origem: 'painel_pedidos',
      statusAnterior,
      statusFinal: 'confirmado',
    })
  } catch (err) {
    console.error('[ChefeBot] Falha ao registrar auditoria de confirmação manual de Pix (ignorado):', err)
  }

  return NextResponse.json({
    ok: true,
    confirmadoPor: pixConfirmadoMeta.confirmadoPor,
    confirmadoPorNome: pixConfirmadoMeta.confirmadoPorNome,
    confirmadoEm: pixConfirmadoMeta.confirmadoEm,
    valorConfirmado,
  })
}
