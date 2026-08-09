// HOTFIX — "Item inválido" no checkout (Calzone/Mini-Pizza via simpleSelection).
//
// Regressão obrigatória desta suíte: tudo que o catálogo público (GET
// /api/cardapio -> menu.catalog) oferece como seleção válida precisa ser
// aceito por POST /api/pedido-app enquanto o estado comercial (esgotados)
// não mudou — ponta a ponta, através do MESMO caminho de produção:
//   getMENUDinamico -> buildSimpleCatalog -> GET /api/cardapio
//   -> resolverSimpleSelectionIds (equivalente ao frontend)
//   -> POST /api/pedido-app
//
// Cobre explicitamente cardápio persistido no Redis (não só o MENU
// estático), incluindo o formato legado anterior à Fase 6 (sem
// hasFlavors/flavorsKey/flavorsMode por item).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock, defaultSetImpl, defaultGetImpl } = vi.hoisted(() => {
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
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length === 2 && args.length === 3) {
        const [chaveResultado, chaveToken] = keys;
        const [registroJson, token] = args;
        store.set(chaveResultado, JSON.parse(registroJson));
        store.set(chaveToken, token);
        return 1;
      }
      if (keys.length === 2) {
        const [chaveToken, chaveResultado] = keys;
        const [tokenEsperado] = args;
        const tokenAtual = store.has(chaveToken) ? store.get(chaveToken) : undefined;
        const resultadoAtual = store.has(chaveResultado) ? store.get(chaveResultado) : undefined;
        if (tokenAtual === undefined && resultadoAtual === undefined) return "ja_ausente";
        if (resultadoAtual === undefined) {
          store.delete(chaveToken);
          return "ja_ausente";
        }
        if (tokenAtual === undefined) return "incerto";
        if (tokenAtual === tokenEsperado) {
          store.delete(chaveToken);
          store.delete(chaveResultado);
          return "removido";
        }
        return "substituido_por_outro";
      }
      const [chave] = keys;
      const [valorEsperado] = args;
      if (store.get(chave) === valorEsperado) {
        store.delete(chave);
        return 1;
      }
      return 0;
    }),
  };
  return { store, redisMock, defaultSetImpl, defaultGetImpl };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

import { POST } from "./route";
import { GET as GET_CARDAPIO } from "../cardapio/route";
import { resolverSimpleSelectionIds } from "@/app/cardapio/page";
import { MENU } from "@/lib/menu";
import type { SimpleCatalog } from "@/lib/catalog/simpleProducts";

function postReq(body: unknown) {
  return { json: async () => body } as never;
}

const simplePayload = {
  cliente: "Lucas Brito",
  telefone: "(99) 99999-9999",
  tipoEntrega: "retirada" as const,
  pagamento: "Dinheiro",
  troco: "Sem troco",
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redisMock.set.mockImplementation(defaultSetImpl);
  redisMock.get.mockImplementation(defaultGetImpl);
});

/** Persiste um cardápio no mock de Redis (mesma chave "cardapio" real). */
function persistirCardapio(cardapio: Record<string, unknown>) {
  store.set("cardapio", cardapio);
}

/** Simula exatamente o caminho do cliente: GET /api/cardapio -> catálogo
 *  simples -> resolverSimpleSelectionIds (mesma função usada em
 *  src/app/cardapio/page.tsx, importada aqui, não reimplementada). */
async function catalogoPublico(): Promise<SimpleCatalog> {
  const res = await GET_CARDAPIO();
  const data = await res.json();
  return data.catalog as SimpleCatalog;
}

