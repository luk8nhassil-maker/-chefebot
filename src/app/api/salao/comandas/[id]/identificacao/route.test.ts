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
import { abrirComanda, marcarComandaEnviada, type Comanda } from "@/lib/comandas";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(token: string, body: unknown) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}
async function abrirAnonima(): Promise<Comanda> {
  const r = await abrirComanda({});
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("PATCH /api/salao/comandas/[id]/identificacao", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await PATCH(
      { json: async () => ({}), cookies: { get: () => undefined } } as never,
      paramsFor("x")
    );
    expect(res.status).toBe(401);
  });

  it("identifica uma comanda aberta direto no catálogo (sem cliente/mesa ainda)", async () => {
    const token = await criarTokenSalao();
    const comanda = await abrirAnonima();
    const res = await PATCH(req(token, { cliente: "João", mesa: "4" }), paramsFor(comanda.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comanda.cliente).toBe("João");
    expect(data.comanda.mesa).toBe("4");
  });

  it("409 para mesa já ocupada", async () => {
    const token = await criarTokenSalao();
    await abrirComanda({ cliente: "Ana", mesa: "10" });
    const outra = await abrirAnonima();
    const res = await PATCH(req(token, { cliente: "Bia", mesa: "10" }), paramsFor(outra.id));
    expect(res.status).toBe(409);
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await PATCH(req(token, { cliente: "Ana" }), paramsFor("nao_existe"));
    expect(res.status).toBe(404);
  });

  it("409 quando a comanda já foi enviada", async () => {
    const token = await criarTokenSalao();
    const comanda = await abrirAnonima();
    await marcarComandaEnviada(comanda.id, "ped_1", 1);
    const res = await PATCH(req(token, { cliente: "Ana" }), paramsFor(comanda.id));
    expect(res.status).toBe(409);
  });
});
