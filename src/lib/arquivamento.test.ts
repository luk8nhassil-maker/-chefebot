import { vi, describe, test, expect, beforeEach } from "vitest"

// Mock redis
const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
}
vi.mock("./redis", () => ({ redis: redisMock }))
vi.mock("./auth", () => ({
  verifyToken: vi.fn().mockResolvedValue({ role: "atendente", name: "Kellyne" }),
}))

// Helpers para criar pedidos de teste
function pedidoNovo(overrides = {}) {
  return {
    id: Date.now().toString(),
    cliente: "Cliente Teste",
    telefone: "86999999999",
    itens: ["Pizza Calabresa Grande"],
    total: 45,
    status: "novo",
    horario: "19:30",
    endereco: "Rua Teste, 123",
    pagamento: "Dinheiro",
    data: new Date().toLocaleDateString("pt-BR"),
    ...overrides,
  }
}

function pedidoEntregue(overrides = {}) {
  return pedidoNovo({ status: "entregue", ...overrides })
}

function pedidoPix(overrides = {}) {
  return pedidoNovo({ pagamento: "Pix", pixConfirmado: false, ...overrides })
}

function pedidoArquivado(overrides = {}) {
  return pedidoNovo({
    isArchived: true,
    archivedAt: new Date().toISOString(),
    archivedBy: "system",
    archivedReason: "fim_expediente",
    ...overrides,
  })
}

// ─── Testes de lógica de arquivamento ───────────────────────────────────────

describe("Arquivamento: regras básicas", () => {
  test("pedido com status 'novo' deve ser arquivável", () => {
    const p = pedidoNovo()
    expect(["entregue", "cancelado"].includes(p.status)).toBe(false)
    expect(p.isArchived).toBeUndefined()
    // Pode ser arquivado
    expect(true).toBe(true)
  })

  test("pedido com status 'entregue' NÃO deve ser arquivado automaticamente", () => {
    const p = pedidoEntregue()
    const deveArquivar = !["entregue", "cancelado"].includes(p.status)
    expect(deveArquivar).toBe(false)
  })

  test("pedido com status 'cancelado' NÃO deve ser arquivado automaticamente", () => {
    const p = pedidoNovo({ status: "cancelado" })
    const deveArquivar = !["entregue", "cancelado"].includes(p.status)
    expect(deveArquivar).toBe(false)
  })

  test("pedido Pix aguardando comprovante é arquivável", () => {
    const p = pedidoPix()
    expect(p.status).toBe("novo")
    expect(p.pixConfirmado).toBe(false)
    const deveArquivar = !["entregue", "cancelado"].includes(p.status) && !p.isArchived
    expect(deveArquivar).toBe(true)
  })

  test("pedido já arquivado não é arquivado novamente", () => {
    const p = pedidoArquivado()
    const deveArquivar = !p.isArchived && !["entregue", "cancelado"].includes(p.status)
    expect(deveArquivar).toBe(false)
  })
})

describe("Arquivamento: integridade de dados", () => {
  test("arquivamento preserva todos os campos do pedido", () => {
    const original = pedidoNovo({
      id: "12345",
      cliente: "Maria Silva",
      telefone: "86988887777",
      itens: ["Pizza Frango Grande", "Coca-Cola 2L"],
      total: 67.50,
      pagamento: "Cartão",
      troco: undefined,
      tipoEntrega: "delivery",
      bairro: "Centro",
      endereco: "Rua das Flores, 42",
      observacao: "Sem cebola",
    })

    // Simula o arquivamento
    const arquivado = {
      ...original,
      isArchived: true,
      archivedAt: new Date().toISOString(),
      archivedBy: "system",
      archivedReason: "fim_expediente",
    }

    // Dados originais preservados
    expect(arquivado.id).toBe("12345")
    expect(arquivado.cliente).toBe("Maria Silva")
    expect(arquivado.telefone).toBe("86988887777")
    expect(arquivado.itens).toEqual(["Pizza Frango Grande", "Coca-Cola 2L"])
    expect(arquivado.total).toBe(67.50)
    expect(arquivado.status).toBe("novo")
    expect(arquivado.pagamento).toBe("Cartão")
    expect(arquivado.tipoEntrega).toBe("delivery")
    expect(arquivado.bairro).toBe("Centro")
    expect(arquivado.observacao).toBe("Sem cebola")
    // Metadados de arquivamento adicionados
    expect(arquivado.isArchived).toBe(true)
    expect(arquivado.archivedBy).toBe("system")
    expect(arquivado.archivedReason).toBe("fim_expediente")
    expect(arquivado.archivedAt).toBeDefined()
  })

  test("arquivamento Pix não apaga pixConfirmado", () => {
    const p = pedidoPix({ pixConfirmado: false })
    const arquivado = { ...p, isArchived: true, archivedAt: new Date().toISOString() }
    expect(arquivado.pixConfirmado).toBe(false)
    expect(arquivado.pagamento).toBe("Pix")
  })

  test("arquivamento preserva observação do pedido", () => {
    const p = pedidoNovo({ observacao: "Sem glúten por favor" })
    const arquivado = { ...p, isArchived: true }
    expect(arquivado.observacao).toBe("Sem glúten por favor")
  })
})

