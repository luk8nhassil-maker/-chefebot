import { describe, expect, test } from "vitest";
import { deveMostrarConviteRankingPosPedido } from "./rankingProspeccao";

describe("rankingProspeccao", () => {
  test("pedido nao-Pix concluido pode convidar quem ainda nao participa", () => {
    expect(deveMostrarConviteRankingPosPedido({ pedidoConcluido: true, participaCampanha: false, adiouNestaSessao: false, pagamentoStatus: "nao_pix" })).toBe(true);
  });

  test("Pix so pode convidar depois de confirmado como pago", () => {
    for (const pagamentoStatus of ["aguardando_pix", "em_revisao", "conferencia_manual"] as const) {
      expect(deveMostrarConviteRankingPosPedido({ pedidoConcluido: true, participaCampanha: false, adiouNestaSessao: false, pagamentoStatus })).toBe(false);
    }
    expect(deveMostrarConviteRankingPosPedido({ pedidoConcluido: true, participaCampanha: false, adiouNestaSessao: false, pagamentoStatus: "pago" })).toBe(true);
  });

  test("nunca reprospecta participante ativo", () => {
    expect(deveMostrarConviteRankingPosPedido({ pedidoConcluido: true, participaCampanha: true, adiouNestaSessao: false, pagamentoStatus: "nao_pix" })).toBe(false);
  });

  test("Talvez depois bloqueia nova abordagem na mesma sessao", () => {
    expect(deveMostrarConviteRankingPosPedido({ pedidoConcluido: true, participaCampanha: false, adiouNestaSessao: true, pagamentoStatus: "nao_pix" })).toBe(false);
  });

  test("identidade ainda desconhecida pode ver convite sem ganhar consentimento automatico", () => {
    expect(deveMostrarConviteRankingPosPedido({ pedidoConcluido: true, participaCampanha: null, adiouNestaSessao: false, pagamentoStatus: "nao_pix" })).toBe(true);
  });
});
