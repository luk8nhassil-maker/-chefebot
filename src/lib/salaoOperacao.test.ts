import { describe, expect, it } from "vitest";
import { descreverStatusPedidoSalao, prioridadeStatusPedidoSalao } from "./salaoOperacao";

describe("salaoOperacao", () => {
  it("traduz o ciclo técnico para instruções claras do garçom", () => {
    expect(descreverStatusPedidoSalao("novo")).toMatchObject({
      rotulo: "Aguardando cozinha",
      orientacao: "O pedido já foi enviado. Aguarde a cozinha começar o preparo.",
    });
    expect(descreverStatusPedidoSalao("em_preparo")).toMatchObject({
      rotulo: "Em preparo",
      orientacao: "A cozinha está preparando. Acompanhe até o pedido ficar pronto.",
    });
    expect(descreverStatusPedidoSalao("saiu_entrega")).toMatchObject({
      rotulo: "Pronto para servir",
      orientacao: "Retire o pedido na cozinha e leve até a mesa.",
    });
    expect(descreverStatusPedidoSalao("entregue")).toMatchObject({
      rotulo: "Servido",
    });
    expect(descreverStatusPedidoSalao("cancelado")).toMatchObject({
      rotulo: "Pedido cancelado",
    });
  });

  it("falha de sincronização nunca finge que a cozinha está em uma etapa conhecida", () => {
    expect(descreverStatusPedidoSalao(undefined)).toMatchObject({
      rotulo: "Atualização pendente",
      orientacao: expect.stringContaining("Atualize antes de tomar uma decisão"),
    });
    expect(descreverStatusPedidoSalao("status_inventado")).toMatchObject({
      rotulo: "Atualização pendente",
    });
  });

  it("pedido pronto sobe acima dos demais estados normais", () => {
    expect(prioridadeStatusPedidoSalao("saiu_entrega")).toBeLessThan(prioridadeStatusPedidoSalao("em_preparo"));
    expect(prioridadeStatusPedidoSalao("saiu_entrega")).toBeLessThan(prioridadeStatusPedidoSalao("novo"));
  });
});
