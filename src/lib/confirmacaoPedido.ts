// Normalized (no accents) confirmations accepted at the order confirm step
const CONFIRMACOES = new Set([
  "1",
  "sim",
  "ok",
  "confirmar",
  "confirmado",
  "pode confirmar",
  "fechar pedido",
  "finalizar",
  "isso mesmo",
  "ta certo",
  "certo",
  "pode fechar",
])

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}

export function ehConfirmacaoPedido(texto: string): boolean {
  return CONFIRMACOES.has(normalizar(texto))
}
