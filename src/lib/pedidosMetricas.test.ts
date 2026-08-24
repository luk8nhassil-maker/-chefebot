import { describe, expect, test } from "vitest"
import {
  calcularMediaPreparoMinutos,
  contarPizzasDoPedido,
  contarPizzasVendidas,
} from "./pedidosMetricas"

describe("métricas operacionais de pedidos", () => {
  test("prioriza pizzasCount oficial e não tenta reinterpretar texto livre", () => {
    expect(contarPizzasDoPedido({ pizzasCount: 3 })).toBe(3)
    expect(contarPizzasDoPedido({ pizzasCount: 0, snapshotOficial: { itens: [{ kind: "pizza", quantidade: 4 }] } })).toBe(0)
    expect(contarPizzasDoPedido({})).toBe(0)
  })

  test("usa snapshot estruturado quando pizzasCount não existe", () => {
    expect(contarPizzasDoPedido({
      snapshotOficial: {
        itens: [
          { kind: "pizza", quantidade: 2 },
          { kind: "simple", quantidade: 4 },
          { kind: "pizza", quantidade: 1 },
        ],
      },
    })).toBe(3)
  })

  test("pizzas vendidas ignora pedidos cancelados", () => {
    expect(contarPizzasVendidas([
      { status: "novo", pizzasCount: 2 },
      { status: "em_preparo", pizzasCount: 1 },
      { status: "entregue", pizzasCount: 3 },
      { status: "cancelado", pizzasCount: 7 },
    ])).toBe(6)
  })

  test("calcula média somente com tempo real de cozinha", () => {
    expect(calcularMediaPreparoMinutos([
      {
        status: "saiu_entrega",
        preparoIniciadoEm: "2026-08-23T23:00:00.000Z",
        preparoConcluidoEm: "2026-08-23T23:20:00.000Z",
      },
      {
        status: "entregue",
        preparoIniciadoEm: "2026-08-23T23:30:00.000Z",
        preparoConcluidoEm: "2026-08-24T00:10:00.000Z",
      },
    ])).toBe(30)
  })

  test("ignora cancelado, timestamp incompleto, invertido e outlier", () => {
    expect(calcularMediaPreparoMinutos([
      {
        status: "cancelado",
        preparoIniciadoEm: "2026-08-23T23:00:00.000Z",
        preparoConcluidoEm: "2026-08-23T23:10:00.000Z",
      },
      { status: "entregue", preparoIniciadoEm: "2026-08-23T23:00:00.000Z" },
      {
        status: "entregue",
        preparoIniciadoEm: "2026-08-23T23:30:00.000Z",
        preparoConcluidoEm: "2026-08-23T23:20:00.000Z",
      },
      {
        status: "entregue",
        preparoIniciadoEm: "2026-08-23T00:00:00.000Z",
        preparoConcluidoEm: "2026-08-23T06:00:00.000Z",
      },
    ])).toBeNull()
  })
})
