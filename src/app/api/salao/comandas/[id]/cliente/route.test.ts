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
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { PATCH } from "./route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function req(body: unknown, token?: string) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (token && n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}
function paramsFor(id: string) { return { params: Promise.resolve({ id }) }; }

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

describe("PATCH /api/salao/comandas/[id]/cliente", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await PATCH(req({ cliente: "Ana" }), paramsFor("c1"));
    expect(res.status).toBe(401);
  });

  it("grava só o nome e preserva itens, rodadas, mesa e status", async () => {
    const token = await criarTokenSalao();
    const original = {
      id: "c1", numero: 1, mesa: "5", complemento: "Varanda",
      itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "aberta", abertaEm: "2026-08-21T10:00:00.000Z",
      rodadas: [{ id: "r1", numero: 1, status: "rascunho", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "2026-08-21T10:00:00.000Z", atualizadaEm: "2026-08-21T10:00:00.000Z" }],
    };
    store.set("salao:comandas", [original]);

    const res = await PATCH(req({ cliente: "  Ana  " }, token), paramsFor("c1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comanda.cliente).toBe("Ana");
    expect(data.comanda.itens).toEqual(original.itens);
    expect(data.comanda.rodadas).toEqual(original.rodadas);
    expect(data.comanda.mesa).toBe("5");
    expect(data.comanda.status).toBe("aberta");
  });

  it("recusa nome vazio", async () => {
    const token = await criarTokenSalao();
    const res = await PATCH(req({ cliente: "   " }, token), paramsFor("c1"));
    expect(res.status).toBe(400);
  });

  it("recusa alterar comanda fechada", async () => {
    const token = await criarTokenSalao();
    store.set("salao:comandas", [{ id: "c1", numero: 1, itens: [], status: "fechada", abertaEm: "2026-08-21T10:00:00.000Z" }]);
    const res = await PATCH(req({ cliente: "Ana" }, token), paramsFor("c1"));
    expect(res.status).toBe(409);
  });
});
