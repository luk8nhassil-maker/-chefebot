import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin — métricas por período", () => {
  test("em andamento reconhece os status reais atuais", () => {
    expect(fonte).toContain("statusCounts['novo']")
    expect(fonte).toContain("statusCounts['em_preparo']")
    expect(fonte).toContain("statusCounts['saiu_entrega']")
  })

  test("cards não ficam rotulados como Hoje quando outro período está selecionado", () => {
    expect(fonte).toContain("Pedidos do período")
    expect(fonte).toContain("Faturamento do período")
    expect(fonte).not.toContain(">Pedidos hoje</p>")
    expect(fonte).not.toContain(">Faturamento dia</p>")
  })
})
