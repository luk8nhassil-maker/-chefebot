import { describe, expect, it } from "vitest";
import {
  cozinhaAutomaticaSalaoAtiva,
  ehPedidoSalaoParaInicioAutomatico,
  payloadInicioAutomaticoSalao,
  urlImpressaoAutomaticaSalao,
} from "./salaoCozinhaAutomatica";

describe("Salão — entrada automática na cozinha", () => {
  it("aceita automaticamente somente pedido novo de comanda em consumo no local", () => {
    expect(ehPedidoSalaoParaInicioAutomatico({
      id: "pedido-1",
      status: "novo",
      tipoEntrega: "dine_in",
      endereco: "Consumo no local",
      pagamento: "Comanda em aberto",
    })).toBe(true);
  });

  it("mantém compatibilidade com pedido antigo que identifica consumo no local pelo endereço", () => {
    expect(ehPedidoSalaoParaInicioAutomatico({
      id: "pedido-2",
      status: "novo",
      endereco: "Consumo no local",
      pagamento: "Comanda em aberto",
    })).toBe(true);
  });

  it("não toca Delivery, retirada nem pedido dine-in com pagamento real", () => {
    expect(ehPedidoSalaoParaInicioAutomatico({
      id: "delivery",
      status: "novo",
      tipoEntrega: "delivery",
      pagamento: "Comanda em aberto",
    })).toBe(false);
    expect(ehPedidoSalaoParaInicioAutomatico({
      id: "retirada",
      status: "novo",
      tipoEntrega: "retirada",
      pagamento: "Comanda em aberto",
    })).toBe(false);
    expect(ehPedidoSalaoParaInicioAutomatico({
      id: "manual-local",
      status: "novo",
      tipoEntrega: "dine_in",
      pagamento: "Pix",
    })).toBe(false);
  });

  it("não tenta reaceitar pedido do Salão que já saiu de novo", () => {
    expect(ehPedidoSalaoParaInicioAutomatico({
      id: "pedido-3",
      status: "em_preparo",
      tipoEntrega: "dine_in",
      pagamento: "Comanda em aberto",
    })).toBe(false);
  });

  it("é opt-in exclusivo de Production para proteger Preview e desenvolvimento", () => {
    expect(cozinhaAutomaticaSalaoAtiva("production")).toBe(true);
    expect(cozinhaAutomaticaSalaoAtiva("preview")).toBe(false);
    expect(cozinhaAutomaticaSalaoAtiva("development")).toBe(false);
    expect(cozinhaAutomaticaSalaoAtiva(undefined)).toBe(false);
  });

  it("reutiliza a transição oficial silenciosa e o cupom automático embutido", () => {
    expect(payloadInicioAutomaticoSalao("pedido-4")).toEqual({
      id: "pedido-4",
      status: "em_preparo",
      silent: true,
    });
    expect(urlImpressaoAutomaticaSalao("pedido-4")).toBe(
      "/pedidos/pedido-4/imprimir?auto=1&embedded=1",
    );
  });
});
