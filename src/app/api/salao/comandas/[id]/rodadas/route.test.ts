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
import { abrirComanda, fecharComanda, marcarComandaEnviada, type Comanda } from "@/lib/comandas";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(token: string, body: unknown = {}) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}
function reqSemSessao(body: unknown = {}) {
  return { json: async () => body, cookies: { get: () => undefined } } as never;
}
async function abrirComandaOk(mesa: string): Promise<Comanda> {
  const r = await abrirComanda({ cliente: "Cliente Teste", mesa });
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/salao/comandas/[id]/rodadas", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await POST(reqSemSessao(), paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await POST(req(token), paramsFor("nao_existe"));
    expect(res.status).toBe(404);
  });

  it("409 para comanda fechada", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    await fecharComanda(c.id);
    const res = await POST(req(token), paramsFor(c.id));
    expect(res.status).toBe(409);
  });

  it("cria a Rodada 2 depois da Rodada 1 enviada, sem criar pedido nem imprimir", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);

    const res = await POST(req(token), paramsFor(c.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.criada).toBe(true);
    expect(data.rodada.numero).toBe(2);
    expect(data.rodada.status).toBe("rascunho");
    expect(data.comanda.rodadas).toHaveLength(2);

    const chamadasImpressao = redisMock.set.mock.calls.filter(([chave]: [string, ...unknown[]]) =>
      typeof chave === "string" && chave.startsWith("pedido:auto-print-claim:")
    );
    expect(chamadasImpressao).toHaveLength(0);
  });

  it("idempotente por clientRequestId: mesma chamada duas vezes devolve a mesma rodada", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);

    const r1 = await POST(req(token, { clientRequestId: "req-1" }), paramsFor(c.id));
    const r2 = await POST(req(token, { clientRequestId: "req-1" }), paramsFor(c.id));
    const d1 = await r1.json();
    const d2 = await r2.json();
    expect(d1.rodada.id).toBe(d2.rodada.id);
    expect(d1.criada).toBe(true);
    expect(d2.criada).toBe(false);
  });

  it("duas requisições concorrentes (duplo clique / duas abas) — só uma Rodada 2 nova", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);

    const [r1, r2] = await Promise.all([POST(req(token), paramsFor(c.id)), POST(req(token), paramsFor(c.id))]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    expect([d1.criada, d2.criada].filter(Boolean)).toHaveLength(1);
    expect(d1.rodada.id).toBe(d2.rodada.id);
  });

  it("falha do Redis devolve erro seguro (503), nunca lança sem resposta", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    redisMock.set.mockImplementationOnce(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await POST(req(token), paramsFor(c.id));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});
