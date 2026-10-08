import { describe, expect, test } from 'vitest'
import { cruzarGrupoComRanking } from './rankingAuditoria'

describe('auditoria do grupo de clientes recorrentes', () => {
  test('cruza clientes com 5+ pedidos e devolve somente posições', () => {
    const resultado = cruzarGrupoComRanking(
      [
        { clienteId: 'a', pedidos: 5 },
        { clienteId: 'b', pedidos: 8 },
        { clienteId: 'c', pedidos: 4 },
        { clienteId: 'd', pedidos: 6 },
      ],
      [
        { clienteId: 'a', posicao: 2 },
        { clienteId: 'b', posicao: 13 },
        { clienteId: 'c', posicao: 1 },
        { clienteId: 'd', posicao: 7 },
      ],
    )

    expect(resultado).toEqual({
      totalClientesGrupo: 3,
      totalNoTop10: 2,
      posicoes: [2, 7, 13],
      posicoesForaDoTop10: [13],
    })
  })
})