describe("HOTFIX — Calzone/Mini-Pizza via catálogo persistido (não só MENU estático)", () => {
  it("cardápio persistido = round-trip fiel do MENU (como /configuracoes salva hoje): Calzone + Frango Catupiry => 200", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    const catalog = await catalogoPublico();
    const simpleSelection = resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: "Frango Catupiry" });
    expect(simpleSelection).toBeDefined();

    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "Produto Inventado", detail: "sabor inventado", price: 0.01, qty: 1, simpleSelection }],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    const calzone = MENU.lanches.find((l) => l.name === "Calzone")!;
    const pedidos = store.get("pedidos") as { itens: string[]; total: number }[];
    expect(pedidos[0].itens).toEqual(["Calzone Sabor: Frango Catupiry"]);
    expect(pedidos[0].total).toBe(calzone.price);
    expect(body.ok).toBe(true);
  });

  it("cardápio persistido = round-trip fiel do MENU: Mini-Pizza (R$17) + sabor permitido => 200", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    const catalog = await catalogoPublico();
    const simpleSelection = resolverSimpleSelectionIds(catalog, "Mini-Pizza", { flavorName: "Calabresa" });
    expect(simpleSelection).toBeDefined();

    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection }],
    }));
    expect(res.status).toBe(200);
    const miniPizza = MENU.lanches.find((l) => l.name === "Mini-Pizza")!;
    expect(miniPizza.price).toBe(17);
    const pedidos = store.get("pedidos") as { total: number }[];
    expect(pedidos[0].total).toBe(17);
  });

  it("Calzone com flavorsMode explicitamente 'own' (persistido) + Frango Catupiry (está em calzoneFlavors) => 200", async () => {
    const cardapio = JSON.parse(JSON.stringify(MENU));
    cardapio.lanches = cardapio.lanches.map((l: { flavorsKey?: string; flavorsMode?: string }) =>
      l.flavorsKey === "calzoneFlavors" ? { ...l, flavorsMode: "own" } : l
    );
    persistirCardapio(cardapio);
    const catalog = await catalogoPublico();
    const simpleSelection = resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: "Frango Catupiry" });
    expect(simpleSelection).toBeDefined();

    const res = await POST(postReq({ ...simplePayload, itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection }] }));
    expect(res.status).toBe(200);
  });

  it("cardápio persistido no formato LEGADO (pré-Fase 6, lanches só com name/price): cliente falha-fechado antes do POST — nunca envia seleção quebrada", async () => {
    persistirCardapio({
      lanches: [
        { name: "Calzone", price: 35 },
        { name: "Mini-Pizza", price: 17 },
      ],
    });
    const catalog = await catalogoPublico();
    const calzone = catalog.lanches.find((l) => l.name === "Calzone");
    // Sem hasFlavors/flavorsKey, a estratégia cai para "fixed" — fail-closed,
    // nunca finge ter sabores que a config atual não garante.
    expect(calzone?.strategy).toBe("fixed");
    const simpleSelection = resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: "Frango Catupiry" });
    expect(simpleSelection).toBeUndefined();
  });

  it("cardápio persistido no formato LEGADO: pedido 100% legado (name/detail, sem simpleSelection) continua funcionando — preço fixo, sabor no detail é só texto", async () => {
    persistirCardapio({
      lanches: [{ name: "Calzone", price: 35 }],
    });
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Frango Catupiry", price: 999, qty: 1 }],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as { total: number }[];
    // Preço sempre o oficial (35), nunca o 999 que o cliente mandou.
    expect(pedidos[0].total).toBe(35);
    expect(body.ok).toBe(true);
  });
});

describe("HOTFIX — servidor não mascara mais a causa real como \"Item inválido\" (motivo capturado)", () => {
  it("productId inexistente: 400 com motivo \"Produto não encontrado\"", async () => {
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection: { productId: "product-inexistente", flavorId: "flavor-x" } }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Item inválido");
    expect(body.motivo).toBe("Produto não encontrado");
  });

  it("flavorId inexistente: 400 com motivo \"Sabor não encontrado\"", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    const catalog = await catalogoPublico();
    const calzone = catalog.lanches.find((l) => l.name === "Calzone")!;
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection: { productId: calzone.id, flavorId: "flavor-inexistente" } }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.motivo).toBe("Sabor não encontrado");
  });

  it("produto realmente esgotado: 400 com motivo \"Produto indisponível: ...\"", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    store.set("esgotados", ["Calzone"]);
    const catalog = await catalogoPublico();
    const calzone = catalog.lanches.find((l) => l.name === "Calzone")!;
    expect(calzone.available).toBe(false);
    const flavor = calzone.flavors!.find((f) => f.name === "Frango Catupiry")!;
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection: { productId: calzone.id, flavorId: flavor.id } }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.motivo).toContain("indisponível");
  });

  it("sabor realmente esgotado: 400 com motivo \"Sabor indisponível: ...\"", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    store.set("esgotados", ["Frango Catupiry"]);
    const catalog = await catalogoPublico();
    const calzone = catalog.lanches.find((l) => l.name === "Calzone")!;
    const flavor = calzone.flavors!.find((f) => f.name === "Frango Catupiry")!;
    expect(flavor.available).toBe(false);
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection: { productId: calzone.id, flavorId: flavor.id } }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.motivo).toContain("Sabor indisponível");
  });

  it("seleção dupla (pizzaSelection + simpleSelection juntas): 400 com motivo explicando a rejeição", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    const catalog = await catalogoPublico();
    const calzone = catalog.lanches.find((l) => l.name === "Calzone")!;
    const flavor = calzone.flavors!.find((f) => f.name === "Calabresa")!;
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{
        kind: "pizza",
        name: "Pizza G",
        detail: "Calabresa",
        price: 50,
        qty: 1,
        pizzaSelection: { sizeId: "size-g", flavorIds: ["flavor-calabresa"] },
        simpleSelection: { productId: calzone.id, flavorId: flavor.id },
      }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.motivo).toContain("dupla");
  });

  it("item legado (name/detail) não reconhecido no cardápio atual: 400 com motivo dedicado", async () => {
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "Produto Que Nunca Existiu", price: 10, qty: 1 }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.motivo).toBe("Item legado (name/detail) não reconhecido no cardápio atual");
  });
});

describe("HOTFIX — preço sempre recalculado no servidor, nunca confia no navegador", () => {
  it("preço adulterado pelo cliente é ignorado mesmo com simpleSelection persistido válido", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    const catalog = await catalogoPublico();
    const calzone = catalog.lanches.find((l) => l.name === "Calzone")!;
    const flavor = calzone.flavors!.find((f) => f.name === "Frango Catupiry")!;
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Frango Catupiry", price: 0.01, qty: 1, simpleSelection: { productId: calzone.id, flavorId: flavor.id } }],
    }));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as { total: number }[];
    expect(pedidos[0].total).toBe(35);
  });
});
