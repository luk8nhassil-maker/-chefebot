import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8")

describe("/pedidos — métricas operacionais", () => {
  test("separa número de pedidos da quantidade real de pizzas", () => {
    expect(fonte).toContain('from "@/lib/pedidosMetricas"')
    expect(fonte).toContain("const totalPedidos = contarPedidosOperacionais(pedidos)")
    expect(fonte).not.toContain("const totalPedidos = pedidos.length")
    expect(fonte).toContain("const pizzasVendidas = contarPizzasVendidas(pedidos)")
    expect(fonte).toContain(">Pedidos</div>")
    expect(fonte).toContain(">Pizzas</div>")
    expect(fonte).not.toContain("const totalHoje = pedidos.length")
  })

  test("média do painel usa só o tempo real da etapa de preparo", () => {
    expect(fonte).toContain("const tempoMedioPreparo = calcularMediaPreparoMinutos(pedidos)")
    expect(fonte).toContain(">⏱ Média preparo</div>")
    expect(fonte).not.toContain("temposEntregaRef")
  })

  test("grade de métricas continua responsiva", () => {
    expect(fonte).toContain(".cb-metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));")
    expect(fonte).toContain(".cb-metrics { grid-template-columns:repeat(5,minmax(0,1fr)); }")
  })
})
