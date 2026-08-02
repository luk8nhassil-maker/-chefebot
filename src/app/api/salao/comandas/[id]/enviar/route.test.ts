import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const defaultSetImpl = async (key: string, value: unknown, opts?: { nx?: boolean }) => {
    if (opts?.nx && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  };
  const defaultGetImpl = async (key: string) => store.get(key) ?? null;
  const redisMock = {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(async (key: string) => {
      const existia = store.has(key);
      store.delete(key);
      return existia ? 1 : 0;
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
  };
  return { store, redisMock, defaultSetImpl, defaultGetImpl };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

const CARDAPIO_TESTE = {
  sizes: [], saltyFlavors: [], sweetFlavors: [], borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [], neighborhoods: [],
};

import { POST as enviar } from "./route";
import { POST as abrir } from "../../route";
import { PATCH as atualizarComanda } from "../../[id]/route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";
import { buscarComanda } from "@/lib/comandas";

function reqSalao(body: unknown, token: string) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}
function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function abrirEComItens(token: string, mesa = "5") {
  const aberta = await (await abrir(reqSalao({ mesa }, token))).json();
  await atualizarComanda(
    reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 2 }] }, token),
    paramsFor(aberta.comanda.id)
  );
  return aberta.comanda.id as string;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/salao/comandas/[id]/enviar", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await enviar(
      { json: async () => ({ pagamento: "Dinheiro", troco: "Sem troco" }), cookies: { get: () => undefined } } as never,
      paramsFor("x")
    );
    expect(res.status).toBe(401);
  });

  it("exige forma de pagamento", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    const res = await enviar(reqSalao({}, token), paramsFor(id));
    expect(res.status).toBe(400);
  });

  it("recusa enviar uma comanda sem itens", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ mesa: "7" }, token))).json();
    const res = await enviar(reqSalao({ pagamento: "Dinheiro", troco: "Sem troco" }, token), paramsFor(aberta.comanda.id));
    expect(res.status).toBe(400);
  });

  it("cria o pedido de verdade via /api/pedido-app (mesmo motor, sem telefone) e marca a comanda como enviada", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token, "5");
    const res = await enviar(reqSalao({ pagamento: "Dinheiro", troco: "Sem troco" }, token), paramsFor(id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pedidoId).toBeTruthy();
    expect(data.total).toBe(24);

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].cliente).toBe("Mesa 5");
    expect(pedidos[0].tipoEntrega).toBe("dine_in");
    expect(pedidos[0].telefone).toBeFalsy();

    const comanda = await buscarComanda(id);
    expect(comanda?.status).toBe("enviada");
    expect(comanda?.pedidoId).toBe(String(data.pedidoId));
  });

  it("identifica a mesa e a comanda no cliente/observação do pedido", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ mesa: "9", complemento: "Terraço" }, token))).json();
    await atualizarComanda(
      reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }], observacao: "Aniversário" }, token),
      paramsFor(aberta.comanda.id)
    );
    await enviar(reqSalao({ pagamento: "Dinheiro", troco: "Sem troco" }, token), paramsFor(aberta.comanda.id));

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].cliente).toBe("Mesa 9 (Terraço)");
    expect(String(pedidos[0].observacao)).toContain(`Comanda #${aberta.comanda.numero}`);
    expect(String(pedidos[0].observacao)).toContain("Aniversário");
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await enviar(reqSalao({ pagamento: "Dinheiro", troco: "Sem troco" }, token), paramsFor("nao_existe"));
    expect(res.status).toBe(404);
  });

  it("409 ao tentar enviar a mesma comanda duas vezes", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    await enviar(reqSalao({ pagamento: "Dinheiro", troco: "Sem troco" }, token), paramsFor(id));
    const res2 = await enviar(reqSalao({ pagamento: "Dinheiro", troco: "Sem troco" }, token), paramsFor(id));
    expect(res2.status).toBe(409);
  });

  it("o preço final vem sempre do recálculo do servidor (via pedido-app), nunca de um valor adulterado", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ mesa: "5" }, token))).json();
    // PATCH já recalcula, mas simula um cenário em que o item chega com
    // price adulterado até a rota de enviar (defesa em profundidade).
    await atualizarComanda(
      reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1, price: 999 }] }, token),
      paramsFor(aberta.comanda.id)
    );
    const res = await enviar(reqSalao({ pagamento: "Dinheiro", troco: "Sem troco" }, token), paramsFor(aberta.comanda.id));
    const data = await res.json();
    expect(data.total).toBe(12);
  });
});
