import { describe, test, expect } from "vitest"
import { ehConfirmacaoPedido } from "./confirmacaoPedido"

describe("ehConfirmacaoPedido: confirmações aceitas", () => {
  test('"1" confirma', () => expect(ehConfirmacaoPedido("1")).toBe(true))
  test('"sim" confirma', () => expect(ehConfirmacaoPedido("sim")).toBe(true))
  test('"ok" confirma', () => expect(ehConfirmacaoPedido("ok")).toBe(true))
  test('"confirmar" confirma', () => expect(ehConfirmacaoPedido("confirmar")).toBe(true))
  test('"pode fechar" confirma', () => expect(ehConfirmacaoPedido("pode fechar")).toBe(true))
  test('"isso mesmo" confirma', () => expect(ehConfirmacaoPedido("isso mesmo")).toBe(true))
  test('"confirmado" confirma', () => expect(ehConfirmacaoPedido("confirmado")).toBe(true))
  test('"finalizar" confirma', () => expect(ehConfirmacaoPedido("finalizar")).toBe(true))
  test('"tá certo" confirma (com acento)', () => expect(ehConfirmacaoPedido("tá certo")).toBe(true))
  test('"ta certo" confirma (sem acento)', () => expect(ehConfirmacaoPedido("ta certo")).toBe(true))
  test('"certo" confirma', () => expect(ehConfirmacaoPedido("certo")).toBe(true))
  test('"pode confirmar" confirma', () => expect(ehConfirmacaoPedido("pode confirmar")).toBe(true))
  test('"fechar pedido" confirma', () => expect(ehConfirmacaoPedido("fechar pedido")).toBe(true))
})

describe("ehConfirmacaoPedido: variações de capitalização", () => {
  test('"Sim" confirma', () => expect(ehConfirmacaoPedido("Sim")).toBe(true))
  test('"SIM" confirma', () => expect(ehConfirmacaoPedido("SIM")).toBe(true))
  test('"OK" confirma', () => expect(ehConfirmacaoPedido("OK")).toBe(true))
  test('"Confirmar" confirma', () => expect(ehConfirmacaoPedido("Confirmar")).toBe(true))
  test('"  sim  " confirma (espaços)', () => expect(ehConfirmacaoPedido("  sim  ")).toBe(true))
})

describe("ehConfirmacaoPedido: rejeições", () => {
  test('"não" não confirma', () => expect(ehConfirmacaoPedido("não")).toBe(false))
  test('"nao" não confirma', () => expect(ehConfirmacaoPedido("nao")).toBe(false))
  test('"cancelar" não confirma', () => expect(ehConfirmacaoPedido("cancelar")).toBe(false))
  test('"quero mudar" não confirma', () => expect(ehConfirmacaoPedido("quero mudar")).toBe(false))
  test('"alterar" não confirma', () => expect(ehConfirmacaoPedido("alterar")).toBe(false))
  test('"talvez" não confirma', () => expect(ehConfirmacaoPedido("talvez")).toBe(false))
  test('"pera" não confirma', () => expect(ehConfirmacaoPedido("pera")).toBe(false))
  test('"espera" não confirma', () => expect(ehConfirmacaoPedido("espera")).toBe(false))
  test('"trocar" não confirma', () => expect(ehConfirmacaoPedido("trocar")).toBe(false))
  test('"" não confirma (vazio)', () => expect(ehConfirmacaoPedido("")).toBe(false))
  test('"2" não confirma', () => expect(ehConfirmacaoPedido("2")).toBe(false))
})
