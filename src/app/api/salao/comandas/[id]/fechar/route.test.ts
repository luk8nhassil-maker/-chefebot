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

import { POST } from "./route";
import { abrirComanda, marcarComandaEnviada, type Comanda } from "@/lib/comandas";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(token: string) {
  return { cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) } } as never;
}
async function abrirComandaOk(mesa: string): Promise<Comanda> {
  const r = await abrirComanda(mesa);
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/salao/comandas/[id]/fechar", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await POST({ cookies: { get: () => undefined } } as never, paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("recusa fechar uma comanda ainda aberta (sem pedido enviado)", async () => {
    const token = await criarTokenSalao();
    const comanda = await abrirComandaOk("5");
    const res = await POST(req(token), paramsFor(comanda.id));
    expect(res.status).toBe(409);
  });

  it("fecha uma comanda já enviada", async () => {
    const token = await criarTokenSalao();
    const comanda = await abrirComandaOk("5");
    await marcarComandaEnviada(comanda.id, "ped_1", 1);
    const res = await POST(req(token), paramsFor(comanda.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comanda.status).toBe("fechada");
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await POST(req(token), paramsFor("nao_existe"));
    expect(res.status).toBe(404);
  });
});
