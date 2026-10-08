export type RankingAuditoriaEntrada = {
  clienteId: string
  pedidos: number
}

export type RankingAuditoriaPosicao = {
  posicao: number
}

export type ResultadoAuditoriaGrupo = {
  totalClientesGrupo: number
  totalNoTop10: number
  posicoes: number[]
  posicoesForaDoTop10: number[]
}

/**
 * Cruza um grupo de clientes com a posição do ranking sem expor qualquer
 * identificador. A função é pura para ser usada pela auditoria e testada sem
 * acessar o banco.
 */
export function cruzarGrupoComRanking(
  clientes: RankingAuditoriaEntrada[],
  ranking: Array<RankingAuditoriaPosicao & { clienteId: string }>,
  minimoPedidos = 5,
): ResultadoAuditoriaGrupo {
  const grupo = new Set(
    clientes
      .filter((cliente) => cliente.pedidos >= minimoPedidos && cliente.clienteId.trim().length > 0)
      .map((cliente) => cliente.clienteId),
  )
  const posicoes = ranking
    .filter((entrada) => grupo.has(entrada.clienteId) && Number.isInteger(entrada.posicao) && entrada.posicao > 0)
    .map((entrada) => entrada.posicao)
    .sort((a, b) => a - b)

  return {
    totalClientesGrupo: grupo.size,
    totalNoTop10: posicoes.filter((posicao) => posicao <= 10).length,
    posicoes,
    posicoesForaDoTop10: posicoes.filter((posicao) => posicao > 10),
  }
}
