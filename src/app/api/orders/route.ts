import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import type { PedidoEntregador } from '@/types/entregador'

const APP_BASE_URL = 'https://chefebot-pjif.vercel.app'

type Status = 'novo' | 'em_preparo' | 'saiu_entrega' | 'entregue' | 'cancelado'
type Pedido = {
  id: string
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: Status
  horario: string
  endereco: string
  pagamento?: string
  troco?: string
  entregador?: { id: string; nome: string; telefone: string }
  tipoEntrega?: string
  taxaEntrega?: number
  bairro?: string
  horarioInicio?: string
}

const PEDIDOS_INICIAIS: Pedido[] = [
  { id: '1', cliente: 'Ana Lima', telefone: '(86) 99801-1234', itens: ['Pizza Calabresa G', 'Borda Catupiry G', 'Coca 2L'], total: 72.00, status: 'entregue', horario: '19:42', endereco: 'Rua Lizandro Nogueira, 210 - Centro' },
  { id: '2', cliente: 'Carlos Sousa', telefone: '(86) 99700-5678', itens: ['Pizza Frango c/ Catupiry G', 'Pizza Portuguesa M'], total: 90.00, status: 'entregue', horario: '19:35', endereco: 'Av. Frei Serafim, 1200 - Centro' },
  { id: '3', cliente: 'Juliana Costa', telefone: '(86) 98800-9012', itens: ['Pizza 4 Queijos G', 'Borda Chocolate G'], total: 62.00, status: 'entregue', horario: '19:10', endereco: 'Rua Coelho Rodrigues, 45 - Ilhotas' },
  { id: '4', cliente: 'Marcos Oliveira', telefone: '(86) 99600-3456', itens: ['Pizza Pepperoni M', 'Suco de Laranja 1L'], total: 52.00, status: 'entregue', horario: '18:50', endereco: 'Rua Gabriel Ferreira, 88 - Vermelha' },
]

const EVOLUTION_API_URL = 'https://evolution-api-production-8f99.up.railway.app'
const EVOLUTION_API_KEY = '6208711c1b6fdffcc30cb492a44d74601415c33ff717ef6032162f9c0056319e'
const EVOLUTION_INSTANCE = 'chefe'

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
  const phone = sanitizePhone(telefone)
  try {
    await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY,
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
  return NextResponse.json([...pedidos].reverse())
}

export async function PATCH(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const { id, status, entregador } = await req.json()
  const pedidos = await getPedidos()
  const index = pedidos.findIndex(p => p.id === id)
  if (index === -1) return NextResponse.json({ error: 'Pedido nao encontrado' }, { status: 404 })

  const agora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
  pedidos[index] = {
    ...pedidos[index],
    status,
    ...(status === 'cancelado' ? { cancelamentoSolicitado: false } : {}),
    ...(status === 'em_preparo' && !pedidos[index].horarioInicio ? { horarioInicio: agora } : {}),
  }

  // Salva entregador no pedido se informado
  if (entregador) {
    pedidos[index] = { ...pedidos[index], entregador }
  }
  await redis.set('pedidos', pedidos)
  await notificarCliente(pedidos[index].telefone, status, pedidos[index].cliente)

  // Notifica entregador no WhatsApp quando pedido sai para entrega + salva no Redis + envia link de rastreamento ao cliente
  if (status === 'saiu_entrega' && entregador?.telefone) {
    const pedido = pedidos[index]
    const phone = entregador.telefone.replace(/\D/g, '')
    const phoneFormatado = phone.startsWith('55') ? phone : '55' + phone
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

    // Salva pedido na fila do entregador no Redis
    const pedidoEntregador: PedidoEntregador = {
      pedidoId: pedido.id,
      entregadorId: entregador.id,
      entregadorNome: entregador.nome,
      entregadorTelefone: entregador.telefone,
      clienteNome: pedido.cliente,
      clienteTelefone: pedido.telefone,
      endereco: pedido.endereco,
      total: pedido.total,
      itens: pedido.itens,
      status: 'pendente',
      horarioSaida: agora,
    }
    const filaMotoboy = await redis.get<PedidoEntregador[]>(`entregador:pedidos:${entregador.id}`) || []
    const filtrado = filaMotoboy.filter(p => p.pedidoId !== pedido.id)
    await redis.set(`entregador:pedidos:${entregador.id}`, [...filtrado, pedidoEntregador], { ex: 86400 })

    try {
      // Mensagem para o motoboy com link da área do entregador
      await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
        body: JSON.stringify({
          number: phoneFormatado,
          text: `🛵 *Novo pedido para entregar!*\n👤 Cliente: ${pedido.cliente}\n📍 Endereço: ${pedido.endereco}\n💰 Total: R$ ${pedido.total.toFixed(2).replace('.', ',')}\nAcesse: ${APP_BASE_URL}/entregador?id=${entregador.id}`,
        }),
      })

      // Mensagem para o cliente com link de rastreamento
      const clientePhone = sanitizePhone(pedido.telefone)
      await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
        body: JSON.stringify({
          number: clientePhone,
          text: `Seu pedido saiu! 🛵\nEntregador: *${entregador.nome}*\nAcompanhe: ${APP_BASE_URL}/rastrear/${pedido.id}`,
        }),
      })

      await redis.set(`entregador_aguardando:${phoneFormatado}`, pedido.id, { ex: 3 * 60 * 60 })
    } catch {}
  }

  if (status === 'entregue') {
    const phone = sanitizePhone(pedidos[index].telefone)
    const chaveAvaliacao = `avaliacao_enviada:${id}`
    const jaEnviou = await redis.get(chaveAvaliacao)
    if (!jaEnviou) {
      await redis.set(chaveAvaliacao, true, { ex: 86400 })
      await redis.set(`avaliacao:${phone}`, true, { ex: 3600 })
      const firstName = pedidos[index].cliente.split(' ')[0]
      try {
        await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': EVOLUTION_API_KEY,
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

  return NextResponse.json(pedidos[index])
}