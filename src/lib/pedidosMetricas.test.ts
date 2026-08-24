import { describe, expect, test } from "vitest"
import {
  calcularMediaPreparoMinutos,
  contarPedidosOperacionais,
  contarPizzasDoPedido,
  contarPizzasVendidas,
} from "./pedidosMetricas"

describe("métricas operacionais de pedidos", () => {
  test("prioriza pizzasCount oficial e não tenta reinterpretar texto livre", () => {
    expect(contarPizzasDoPedido({ pizzasCount: 3 })).toBe(3)
    expect(contarPizzasDoPedido({ pizzasCount: 0, snapshotOficial: { itens: [{ kind: "pizza", quantidade: 4 }] } })).toBe(0)
    expect(contarPizzasDoPedido({})).toBe(0)
  })

  test("usa itensDetalhados estruturados e não conta presente como pizza vendida", () => {
    expect(contarPizzasDoPedido({
      itensDetalhados: [
        { kind: "pizza", qty: 2 },
        { kind: "simple", qty: 4 },
        { kind: "pizza", qty: 1, recompensaJornadaId: "recompensa_1" },
      ],
    })).toBe(2)
  })

  test("usa snapshot estruturado quando os campos anteriores não existem", () => {
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

  test("quantidade malformada falha fechado em vez de truncar ou converter texto", () => {
    expect(contarPizzasDoPedido({ pizzasCount: 1.8, snapshotOficial: { itens: [] } })).toBe(0)
    expect(contarPizzasDoPedido({ itensDetalhados: [{ kind: "pizza", qty: 1.5 }] })).toBe(0)
  })

  test("total de pedidos ignora cancelados e continua contando as quatro etapas oficiais", () => {
    expect(contarPedidosOperacionais([
      { status: "novo" },
      { status: "em_preparo" },
      { status: "saiu_entrega" },
      { status: "entregue" },
      { status: "cancelado" },
      { status: "cancelado" },
    ])).toBe(4)
    expect(contarPedidosOperacionais([{ status: "cancelado" }, { status: "cancelado" }])).toBe(0)
  })

  test("total de pedidos falha fechado para estado desconhecido", () => {
    expect(contarPedidosOperacionais([
      { status: "novo" },
      { status: "desconhecido" },
      {},
    ])).toBe(1)
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

  test("ignora ciclo desfeito, cancelado, timestamp incompleto, invertido e outlier", () => {
    expect(calcularMediaPreparoMinutos([
      {
        status: "novo",
        preparoIniciadoEm: "2026-08-23T22:00:00.000Z",
        preparoConcluidoEm: "2026-08-23T22:15:00.000Z",
      },
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
