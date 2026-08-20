import { describe, expect, it } from "vitest";
import { validarPagamentoContaSalao } from "./salaoPagamento";

const formas = ["Pix", "Dinheiro", "Cartão", "Pix + Dinheiro"];

describe("Salão — pagamento da conta", () => {
  it("aceita somente forma presente no cardápio oficial", () => {
    expect(validarPagamentoContaSalao({ pagamento: "Pix", totalCentavos: 5000, formasOficiais: formas })).toEqual({
      ok: true,
      valor: { pagamento: "Pix" },
    });
    expect(validarPagamentoContaSalao({ pagamento: "Vale inventado", totalCentavos: 5000, formasOficiais: formas })).toMatchObject({ ok: false });
  });

  it("normaliza acento/capitalização sem inventar outra forma", () => {
    expect(validarPagamentoContaSalao({ pagamento: "cartao", totalCentavos: 5000, formasOficiais: formas })).toEqual({
      ok: true,
      valor: { pagamento: "Cartão" },
    });
  });

  it("dinheiro sem troco permanece explícito", () => {
    expect(validarPagamentoContaSalao({ pagamento: "Dinheiro", totalCentavos: 5000, formasOficiais: formas })).toEqual({
      ok: true,
      valor: { pagamento: "Dinheiro", troco: "Sem troco" },
    });
  });

  it("recusa troco menor que o total", () => {
    expect(validarPagamentoContaSalao({ pagamento: "Dinheiro", troco: "R$ 49,99", totalCentavos: 5000, formasOficiais: formas })).toMatchObject({ ok: false });
  });

  it("aceita pagamento misto somente quando a soma fecha no total", () => {
    expect(validarPagamentoContaSalao({
      pagamento: "Pix + Dinheiro",
      valorPix: "30,00",
      valorDinheiro: "20,00",
      totalCentavos: 5000,
      formasOficiais: formas,
    })).toEqual({
      ok: true,
      valor: { pagamento: "Pix (R$ 30,00) + Dinheiro (R$ 20,00)" },
    });

    expect(validarPagamentoContaSalao({
      pagamento: "Pix + Dinheiro",
      valorPix: "30,00",
      valorDinheiro: "19,00",
      totalCentavos: 5000,
      formasOficiais: formas,
    })).toMatchObject({ ok: false });
  });

  it("não habilita misto só porque o código conhece a estratégia", () => {
    expect(validarPagamentoContaSalao({
      pagamento: "Pix + Dinheiro",
      valorPix: "30,00",
      valorDinheiro: "20,00",
      totalCentavos: 5000,
      formasOficiais: ["Pix", "Dinheiro"],
    })).toMatchObject({ ok: false });
  });
});
