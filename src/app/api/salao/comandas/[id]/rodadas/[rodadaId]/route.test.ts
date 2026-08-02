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

const CARDAPIO_TESTE = {
  sizes: [], saltyFlavors: [], sweetFlavors: [], borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [], neighborhoods: [],
};

import { PATCH } from "./route";
import { POST as criarRodadaRoute } from "../route";
import { abrirComanda, fecharComanda, marcarComandaEnviada, type Comanda } from "@/lib/comandas";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function paramsFor(id: string, rodadaId: string) {
  return { params: Promise.resolve({ id, rodadaId }) };
}
function req(token: string, body: unknown) {
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
async function comandaComRodada2(token: string) {
  const c = await abrirComandaOk("5");
  await marcarComandaEnviada(c.id, "ped_1", 1);
  const res = await criarRodadaRoute(req(token, {}), { params: Promise.resolve({ id: c.id }) });
  const data = await res.json();
  return { comandaId: c.id, rodadaId: data.rodada.id as string, rodada1Id: data.comanda.rodadas[0].id as string };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
});

describe("PATCH /api/salao/comandas/[id]/rodadas/[rodadaId]", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await PATCH(reqSemSessao(), paramsFor("x", "y"));
    expect(res.status).toBe(401);
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await PATCH(req(token, { itens: [] }), paramsFor("nao_existe", "y"));
    expect(res.status).toBe(404);
  });

  it("404 para rodada inexistente", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    const res = await PATCH(req(token, { itens: [] }), paramsFor(c.id, "rodada_x"));
    expect(res.status).toBe(404);
  });

  it("adiciona um item à Rodada 2", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2(token);
    const res = await PATCH(req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 2 }] }), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rodada.itens).toHaveLength(1);
    expect(data.rodada.subtotal).toBe(24);
    expect(data.totalParcial).toBe(24);
  });

  it("preço sempre recalculado no servidor — ignora o preço vindo do payload", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2(token);
    const res = await PATCH(req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1, price: 0.01 }] }), paramsFor(comandaId, rodadaId));
    const data = await res.json();
    expect(data.rodada.itens[0].price).toBe(12);
  });

  it("altera quantidade substituindo a lista completa", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2(token);
    await PATCH(req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }), paramsFor(comandaId, rodadaId));
    const res = await PATCH(req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 4 }] }), paramsFor(comandaId, rodadaId));
    const data = await res.json();
    expect(data.rodada.subtotal).toBe(48);
  });

  it("remove item — lista vazia é aceita para uma rodada em rascunho", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2(token);
    await PATCH(req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }), paramsFor(comandaId, rodadaId));
    const res = await PATCH(req(token, { itens: [] }), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rodada.itens).toEqual([]);
  });

  it("salva observação", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2(token);
    const res = await PATCH(req(token, { itens: [], observacao: "Sem gelo" }), paramsFor(comandaId, rodadaId));
    const data = await res.json();
    expect(data.rodada.observacao).toBe("Sem gelo");
  });

  it("recusa editar a Rodada 1 já enviada (imutável)", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodada1Id } = await comandaComRodada2(token);
    const res = await PATCH(req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }), paramsFor(comandaId, rodada1Id));
    expect(res.status).toBe(409);
  });

  it("recusa comanda fechada", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2(token);
    await fecharComanda(comandaId);
    const res = await PATCH(req(token, { itens: [] }), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(409);
  });

  it("falha do Redis devolve erro seguro (503)", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2(token);
    redisMock.set.mockImplementationOnce(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await PATCH(req(token, { itens: [] }), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(503);
  });
});
