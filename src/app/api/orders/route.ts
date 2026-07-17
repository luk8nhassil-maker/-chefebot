import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { proximoNumeroPedido } from '@/lib/numeracao'
import { criarPixMetadata, sanitizarPedidoPixResposta, type PixMetadata } from '@/lib/pix'
import type { EntregadorCadastro, PedidoEntregador } from '@/types/entregador'
import {
  creditarFidelidadePedido,
  creditarPontosPedidoEntregue,
  calcularPontosElegiveisPedido,
  registrarMovimentoPontosIdempotente,
  construirEventoIdPontos,
  obterExtratoPontos,
  derivarClienteIdPorTelefone,
  reverterResgateConfirmado,
} from '@/lib/fidelidade'
import { obterConfigEvolution } from '@/lib/evolutionApi'
import { enviarTextoWhatsApp } from '@/lib/whatsappMensagem'
import {
  criarTicketAcessoEntregador,
  invalidarTicketAcesso,
  montarLinkAcessoEntregador,
  normalizarTelefoneEntregador,
} from '@/lib/entregadorAuth'
import {
  adquirirMutexEdicao,
  liberarMutexEdicao,
  lockEdicaoAtivo,
  limparEdicaoExpiradaSeNecessario,
  sanitizarPedidoParaPainel,
  type PedidoComEdicao,
} from '@/lib/pedidoEdicao'

const APP_BASE_URL = 'https://chefebot-pjif.vercel.app'

type Status = 'novo' | 'em_preparo' | 'saiu_entrega' | 'entregue' | 'cancelado'
type Pedido = PedidoComEdicao & {
  id: string
  numero?: number
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: Status
  horario: string
  endereco: string
  pagamento?: string
  troco?: string
  pixConfirmado?: boolean
  pix?: PixMetadata
  entregador?: { id: string; nome: string; telefone: string }
  tipoEntrega?: string
  taxaEntrega?: number
  bairro?: string
  referencia?: string
  observacao?: string
  horarioInicio?: string
  clienteId?: string
  pizzasCount?: number
  resgateId?: string
  descontoFidelidade?: number
  // Campos de arquivamento
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archivedReason?: string
}


function getMensagemStatus(status: Status, nomeCliente: string): string | null {
  const firstName = nomeCliente.split(' ')[0];
  const mensagens: Partial<Record<Status, string>> = {
    em_preparo: `*${firstName}*, boa notícia! 🍕 Seu pedido já está sendo preparado com muito carinho.\n\nEm breve fica prontinho!`,
    saiu_entrega: `*${firstName}*, seu pedido saiu pra entrega! 🛵\n\nJá já chega aí. Obrigado pela preferência!`,
    entregue: `*${firstName}*, pedido entregue! 😊\n\nEsperamos que tenha curtido muito. Volte sempre que quiser — estamos aqui! 🍕`,
    cancelado: `*${firstName}*, seu pedido foi cancelado conforme solicitado.\n\nQualquer dúvida é só chamar. 😊`,
  };
  return mensagens[status] ?? null;
}

function sanitizePhone(telefone: string): string {
  const digits = telefone.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length >= 12) return digits
  return '55' + digits
}

