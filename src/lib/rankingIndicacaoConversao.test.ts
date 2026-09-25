import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  },
}));

import { registrarConversaoIndicacao, obterConversaoIndicacaoDoPedido } from "./rankingIndicacaoConversao";

beforeEach(() => store.clear());

describe("registrarConversaoIndicacao / obterConversaoIndicacaoDoPedido", () => {
  test("registra e recupera a migalha pelo pedidoId", async () => {
    await registrarConversaoIndicacao({ indicadorId: "cli_a", indicadoId: "cli_b", pedidoId: "pedido-1" });
    const conversao = await obterConversaoIndicacaoDoPedido("pedido-1");
    expect(conversao).toEqual({ indicadorId: "cli_a", indicadoId: "cli_b", pedidoId: "pedido-1" });
  });

  test("pedido sem migalha retorna null", async () => {
    expect(await obterConversaoIndicacaoDoPedido("pedido-nunca-registrado")).toBeNull();
  });

  test("pedidoId vazio retorna null sem consultar o Redis", async () => {
    expect(await obterConversaoIndicacaoDoPedido("")).toBeNull();
  });
});
