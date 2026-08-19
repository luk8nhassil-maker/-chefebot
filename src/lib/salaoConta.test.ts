import { describe, expect, it } from "vitest";
import {
  avaliarSolicitacaoConta,
  compararTotalEsperado,
  contaBloqueiaNovosItens,
  descreverStatusPedidoSalao,
  estadoInicialContaSalao,
  totalAtivoCentavos,
  type EnvioOperacionalSalao,
} from "./salaoConta";

function envio(overrides: Partial<EnvioOperacionalSalao> = {}): EnvioOperacionalSalao {
  return {
    rodadaId: "r1",
    numero: 1,
    pedidoId: "pedido-1",
    subtotalCentavos: 1000,
    status: "entregue",
    ...overrides,
  };
}

describe("Salão — estado operacional", () => {
  it("traduz as etapas do pedido oficial para ações do garçom", () => {
    expect(descreverStatusPedidoSalao("novo").rotulo).toBe("Aguardando cozinha");
    expect(descreverStatusPedidoSalao("em_preparo").rotulo).toBe("Em preparo");
    expect(descreverStatusPedidoSalao("saiu_entrega").rotulo).toBe("Pronto para servir");
    expect(descreverStatusPedidoSalao("entregue").rotulo).toBe("Servido");
    expect(descreverStatusPedidoSalao("cancelado").rotulo).toBe("Pedido cancelado");
  });

  it("status ausente nunca é tratado como servido", () => {
    expect(descreverStatusPedidoSalao(undefined)).toMatchObject({
      rotulo: "Atualização pendente",
      tom: "atencao",
    });
  });
});

describe("Salão — pedir conta", () => {
  it("permite somente quando todos os envios ativos estão servidos", () => {
    expect(avaliarSolicitacaoConta({ envios: [envio(), envio({ rodadaId: "r2", numero: 2, pedidoId: "pedido-2" })], temRodadaEmAndamento: false })).toEqual({
      ok: true,
      totalCentavos: 2000,
    });
  });

  it("bloqueia pedido em preparo", () => {
    expect(avaliarSolicitacaoConta({ envios: [envio({ status: "em_preparo" })], temRodadaEmAndamento: false })).toMatchObject({ ok: false, code: "envio_pendente" });
  });

  it("bloqueia sincronização sem status oficial", () => {
    expect(avaliarSolicitacaoConta({ envios: [envio({ status: undefined })], temRodadaEmAndamento: false })).toMatchObject({ ok: false, code: "sincronizacao_pendente" });
  });

  it("bloqueia enquanto existe rodada ainda não enviada", () => {
    expect(avaliarSolicitacaoConta({ envios: [envio()], temRodadaEmAndamento: true })).toMatchObject({ ok: false, code: "rascunho_aberto" });
  });

  it("pedido cancelado não entra no total nem impede a conta", () => {
    const envios = [envio(), envio({ rodadaId: "r2", numero: 2, pedidoId: "pedido-2", subtotalCentavos: 9000, status: "cancelado" })];
    expect(totalAtivoCentavos(envios)).toBe(1000);
    expect(avaliarSolicitacaoConta({ envios, temRodadaEmAndamento: false })).toEqual({ ok: true, totalCentavos: 1000 });
  });
});

describe("Salão — fechamento", () => {
  it("compara total em centavos com tolerância máxima de um centavo", () => {
    expect(compararTotalEsperado(1000, 1000)).toBe(true);
    expect(compararTotalEsperado(1001, 1000)).toBe(true);
    expect(compararTotalEsperado(1002, 1000)).toBe(false);
    expect(compararTotalEsperado("1000", 1000)).toBe(false);
  });

  it("conta solicitada, fechando e fechada bloqueiam novos itens", () => {
    const inicial = estadoInicialContaSalao("c1", "2026-08-19T00:00:00.000Z");
    expect(contaBloqueiaNovosItens(inicial)).toBe(false);
    expect(contaBloqueiaNovosItens({ ...inicial, status: "conta_solicitada" })).toBe(true);
    expect(contaBloqueiaNovosItens({ ...inicial, status: "fechando" })).toBe(true);
    expect(contaBloqueiaNovosItens({ ...inicial, status: "fechada" })).toBe(true);
  });
});
