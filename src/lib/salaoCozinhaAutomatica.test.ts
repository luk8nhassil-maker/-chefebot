import { describe, expect, it, vi } from "vitest";
import {
  cozinhaAutomaticaSalaoAtiva,
  ehPedidoSalaoParaInicioAutomatico,
  payloadInicioAutomaticoSalao,
  processarFilaImpressaoSalao,
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

  it("imprime vários pedidos em série, esperando cada cupom terminar antes do próximo", async () => {
    const eventos: string[] = [];
    let liberarPrimeiro!: () => void;

    const imprimir = vi.fn((pedidoId: string) => {
      eventos.push(`inicio:${pedidoId}`);
      if (pedidoId === "pedido-1") {
        return new Promise<void>((resolve) => {
          liberarPrimeiro = () => {
            eventos.push(`fim:${pedidoId}`);
            resolve();
          };
        });
      }
      eventos.push(`fim:${pedidoId}`);
      return Promise.resolve();
    });

    const fila = processarFilaImpressaoSalao(
      ["pedido-1", "pedido-2", "pedido-3"],
      imprimir,
    );

    await Promise.resolve();
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(["inicio:pedido-1"]);

    liberarPrimeiro();
    const resultado = await fila;

    expect(imprimir.mock.calls.map(([pedidoId]) => pedidoId)).toEqual([
      "pedido-1",
      "pedido-2",
      "pedido-3",
    ]);
    expect(eventos).toEqual([
      "inicio:pedido-1",
      "fim:pedido-1",
      "inicio:pedido-2",
      "fim:pedido-2",
      "inicio:pedido-3",
      "fim:pedido-3",
    ]);
    expect(resultado).toEqual({
      concluidos: ["pedido-1", "pedido-2", "pedido-3"],
      falhas: [],
    });
  });

  it("continua a fila quando um cupom falha e não imprime ID duplicado", async () => {
    const imprimir = vi.fn(async (pedidoId: string) => {
      if (pedidoId === "pedido-1") throw new Error("falha simulada");
    });

    const resultado = await processarFilaImpressaoSalao(
      ["pedido-1", "pedido-2", "pedido-2", "pedido-3"],
      imprimir,
    );

    expect(imprimir.mock.calls.map(([pedidoId]) => pedidoId)).toEqual([
      "pedido-1",
      "pedido-2",
      "pedido-3",
    ]);
    expect(resultado).toEqual({
      concluidos: ["pedido-2", "pedido-3"],
      falhas: ["pedido-1"],
    });
  });
});
