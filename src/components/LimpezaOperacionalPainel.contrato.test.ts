import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const source = readFileSync(new URL("./LimpezaOperacionalPainel.tsx", import.meta.url), "utf8")

describe("LimpezaOperacionalPainel — contrato do modal obrigatório", () => {
  test("não pode ser desligado pela flag antiga de rollout", () => {
    expect(source).not.toContain("NEXT_PUBLIC_LIMPEZA_OPERACIONAL_ENABLED")
    expect(source).toMatch(/export function limpezaOperacionalAtiva\(\): boolean \{\s*return true\s*\}/)
  })

  test("usa copy curta e explica o efeito de cada ação", () => {
    expect(source).not.toContain("atual.descricao")
    expect(source).toContain("Decida: fazer, aguardar ou cancelar.")
    expect(source).toContain("Atualize se avançou ou continua fazendo.")
    expect(source).toContain("→ Vai para Fazendo e passa ao próximo.")
    expect(source).toContain("→ Este pedido sai da vez e volta em ${minutos} min.")
    expect(source).toContain("→ Finaliza o pedido e passa ao próximo.")
    expect(source).toContain("→ Se pago, sai da pendência; se não, continua aguardando.")
    expect(source).toContain("→ Cancela o pedido e passa ao próximo.")
  })

  test("continua bloqueante e processa uma pendência por vez", () => {
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-modal="true"')
    expect(source).toContain('const atual = pendenciasVisiveis[0]')
    expect(source).toContain('{`1 de ${total}`}')
    expect(source).not.toContain("Fechar sem ação")
  })
})
