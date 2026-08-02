import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { PATCH } from "./route";
import { POST as abrir } from "../route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";
import { marcarComandaEnviada } from "@/lib/comandas";

const CARDAPIO_TESTE = {
  sizes: [], saltyFlavors: [], sweetFlavors: [], borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [], neighborhoods: [],
};

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown, token: string) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}
function abrirReq(body: unknown, token: string) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
});

describe("PATCH /api/salao/comandas/[id]", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await PATCH({ json: async () => ({ itens: [] }), cookies: { get: () => undefined } } as never, paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("adiciona itens a uma comanda aberta, recalculando o preço no servidor", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(abrirReq({ cliente: "Ana", mesa: "5" }, token))).json();
    const res = await PATCH(
      patchReq({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 3, price: 0.01 }] }, token),
      paramsFor(aberta.comanda.id)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comanda.itens[0].price).toBe(12);
    expect(data.total).toBe(36);
  });

  it("devolve 404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await PATCH(patchReq({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }, token), paramsFor("nao_existe"));
    expect(res.status).toBe(404);
  });

  it("devolve 409 para comanda que já não está mais aberta", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(abrirReq({ cliente: "Ana", mesa: "5" }, token))).json();
    await marcarComandaEnviada(aberta.comanda.id, "ped_1", 1);
    const res = await PATCH(
      patchReq({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }, token),
      paramsFor(aberta.comanda.id)
    );
    expect(res.status).toBe(409);
  });

  it("400 quando um item não está no cardápio", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(abrirReq({ cliente: "Ana", mesa: "5" }, token))).json();
    const res = await PATCH(
      patchReq({ itens: [{ kind: "simple", name: "Produto Fantasma", qty: 1 }] }, token),
      paramsFor(aberta.comanda.id)
    );
    expect(res.status).toBe(400);
  });
});
