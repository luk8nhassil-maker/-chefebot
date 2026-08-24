import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const fonte = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8")
const inicio = fonte.indexOf("async function aplicarMudancaDeStatus")
const fim = fonte.indexOf("export async function PATCH")
const aplicarStatus = fonte.slice(inicio, fim)

describe("/api/orders — carimbos oficiais da etapa de preparo", () => {
  test("início e conclusão são campos ISO separados do relógio visual legado", () => {
    expect(fonte).toContain("preparoIniciadoEm?: string")
    expect(fonte).toContain("preparoConcluidoEm?: string")
    expect(aplicarStatus).toContain("const agoraIso = agoraData.toISOString()")
    expect(aplicarStatus).toContain("statusAtualizadoEm: agoraIso")
  })

  test("entrar em preparo inicia um ciclo novo sem depender do horário do pedido", () => {
    expect(aplicarStatus).toContain("const iniciouPreparoAgora = status === 'em_preparo' && statusAnterior !== 'em_preparo'")
    expect(aplicarStatus).toContain("preparoIniciadoEm: agoraIso, preparoConcluidoEm: undefined")
  })

  test("sair de preparo fecha o ciclo e preserva compatibilidade para pedido já em andamento", () => {
    expect(aplicarStatus).toContain("const concluiuPreparoAgora = statusAnterior === 'em_preparo' && status !== 'em_preparo'")
    expect(aplicarStatus).toContain("const inicioPreparoAnterior = pedidos[index].preparoIniciadoEm || pedidos[index].statusAtualizadoEm")
    expect(aplicarStatus).toContain("preparoIniciadoEm: inicioPreparoAnterior || agoraIso")
    expect(aplicarStatus).toContain("preparoConcluidoEm: agoraIso")
  })

  test("repetir o mesmo status em_preparo não reinicia o relógio", () => {
    expect(aplicarStatus).toContain("statusAnterior !== 'em_preparo'")
  })
})