async function notificarCliente(telefone: string, status: Status, nomeCliente: string): Promise<void> {
  const mensagem = getMensagemStatus(status, nomeCliente)
  if (!mensagem) return
  const config = obterConfigEvolution()
  if (!config) { console.error('[ChefeBot] Provider de WhatsApp não configurado — notificação de status não enviada.'); return }
  const phone = sanitizePhone(telefone)
  try {
    await fetch(`${config.baseUrl}/message/sendText/${config.instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.apiKey,
      },
      body: JSON.stringify({ number: phone, text: mensagem }),
    })
  } catch (err) {
    console.error('[ChefeBot] Erro ao notificar cliente:', err)
  }
}

async function getPedidos(): Promise<Pedido[]> {
  const data = await redis.get<Pedido[]>('pedidos')

  if (!data) {
    return []
  }

  return data
}

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin'].includes(payload.role as string)) return null
  return payload
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  const pedidos = await getPedidos()

  // Limpeza preguiçosa de locks de edição expirados (mesmo mecanismo de
  // polling já usado pelo painel — sem infraestrutura nova): se o cliente
  // fechou a aba ou perdeu a conexão sem descartar, o próximo carregamento
  // do painel libera o "Aceitar pedido" sozinho, sem precisar de cron.
  let mudouAlgum = false
  const limpos = pedidos.map(p => {
    const { pedido, mudou } = limparEdicaoExpiradaSeNecessario(p)
    if (mudou) mudouAlgum = true
    return mudou ? (pedido as Pedido) : p
  })
  if (mudouAlgum) {
    await redis.set('pedidos', limpos)
  }

  const url = new URL(req.url)
  const soArquivados = url.searchParams.get('arquivados') === 'true'

  if (soArquivados) {
    const arquivados = limpos.filter(p => p.isArchived)
    return NextResponse.json([...arquivados].reverse().map(sanitizarPedidoPixResposta).map(sanitizarPedidoParaPainel))
  }

  // Padrão: exclui arquivados da área de trabalho principal
  const ativos = limpos.filter(p => !p.isArchived)
  return NextResponse.json([...ativos].reverse().map(sanitizarPedidoPixResposta).map(sanitizarPedidoParaPainel))
}

export async function PATCH(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const { id, status, entregador, silent } = await req.json()
  let avisoOperacional: string | null = null

  // Toda transição de status (inclusive o aceite, novo → em_preparo) passa
  // pelo mesmo mutex curto usado pela edição do cliente: garante que a
  // Kellyne nunca aceita/altera um pedido no exato instante em que o
  // cliente acabou de adquirir (ou está adquirindo) o lock de edição.
  const mutexToken = await adquirirMutexEdicao(id)
  if (!mutexToken) {
    return NextResponse.json({ error: 'Não foi possível atualizar agora. Tente de novo.' }, { status: 409 })
  }

  try {
    const pedidos = await getPedidos()
    const index = pedidos.findIndex(p => p.id === id)
    if (index === -1) return NextResponse.json({ error: 'Pedido nao encontrado' }, { status: 404 })

    let entregadorCanonico: EntregadorCadastro | undefined
    if (entregador) {
      const entregadorId = typeof entregador?.id === 'string' ? entregador.id : ''
      const cadastrados = await redis.get<EntregadorCadastro[]>('entregadores') || []
      entregadorCanonico = cadastrados.find(e => e.id === entregadorId && e.ativo)
      if (!entregadorCanonico) {
        return NextResponse.json({ error: 'Entregador indisponível' }, { status: 409 })
      }
    }

    const limpeza = limparEdicaoExpiradaSeNecessario(pedidos[index])
    if (limpeza.mudou) pedidos[index] = limpeza.pedido as Pedido

    if (lockEdicaoAtivo(pedidos[index])) {
      if (limpeza.mudou) await redis.set('pedidos', pedidos)
      return NextResponse.json(
        { error: 'O cliente está editando este pedido. Aguarde ele concluir ou o tempo de edição expirar.' },
        { status: 409 }
      )
    }

    const statusAnterior = pedidos[index].status

    // A confirmação manual de Pix não passa mais por aqui: ela exige senha e
    // checklist de segurança e vive em /api/orders/confirmar-pix-manual, que
    // reaproveita confirmarPixMetadata (mesma idempotência de sempre).

    const agora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
    pedidos[index] = {
      ...pedidos[index],
      status,
      ...(status === 'cancelado' ? { cancelamentoSolicitado: false } : {}),
      ...(status === 'em_preparo' && !pedidos[index].horarioInicio ? { horarioInicio: agora } : {}),
    }

    // Salva entregador no pedido se informado
    if (entregadorCanonico) {
      pedidos[index] = { ...pedidos[index], entregador: entregadorCanonico }
    }
    await redis.set('pedidos', pedidos)

  if (!silent) {
    await notificarCliente(pedidos[index].telefone, status, pedidos[index].cliente)
  }

  // Notifica entregador no WhatsApp quando pedido sai para entrega + salva no Redis + envia link de rastreamento ao cliente
  if (!silent && status === 'saiu_entrega' && entregadorCanonico?.telefone) {
    const pedido = pedidos[index]
    const phoneFormatado = normalizarTelefoneEntregador(entregadorCanonico.telefone)
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

    // Salva pedido na fila do entregador no Redis
    const pedidoEntregador: PedidoEntregador = {
      pedidoId: pedido.id,
      entregadorId: entregadorCanonico.id,
      entregadorNome: entregadorCanonico.nome,
      entregadorTelefone: entregadorCanonico.telefone,
      clienteNome: pedido.cliente,
      clienteTelefone: pedido.telefone,
      endereco: pedido.endereco,
      total: pedido.total,
      itens: pedido.itens,
      status: 'pendente',
      horarioSaida: agora,
    }
    const filaMotoboy = await redis.get<PedidoEntregador[]>(`entregador:pedidos:${entregadorCanonico.id}`) || []
    const filtrado = filaMotoboy.filter(p => p.pedidoId !== pedido.id)
    await redis.set(`entregador:pedidos:${entregadorCanonico.id}`, [...filtrado, pedidoEntregador], { ex: 86400 })

    const configEntrega = obterConfigEvolution()
    if (!configEntrega) {
      avisoOperacional = 'Pedido atribuído, mas o acesso seguro do entregador não foi enviado.'
      console.error('[ChefeBot] Provider de WhatsApp não configurado — acesso seguro do entregador não enviado.')
    } else {
    let ticketAcesso: string | null = null
    try {
      // Mensagem para o motoboy com ticket opaco. O ticket nunca entra em
      // logs nem na resposta da API de pedidos.
      const acesso = await criarTicketAcessoEntregador(entregadorCanonico.id)
      ticketAcesso = acesso.ticket
      const resultadoMotoboy = await enviarTextoWhatsApp(
        phoneFormatado,
        `🛵 *Novo pedido para entregar!*\n👤 Cliente: ${pedido.cliente}\n📍 Endereço: ${pedido.endereco}\n💰 Total: R$ ${pedido.total.toFixed(2).replace('.', ',')}\nAcesse: ${montarLinkAcessoEntregador(acesso.ticket)}`
      )
      if (!resultadoMotoboy.ok) {
        await invalidarTicketAcesso(acesso.ticket)
        avisoOperacional = 'Pedido atribuído, mas o acesso seguro do entregador não foi enviado.'
        console.error('[ChefeBot] Atribuição salva sem envio do acesso seguro ao entregador.', {
          pedidoId: pedido.id,
          entregadorId: entregadorCanonico.id,
          motivo: resultadoMotoboy.motivo,
        })
      }

      // Mensagem para o cliente com link de rastreamento
      const clientePhone = sanitizePhone(pedido.telefone)
      await fetch(`${configEntrega.baseUrl}/message/sendText/${configEntrega.instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': configEntrega.apiKey },
        body: JSON.stringify({
          number: clientePhone,
          text: `Seu pedido saiu! 🛵\nEntregador: *${entregadorCanonico.nome}*\nAcompanhe: ${APP_BASE_URL}/rastrear/${pedido.id}`,
        }),
      })

      if (resultadoMotoboy.ok) {
        await redis.set(`entregador_aguardando:${phoneFormatado}`, pedido.id, { ex: 3 * 60 * 60 })
      }
    } catch {
      if (ticketAcesso) await invalidarTicketAcesso(ticketAcesso).catch(() => {})
      avisoOperacional = 'Pedido atribuído, mas o acesso seguro do entregador não foi enviado.'
      console.error('[ChefeBot] Atribuição salva sem envio do acesso seguro ao entregador.', {
        pedidoId: pedido.id,
        entregadorId: entregadorCanonico.id,
      })
    }
    }
  }

  if (status === 'entregue') {
    if (!silent) {
    const phone = sanitizePhone(pedidos[index].telefone)
    const chaveAvaliacao = `avaliacao_enviada:${id}`
    const jaEnviou = await redis.get(chaveAvaliacao)
    if (!jaEnviou) {
      await redis.set(chaveAvaliacao, true, { ex: 86400 })
      await redis.set(`avaliacao:${phone}`, true, { ex: 3600 })
      const firstName = pedidos[index].cliente.split(' ')[0]
      const configAvaliacao = obterConfigEvolution()
      if (!configAvaliacao) {
        console.error('[ChefeBot] Provider de WhatsApp não configurado — pesquisa de avaliação não enviada.')
      } else {
      try {
        await fetch(`${configAvaliacao.baseUrl}/message/sendText/${configAvaliacao.instanceName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': configAvaliacao.apiKey,
          },
          body: JSON.stringify({
            number: phone,
            text: `*${firstName}*, como foi sua experiência hoje? 😊\n\nAvalia nossa pizza de 1 a 5:\n\n  ⭐ 1 — Ruim\n  ⭐⭐ 2 — Regular\n  ⭐⭐⭐ 3 — Bom\n  ⭐⭐⭐⭐ 4 — Muito bom\n  ⭐⭐⭐⭐⭐ 5 — Excelente\n\nÉ só digitar o número! 😄`,
          }),
        })
      } catch (err) {
        console.error('[ChefeBot] Erro ao enviar pesquisa:', err)
      }
      }
    }

    }

    // Credito de fidelidade: so conta quando o pedido chega a 'entregue'
    // (finalizado com sucesso). Idempotente por pedidoId — nunca duplica.
    // Isolado em try/catch proprio: falha aqui jamais pode afetar a resposta
    // do PATCH nem impedir a mudanca de status do pedido, que ja foi salva.
    try {
      await creditarFidelidadePedido({
        pedidoId: id,
        clienteId: pedidos[index].clienteId,
        pizzas: pedidos[index].pizzasCount ?? 0,
      })
    } catch (err) {
      console.error('[ChefeBot] Erro ao creditar fidelidade (ignorado):', err)
    }

    // Fidelidade por pontos (novo modelo, R$1 = 1 ponto): roda em paralelo ao
    // credito antigo acima, sem substitui-lo. Mesma protecao — isolado em
    // try/catch proprio, idempotente por pedidoId, nunca impede o pedido de
    // ser marcado como entregue nem a resposta do PATCH.
    try {
      await creditarPontosPedidoEntregue({
        id,
        status: 'entregue',
        telefone: pedidos[index].telefone,
        clienteId: pedidos[index].clienteId,
        total: pedidos[index].total,
        taxaEntrega: pedidos[index].taxaEntrega,
      })
    } catch (err) {
      console.error('[ChefeBot] Erro ao creditar pontos de fidelidade (ignorado):', err)
    }
  }

  // Cancelamento (modelo novo de pontos): registra a resolucao do previsto ou
  // o estorno de um credito confirmado, sempre no cliente canonico derivado
  // do telefone. Repetir "cancelado" nao cria novo evento; estorno so existe
  // se houver confirmado original no extrato.
  if (status === 'cancelado' && statusAnterior !== 'cancelado') {
    try {
      const clienteIdPontos = derivarClienteIdPorTelefone(pedidos[index].telefone)
      if (clienteIdPontos) {
        const pontosElegiveis = calcularPontosElegiveisPedido({
          total: pedidos[index].total,
          taxaEntrega: pedidos[index].taxaEntrega,
        })
        if (statusAnterior === 'entregue') {
          if (pontosElegiveis > 0) {
            const extratoAtual = await obterExtratoPontos(clienteIdPontos)
            const teveConfirmado = extratoAtual.some(m => m.pedidoId === id && m.tipo === 'confirmado')
            if (teveConfirmado) {
              await registrarMovimentoPontosIdempotente(clienteIdPontos, {
                eventoId: construirEventoIdPontos(id, 'estornado'),
                pedidoId: id,
                tipo: 'estornado',
                pontos: pontosElegiveis,
                motivo: `Pedido ${id} corrigido para cancelado apos entrega`,
              })
            }
          }
        } else if (pontosElegiveis > 0) {
          await registrarMovimentoPontosIdempotente(clienteIdPontos, {
            eventoId: construirEventoIdPontos(id, 'cancelado'),
            pedidoId: id,
            tipo: 'cancelado',
            pontos: pontosElegiveis,
            motivo: `Pedido ${id} cancelado antes da entrega`,
          })
        }
      }
    } catch (err) {
      console.error('[ChefeBot] Erro ao registrar cancelamento de pontos (ignorado):', err)
    }

  }

  // Reverte resgate de fidelidade (Etapa 5), se este pedido tinha usado um:
  // fica fora do guard de transicao para permitir reprocessar falha anterior
  // quando o pedido ja esta cancelado. A lib garante idempotencia.
  if (status === 'cancelado' && pedidos[index].resgateId) {
    try {
      const clienteIdResgate = derivarClienteIdPorTelefone(pedidos[index].telefone)
      if (clienteIdResgate) {
        await reverterResgateConfirmado(
          clienteIdResgate,
          pedidos[index].resgateId,
          `Pedido ${id} cancelado apos usar resgate de fidelidade`
        )
      }
    } catch (err) {
      console.error('[ChefeBot] Erro ao reverter resgate de fidelidade (ignorado):', err)
    }
  }

    const resposta = sanitizarPedidoPixResposta(pedidos[index])
    return NextResponse.json(avisoOperacional ? { ...resposta, avisoOperacional } : resposta)
  } finally {
    await liberarMutexEdicao(id, mutexToken)
  }
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const body = await req.json()
  const { cliente, telefone, itens, total, endereco, bairro, referencia, tipoEntrega, taxaEntrega, pagamento, troco, observacao } = body

  if (!cliente || !itens || itens.length === 0) {
    return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  }

  const pedidos = await getPedidos()
  const numeroPedido = await proximoNumeroPedido()
  const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  const pedidoId = Date.now().toString()
  const pix = criarPixMetadata(pedidoId, pagamento ? String(pagamento) : undefined, Number(total) || 0)

  const novoPedido: Pedido = {
    id: pedidoId,
    numero: numeroPedido,
    cliente: String(cliente),
    telefone: String(telefone || ''),
    itens: Array.isArray(itens) ? itens.filter(Boolean) : [String(itens)],
    total: Number(total) || 0,
    status: 'novo',
    horario: agora,
    endereco: String(endereco || (tipoEntrega === 'pickup' || tipoEntrega === 'retirada' ? 'Retirada na loja' : tipoEntrega === 'dine_in' ? 'Consumo no local' : '')),
    ...(bairro ? { bairro: String(bairro) } : {}),
    ...(referencia ? { referencia: String(referencia) } : {}),
    ...(tipoEntrega ? { tipoEntrega: String(tipoEntrega) } : {}),
    ...(taxaEntrega ? { taxaEntrega: Number(taxaEntrega) } : {}),
    ...(pagamento ? { pagamento: String(pagamento) } : {}),
    ...(pix ? { pix } : {}),
    ...(troco ? { troco: String(troco) } : {}),
    ...(observacao ? { observacao: String(observacao) } : {}),
  }

  await redis.set('pedidos', [...pedidos, novoPedido])
  return NextResponse.json(novoPedido, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const pedidos = await getPedidos()

  if (id) {
    const filtered = pedidos.filter(p => p.id !== id)
    await redis.set('pedidos', filtered)
    return NextResponse.json({ ok: true })
  }

  const filtered = pedidos.filter(p => p.status !== 'entregue')
  await redis.set('pedidos', filtered)
  return NextResponse.json({ ok: true })
}
