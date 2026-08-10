// HOTFIX — "Item inválido" no checkout (Calzone via simpleSelection).
//
// Regressão obrigatória desta suíte: tudo que o catálogo público (GET
// /api/cardapio -> menu.catalog) oferece como seleção válida precisa ser
// aceito por POST /api/pedido-app enquanto o estado comercial (esgotados)
// não mudou — ponta a ponta, através do MESMO caminho de produção:
//   getMENUDinamico -> buildSimpleCatalog -> GET /api/cardapio
//   -> resolverSimpleSelectionIds (equivalente ao frontend)
//   -> POST /api/pedido-app
//
// Cardápio oficial 2026: produto/sabor/preço do Calzone vêm de
// @/lib/catalog/officialMenu2026 (CALZONE_FLAVORS), NUNCA mais de
// menu.lanches/Redis — persistir um cardápio customizado no Redis não muda
// mais o Calzone (só afeta os campos legados usados por officialUnitPrice/
// itens 100% legados, cobertos à parte abaixo). "Mini-Pizza" como produto
// simples não existe mais (virou tamanho de pizza — decisão comercial
// aprovada).
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

describe("HOTFIX — Calzone via catálogo oficial 2026 (GET /api/cardapio -> menu.catalog)", () => {
  it("fluxo real do cliente (sem cardápio customizado no Redis): Calzone + Calabresa => 200, preço vem do sabor", async () => {
    const catalog = await catalogoPublico();
    const simpleSelection = resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: "Calabresa" });
    expect(simpleSelection).toBeDefined();

    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "Produto Inventado", detail: "sabor inventado", price: 0.01, qty: 1, simpleSelection }],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as { itens: string[]; total: number }[];
    expect(pedidos[0].itens).toEqual(["Calzone Sabor: Calabresa"]);
    expect(pedidos[0].total).toBe(30); // cardápio oficial 2026 — Calzone Calabresa = R$30
    expect(body.ok).toBe(true);
  });

  it("REGRESSÃO — cardápio customizado persistido no Redis NUNCA muda produto/sabor/preço do Calzone (fonte é sempre @/lib/catalog/officialMenu2026, nunca menu.lanches/Redis)", async () => {
    // Cenário que antes desta arquitetura teria mudado o Calzone (round-trip
    // do Menu legado persistido pela tela /configuracoes) — agora é
    // irrelevante para o catálogo oficial: mesmo produto, mesmo sabor, mesmo
    // preço, apesar do Redis ter um cardápio completamente diferente salvo.
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    const catalog = await catalogoPublico();
    const simpleSelection = resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: "Calabresa" });
    expect(simpleSelection).toBeDefined();

    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection }],
    }));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as { total: number }[];
    expect(pedidos[0].total).toBe(30);
  });

  it("'Mini-Pizza' não existe mais como produto simples (virou tamanho de pizza): nunca resolve, mesmo com um cardápio legado persistido", async () => {
    persistirCardapio(JSON.parse(JSON.stringify(MENU)));
    const catalog = await catalogoPublico();
    expect(resolverSimpleSelectionIds(catalog, "Mini-Pizza", { flavorName: "Calabresa" })).toBeUndefined();
  });

  it("cardápio persistido no formato LEGADO (pré-cardápio oficial 2026, lanches só com name/price): pedido 100% legado (name/detail, sem simpleSelection) continua funcionando — preço fixo do Menu legado, sabor no detail é só texto", async () => {
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
    // Item legado (sem simpleSelection) continua precificado pelo caminho
    // officialUnitPrice/Menu legado, intacto por design (pedidos antigos
    // nunca recalculam com o preço novo) — preço sempre o persistido (35),
    // nunca o 999 que o cliente mandou.
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
    const catalog = await catalogoPublico();
    const calzone = catalog.calzone.find((l) => l.name === "Calzone")!;
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection: { productId: calzone.id, flavorId: "flavor-inexistente" } }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.motivo).toBe("Sabor não encontrado");
  });

  it("produto realmente esgotado: 400 com motivo \"Produto indisponível: ...\"", async () => {
    store.set("esgotados", ["Calzone"]);
    const catalog = await catalogoPublico();
    const calzone = catalog.calzone.find((l) => l.name === "Calzone")!;
    expect(calzone.available).toBe(false);
    const flavor = calzone.flavors!.find((f) => f.name === "Calabresa")!;
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection: { productId: calzone.id, flavorId: flavor.id } }],
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.motivo).toContain("indisponível");
  });

  it("sabor realmente esgotado: 400 com motivo \"Sabor indisponível: ...\"", async () => {
    store.set("esgotados", ["Calabresa"]);
    const catalog = await catalogoPublico();
    const calzone = catalog.calzone.find((l) => l.name === "Calzone")!;
    const flavor = calzone.flavors!.find((f) => f.name === "Calabresa")!;
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
    const catalog = await catalogoPublico();
    const calzone = catalog.calzone.find((l) => l.name === "Calzone")!;
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
  it("preço adulterado pelo cliente é ignorado mesmo com simpleSelection válido", async () => {
    const catalog = await catalogoPublico();
    const calzone = catalog.calzone.find((l) => l.name === "Calzone")!;
    const flavor = calzone.flavors!.find((f) => f.name === "Calabresa")!;
    const res = await POST(postReq({
      ...simplePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 0.01, qty: 1, simpleSelection: { productId: calzone.id, flavorId: flavor.id } }],
    }));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as { total: number }[];
    expect(pedidos[0].total).toBe(30); // cardápio oficial 2026 — Calzone Calabresa = R$30
  });
});
