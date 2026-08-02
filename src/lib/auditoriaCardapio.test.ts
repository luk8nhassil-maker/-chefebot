import { vi, describe, it, expect, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    lpush: vi.fn(async (key: string, value: unknown) => {
      const lista = (store.get(key) as unknown[]) ?? [];
      lista.unshift(value);
      store.set(key, lista);
      return lista.length;
    }),
    ltrim: vi.fn(async (key: string, start: number, end: number) => {
      const lista = (store.get(key) as unknown[]) ?? [];
      store.set(key, lista.slice(start, end + 1));
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { registrarAuditoriaCardapio } from "./auditoriaCardapio";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("registrarAuditoriaCardapio", () => {
  it("grava data, admin, ação e contagem de itens antes/depois por seção", async () => {
    await registrarAuditoriaCardapio(
      "brito",
      { bebidas: [{ name: "Agua", price: 3 }] },
      { bebidas: [{ name: "Agua", price: 3 }, { name: "Suco", price: 5 }] }
    );
    expect(redisMock.lpush).toHaveBeenCalledTimes(1);
    const [, entradaSerializada] = redisMock.lpush.mock.calls[0];
    const entrada = JSON.parse(entradaSerializada as string);
    expect(entrada.admin).toBe("brito");
    expect(entrada.acao).toBe("atualizacao_cardapio");
    expect(typeof entrada.data).toBe("string");
    const secaoBebidas = entrada.secoes.find((s: { secao: string }) => s.secao === "bebidas");
    expect(secaoBebidas.itensAntes).toBe(1);
    expect(secaoBebidas.itensDepois).toBe(2);
  });

  it("nunca inclui token, cookie ou dado de sessão na entrada", async () => {
    await registrarAuditoriaCardapio("brito", null, { bebidas: [] });
    const [, entradaSerializada] = redisMock.lpush.mock.calls[0];
    const texto = entradaSerializada as string;
    expect(texto.toLowerCase()).not.toContain("token");
    expect(texto.toLowerCase()).not.toContain("cookie");
    expect(texto.toLowerCase()).not.toContain("session");
  });

  it("limita o histórico ao máximo configurado via ltrim", async () => {
    await registrarAuditoriaCardapio("brito", null, { bebidas: [] });
    expect(redisMock.ltrim).toHaveBeenCalledWith("cardapioAuditoria", 0, 499);
  });

  it("cardápio anterior nulo (primeira gravação) não lança e trata como 0 itens antes", async () => {
    await expect(
      registrarAuditoriaCardapio("brito", null, { bebidas: [{ name: "Agua", price: 3 }] })
    ).resolves.toBeUndefined();
    const [, entradaSerializada] = redisMock.lpush.mock.calls[0];
    const entrada = JSON.parse(entradaSerializada as string);
    expect(entrada.secoes.find((s: { secao: string }) => s.secao === "bebidas").itensAntes).toBe(0);
  });

  it("falha do Redis não lança (auditoria é best-effort)", async () => {
    redisMock.lpush.mockRejectedValueOnce(new Error("indisponível"));
    await expect(registrarAuditoriaCardapio("brito", null, { bebidas: [] })).resolves.toBeUndefined();
  });
});
