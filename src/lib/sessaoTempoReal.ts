// Sessão mínima para o painel Tempo Real quando o atendimento humano está ativo
// (manual:{phone} === true) mas a session:{phone} já expirou/foi removida.
//
// Objetivo: a conversa em atendimento humano NUNCA some do Tempo Real só porque o
// estado temporário do pedido (session) expirou. Esta reconstrução é apenas para o
// painel abrir sem quebrar — NÃO inventa carrinho, Pix, pedido, entrega ou pagamento.

export interface SessaoTempoRealMinima {
  phone: string
  lastDigits: string
  step: string
  stepLabel: string
  cart: string[]
  manual: boolean
  postOrderPriority: boolean
  conversationAlert: boolean
  novaMsgManual: boolean
  ultimaMensagem: string | null
  customerName: string | null
  resumoRapido: null
  ultimaTs: number
}

export function montarSessaoManualMinima(
  phone: string,
  extras: {
    ultimaMensagem?: string | null
    customerName?: string | null
    conversationAlert?: boolean
    novaMsgManual?: boolean
    ultimaTs?: number
  } = {},
): SessaoTempoRealMinima {
  return {
    phone,
    lastDigits: phone.slice(-4),
    step: 'manual',
    stepLabel: 'atendimento humano',
    cart: [],                       // nunca inventa itens
    manual: true,
    postOrderPriority: false,
    conversationAlert: !!extras.conversationAlert,
    novaMsgManual: !!extras.novaMsgManual,
    ultimaMensagem: extras.ultimaMensagem ?? null,
    customerName: extras.customerName ?? null,
    resumoRapido: null,             // nunca inventa pedido/Pix/pagamento
    ultimaTs: extras.ultimaTs ?? 0,
  }
}
