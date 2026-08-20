// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import SalaoItensPedido from "./SalaoItensPedido"
import type { ItemApp } from "@/lib/pedidoAppItens"

afterEach(cleanup)

describe("SalaoItensPedido", () => {
  it("não ocupa espaço quando o pedido ainda está vazio", () => {
    const { container } = render(<SalaoItensPedido itens={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("mostra quantidade, identificação e valor dos itens com o mais recente primeiro", () => {
    const itens: ItemApp[] = [
      { kind: "simple", name: "Refrigerante", detail: "2L", price: 12, qty: 1 },
      { kind: "simple", name: "Água", detail: "Com gás", price: 6, qty: 2 },
    ]

    render(<SalaoItensPedido itens={itens} />)

    const resumo = screen.getByRole("region", { name: "Itens adicionados ao pedido" })
    expect(within(resumo).getByText("Itens no pedido")).toBeInTheDocument()
    expect(within(resumo).getByText("2 item(ns) · R$ 24,00")).toBeInTheDocument()
    expect(within(resumo).getByText("2×")).toBeInTheDocument()
    expect(within(resumo).getByText("Água")).toBeInTheDocument()
    expect(within(resumo).getByText("Com gás")).toBeInTheDocument()

    const linhas = within(resumo).getAllByTestId("salao-item-resumo")
    expect(within(linhas[0]).getByText("Água")).toBeInTheDocument()
    expect(within(linhas[1]).getByText("Refrigerante")).toBeInTheDocument()
  })
})
