export type PedidoParaMetricas = {
  status?: string
  pizzasCount?: number
  snapshotOficial?: {
    itens?: Array<{
      kind?: string
      quantidade?: number
    }>
  }
  preparoIniciadoEm?: string
  preparoConcluidoEm?: string
}

function inteiroNaoNegativo(valor: unknown): number | null {
  const numero = Number(valor)
  if (!Number.isFinite(numero) || numero < 0) return null
  return Math.trunc(numero)
}

/**
 * Quantidade oficial de pizzas do pedido para apresentação operacional.
 *
 * Prioridade:
 * 1. pizzasCount, já calculado pelo fluxo oficial e usado pela fidelidade;
 * 2. snapshotOficial estruturado, quando o campo legado não estiver presente;
 * 3. zero, sem tentar adivinhar a partir de texto livre de itens antigos.
 */
export function contarPizzasDoPedido(pedido: PedidoParaMetricas): number {
  const declarado = inteiroNaoNegativo(pedido.pizzasCount)
  if (declarado !== null) return declarado

  const itens = pedido.snapshotOficial?.itens
  if (!Array.isArray(itens)) return 0

  return itens.reduce((soma, item) => {
    if (item?.kind !== "pizza") return soma
    return soma + (inteiroNaoNegativo(item.quantidade) ?? 0)
  }, 0)
}

/**
 * Pizzas efetivamente mantidas no expediente atual. Pedido cancelado não
 * entra no total. A janela temporal continua sendo a mesma lista oficial
 * carregada pelo painel; esta função não inventa uma segunda regra de data.
 */
export function contarPizzasVendidas(pedidos: PedidoParaMetricas[]): number {
  if (!Array.isArray(pedidos)) return 0
  return pedidos
    .filter((pedido) => pedido?.status !== "cancelado")
    .reduce((soma, pedido) => soma + contarPizzasDoPedido(pedido), 0)
}

function timestampValido(valor: unknown): number | null {
  if (typeof valor !== "string" || !valor) return null
  const ms = Date.parse(valor)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Média REAL de preparo: início oficial da cozinha -> saída oficial da etapa
 * de preparo. Só usa pares completos e válidos; nunca transforma tempo de
 * entrega em tempo de cozinha e nunca estima uma duração ausente.
 */
export function calcularMediaPreparoMinutos(pedidos: PedidoParaMetricas[]): number | null {
  if (!Array.isArray(pedidos)) return null

  const duracoes = pedidos.flatMap((pedido) => {
    if (pedido?.status === "cancelado") return []
    const inicio = timestampValido(pedido?.preparoIniciadoEm)
    const fim = timestampValido(pedido?.preparoConcluidoEm)
    if (inicio === null || fim === null || fim <= inicio) return []

    const minutos = (fim - inicio) / 60_000
    // Proteção contra dado corrompido/outlier impossível para a operação.
    if (minutos <= 0 || minutos >= 300) return []
    return [minutos]
  })

  if (duracoes.length === 0) return null
  return Math.round(duracoes.reduce((soma, minutos) => soma + minutos, 0) / duracoes.length)
}
