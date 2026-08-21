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
    get: vi.fn(defaultGetImpl), set: vi.fn(defaultSetImpl),
    del: vi.fn(async (key: string) => { const existia = store.has(key); store.delete(key); return existia ? 1 : 0; }),
    incr: vi.fn(async (key: string) => { const next = Number(store.get(key) || 0) + 1; store.set(key, next); return next; }),
    expire: vi.fn(async () => 1), eval: vi.fn(async () => 1),
  };
  return { store, redisMock, defaultSetImpl, defaultGetImpl };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

const CARDAPIO_TESTE = { sizes: [], saltyFlavors: [], sweetFlavors: [], borders: [], bebidas: [{ name: "Refrigerante 2L", price: 12 }], sucos: [], neighborhoods: [] };
const CARDAPIO_TESTE_PIZZA = { sizes: [{ code: "G", label: "Grande", price: 50 }], saltyFlavors: ["Quatro Queijos"], sweetFlavors: [], borders: [], bebidas: [{ name: "Refrigerante 2L", price: 12 }], sucos: [], neighborhoods: [] };
const SIZE_G = "size-g";
const FLAVOR_4_QUEIJOS = "flavor-4-queijos";

import { POST as enviar } from "./route";
import { POST as abrir } from "../../route";
import { PATCH as atualizarComanda } from "../../[id]/route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";
import { buscarComanda } from "@/lib/comandas";

function reqSalao(body: unknown, token: string) {
  return { json: async () => body, cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) } } as never;
}
function paramsFor(id: string) { return { params: Promise.resolve({ id }) }; }

async function abrirEComItens(token: string, mesa = "5", cliente = "Ana") {
  const aberta = await (await abrir(reqSalao({ cliente, mesa }, token))).json();
  await atualizarComanda(reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 2 }] }, token), paramsFor(aberta.comanda.id));
  return aberta.comanda.id as string;
}

beforeEach(() => {
  store.clear(); vi.clearAllMocks(); store.set("cardapio", CARDAPIO_TESTE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/salao/comandas/[id]/enviar", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await enviar({ json: async () => ({}), cookies: { get: () => undefined } } as never, paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("não exige forma de pagamento — o Salão só manda para a cozinha", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    expect((await enviar(reqSalao({}, token), paramsFor(id))).status).toBe(200);
  });

  it("recusa enviar uma comanda sem itens", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "7" }, token))).json();
    expect((await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id))).status).toBe(422);
  });

  it("recusa enviar à cozinha enquanto o nome final não foi informado", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ mesa: "7" }, token))).json();
    await atualizarComanda(reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }, token), paramsFor(aberta.comanda.id));
    const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toContain("nome do cliente");
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("cria o pedido de verdade via pedido-app e marca a comanda como enviada", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token, "5");
    const res = await enviar(reqSalao({}, token), paramsFor(id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pedidoId).toBeTruthy();
    expect(data.total).toBe(24);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].cliente).toBe("Ana");
    expect(pedidos[0].tipoEntrega).toBe("dine_in");
    expect(pedidos[0].telefone).toBeFalsy();
    expect(pedidos[0].pagamento).toBe("Comanda em aberto");
    const comanda = await buscarComanda(id);
    expect(comanda?.status).toBe("enviada");
    expect(comanda?.pedidoId).toBe(String(data.pedidoId));
  });

  it("identifica cliente, mesa e comanda na observação", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Bia", mesa: "9", complemento: "Terraço" }, token))).json();
    await atualizarComanda(reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }], observacao: "Aniversário" }, token), paramsFor(aberta.comanda.id));
    await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].cliente).toBe("Bia");
    expect(String(pedidos[0].observacao)).toContain(`Comanda #${aberta.comanda.numero}`);
    expect(String(pedidos[0].observacao)).toContain("Mesa 9 (Terraço)");
    expect(String(pedidos[0].observacao)).toContain("Aniversário");
  });

  it("comanda sem mesa usa Sem mesa e o nome do cliente", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Carlos" }, token))).json();
    await atualizarComanda(reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }, token), paramsFor(aberta.comanda.id));
    await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].cliente).toBe("Carlos");
    expect(String(pedidos[0].observacao)).toContain("Sem mesa");
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    expect((await enviar(reqSalao({}, token), paramsFor("nao_existe"))).status).toBe(404);
  });

  it("409 ao tentar enviar a mesma comanda duas vezes", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    await enviar(reqSalao({}, token), paramsFor(id));
    expect((await enviar(reqSalao({}, token), paramsFor(id))).status).toBe(409);
  });

  it("retry com mesmo clientRequestId não cria segundo pedido", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    const res1 = await enviar(reqSalao({ clientRequestId: "a".repeat(20) }, token), paramsFor(id));
    const data1 = await res1.json();
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(data1.pedidoId).toBeTruthy();
  });

  it("preço final vem do servidor, nunca do valor adulterado", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
    await atualizarComanda(reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1, price: 999 }] }, token), paramsFor(aberta.comanda.id));
    const data = await (await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id))).json();
    expect(data.total).toBe(12);
  });

  describe("pizzaSelection (Fase 5)", () => {
    it("preserva IDs e reprecifica pelo motor nativo", async () => {
      store.set("cardapio", CARDAPIO_TESTE_PIZZA);
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
      await atualizarComanda(reqSalao({ itens: [{ kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_4_QUEIJOS] } }] }, token), paramsFor(aberta.comanda.id));
      const data = await (await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id))).json();
      expect(data.total).toBe(50);
      const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos[0].itens).toEqual(["Pizza G 4 Queijos"]);
    });

    it("sizeId corrompido é recusado e nenhum pedido é criado", async () => {
      store.set("cardapio", CARDAPIO_TESTE_PIZZA);
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
      const { atualizarItensComanda } = await import("@/lib/comandas");
      await atualizarItensComanda(aberta.comanda.id, [{ kind: "pizza", name: "Pizza G", detail: "Quatro Queijos", price: 50, qty: 1, pizzaSelection: { sizeId: "size-inexistente", flavorIds: [FLAVOR_4_QUEIJOS] } }]);
      const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(store.get("pedidos")).toBeUndefined();
    });

    it("continua sem Pix/WhatsApp real", async () => {
      store.set("cardapio", CARDAPIO_TESTE_PIZZA);
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
      await atualizarComanda(reqSalao({ itens: [{ kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_4_QUEIJOS] } }] }, token), paramsFor(aberta.comanda.id));
      await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
      const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos[0].pagamento).toBe("Comanda em aberto");
      expect(pedidos[0].pix).toBeUndefined();
      expect(pedidos[0].telefone).toBeFalsy();
    });
  });
});