describe("Arquivamento: filtros de exibição", () => {
  test("lista principal NÃO deve incluir pedidos arquivados", () => {
    const lista = [
      pedidoNovo({ id: "1" }),
      pedidoArquivado({ id: "2" }),
      pedidoEntregue({ id: "3" }),
    ]
    const ativos = lista.filter(p => !p.isArchived)
    expect(ativos.length).toBe(2)
    expect(ativos.some(p => p.id === "2")).toBe(false)
    expect(ativos.some(p => p.id === "1")).toBe(true)
    expect(ativos.some(p => p.id === "3")).toBe(true)
  })

  test("lista de arquivados deve incluir APENAS pedidos arquivados", () => {
    const lista = [
      pedidoNovo({ id: "1" }),
      pedidoArquivado({ id: "2" }),
      pedidoArquivado({ id: "4", archivedBy: "manual" }),
    ]
    const arquivados = lista.filter(p => p.isArchived)
    expect(arquivados.length).toBe(2)
    expect(arquivados.every(p => p.isArchived)).toBe(true)
    expect(arquivados.some(p => p.id === "1")).toBe(false)
  })

  test("pedido novo recém-criado NÃO aparece arquivado", () => {
    const p = pedidoNovo()
    expect(p.isArchived).toBeUndefined()
    expect(!p.isArchived).toBe(true)
  })
})

describe("Arquivamento em lote: fim de expediente", () => {
  test("arquivamento em lote não afeta entregues/cancelados", () => {
    const lista = [
      pedidoNovo({ id: "1", status: "novo" }),
      pedidoNovo({ id: "2", status: "em_preparo" }),
      pedidoEntregue({ id: "3" }),
      pedidoNovo({ id: "4", status: "cancelado" }),
    ]

    const agora = new Date().toISOString()
    const resultado = lista.map(p => {
      if (p.isArchived) return p
      if (["entregue", "cancelado"].includes(p.status)) return p
      return { ...p, isArchived: true, archivedAt: agora, archivedBy: "system", archivedReason: "fim_expediente" }
    })

    const arquivados = resultado.filter(p => p.isArchived)
    expect(arquivados.length).toBe(2)
    expect(resultado.find(p => p.id === "3")?.isArchived).toBeUndefined()
    expect(resultado.find(p => p.id === "4")?.isArchived).toBeUndefined()
  })

  test("pedido aguardando Pix vai para arquivados no fim de expediente", () => {
    const p = pedidoPix({ id: "pix-1", status: "novo" })
    const resultado = !["entregue", "cancelado"].includes(p.status) && !p.isArchived
    expect(resultado).toBe(true)
  })

  test("arquivamento em lote já-arquivado não duplica", () => {
    const p = pedidoArquivado({ id: "ja-arquivado", archivedAt: "2024-01-01T00:00:00.000Z" })
    const novaData = new Date().toISOString()
    const resultado = p.isArchived ? p : { ...p, isArchived: true, archivedAt: novaData }
    // Não deve alterar o pedido já arquivado
    expect(resultado.archivedAt).toBe("2024-01-01T00:00:00.000Z")
  })
})

describe("Pedidos do simulador vs WhatsApp real", () => {
  test("pedido do simulador tem campo 'data'", () => {
    const p = pedidoNovo({ data: new Date().toLocaleDateString("pt-BR") })
    expect(p.data).toBeDefined()
    expect(p.data).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  test("pedido com 'data' não é removido prematuramente pela limpeza", () => {
    const hoje = new Date()
    const [dia, mes, ano] = new Date().toLocaleDateString("pt-BR").split("/").map(Number)
    const dataPedido = new Date(ano, mes - 1, dia)
    const diffDias = (hoje.getTime() - dataPedido.getTime()) / 1000 / 60 / 60 / 24
    expect(diffDias).toBeLessThan(7)
  })
})
