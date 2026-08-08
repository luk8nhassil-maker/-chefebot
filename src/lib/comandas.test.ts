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
  sizes: [{ code: "P", label: "Pequena", price: 30 }, { code: "G", label: "Grande", price: 50 }],
  saltyFlavors: ["Quatro Queijos"],
  sweetFlavors: [],
  borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [],
  neighborhoods: [],
};

import {
  abrirComanda,
  atualizarItensComanda,
  atualizarItensRodada,
  buscarComanda,
  comRodadasNormalizadas,
  criarRodadaEmRascunho,
  fecharComanda,
  listarComandas,
  marcarComandaEnviada,
  totalParcialComanda,
  validarItensComanda,
  type Comanda,
} from "./comandas";

async function abrirComandaOk(mesa: string, complemento?: string): Promise<Comanda> {
  const r = await abrirComanda({ cliente: "Cliente Teste", mesa, complemento });
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
});

describe("abrirComanda", () => {
  it("cria uma comanda aberta, sem itens, com número sequencial", async () => {
    const c1 = await abrirComanda({ cliente: "Ana", mesa: "5" });
    const c2 = await abrirComanda({ cliente: "Bia", mesa: "6", complemento: "Terraço" });
    if (typeof c1 !== "object" || typeof c2 !== "object") throw new Error("esperava Comanda");
    expect(c1.status).toBe("aberta");
    expect(c1.cliente).toBe("Ana");
    expect(c1.itens).toEqual([]);
    expect(c1.numero).toBe(1);
    expect(c2.numero).toBe(2);
    expect(c2.complemento).toBe("Terraço");
  });

  it("aparece na listagem", async () => {
    await abrirComanda({ cliente: "Ana", mesa: "5" });
    expect(await listarComandas()).toHaveLength(1);
  });

  it("recusa abrir uma segunda comanda para a mesma mesa ainda não fechada", async () => {
    const c1 = await abrirComanda({ cliente: "Ana", mesa: "7" });
    if (typeof c1 !== "object") throw new Error("esperava Comanda");
    const r2 = await abrirComanda({ cliente: "Bia", mesa: "7" });
    expect(r2).toBe("mesa_ocupada");
    expect(await listarComandas()).toHaveLength(1);
  });

  it("permite reabrir a mesma mesa depois que a comanda anterior foi fechada", async () => {
    const c1 = await abrirComanda({ cliente: "Ana", mesa: "7" });
    if (typeof c1 !== "object") throw new Error("esperava Comanda");
    await marcarComandaEnviada(c1.id, "ped_1", 1);
    await fecharComanda(c1.id);
    const r2 = await abrirComanda({ cliente: "Bia", mesa: "7" });
    expect(typeof r2).toBe("object");
    expect(await listarComandas()).toHaveLength(2);
  });

  it("duas aberturas concorrentes da mesma mesa — só uma vira comanda, a outra é recusada", async () => {
    const [a, b] = await Promise.all([
      abrirComanda({ cliente: "Ana", mesa: "9" }),
      abrirComanda({ cliente: "Bia", mesa: "9" }),
    ]);
    const resultados = [a, b];
    expect(resultados.filter((r) => typeof r === "object")).toHaveLength(1);
    expect(resultados.filter((r) => r === "mesa_ocupada")).toHaveLength(1);
    expect(await listarComandas()).toHaveLength(1);
  });

  it("cliente obrigatório, mesa opcional — cria uma comanda 'Sem mesa'", async () => {
    const c = await abrirComanda({ cliente: "Ana" });
    if (typeof c !== "object") throw new Error("esperava Comanda");
    expect(c.cliente).toBe("Ana");
    expect(c.mesa).toBeUndefined();
  });

  it("duas comandas 'Sem mesa' nunca colidem entre si", async () => {
    const c1 = await abrirComanda({ cliente: "Ana" });
    const c2 = await abrirComanda({ cliente: "Bia" });
    expect(typeof c1).toBe("object");
    expect(typeof c2).toBe("object");
    expect(await listarComandas()).toHaveLength(2);
  });
});

describe("validarItensComanda", () => {
  it("recusa lista vazia", async () => {
    const r = await validarItensComanda([]);
    expect(r.ok).toBe(false);
  });

  it("recusa item fora do cardápio", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Produto Fantasma", qty: 1 }]);
    expect(r.ok).toBe(false);
  });

  it("recusa item promocional", async () => {
    const r = await validarItensComanda([{ kind: "promo", name: "Refrigerante 2L", qty: 1, promoId: "x" }]);
    expect(r.ok).toBe(false);
  });

  it("recusa preço vindo do cliente — sempre recalcula pelo cardápio oficial", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 2, price: 0.01 }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.itens[0].price).toBe(12);
      expect(r.total).toBe(24);
    }
  });

  it("recusa quantidade inválida", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 0 }]);
    expect(r.ok).toBe(false);
  });
});

// ===========================================================================
// Fase 5 — pizza do Salão usa os mesmos IDs oficiais (sizeId/flavorIds/
// borderId) e o mesmo motor nativo do cardápio público/pedido manual
// (Fase 2/4). IDs abaixo são determinísticos (slugify do nome/código já
// existente no cardápio — ver src/lib/catalog/ids.ts), nunca inventados.
// ===========================================================================

const CARDAPIO_TESTE_PIZZA = {
  sizes: [{ code: "P", label: "Pequena", price: 30 }, { code: "G", label: "Grande", price: 50 }],
  saltyFlavors: ["Quatro Queijos", "Frango com Requeijão"],
  sweetFlavors: ["Chocolate"],
  borders: [{ label: "Requeijão", priceSmall: 5, priceLarge: 8 }],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [],
  neighborhoods: [],
};

const SIZE_G = "size-g";
const SIZE_P = "size-p";
const FLAVOR_QUATRO_QUEIJOS = "flavor-quatro-queijos";
const FLAVOR_CHOCOLATE = "flavor-chocolate";
const BORDER_REQUEIJAO = "border-requeijao";

describe("validarItensComanda — pizzaSelection (Fase 5)", () => {
  beforeEach(() => {
    store.set("cardapio", CARDAPIO_TESTE_PIZZA);
  });

  it("pizza de 1 sabor sem borda: resolve pelo catálogo oficial e preserva pizzaSelection", async () => {
    const r = await validarItensComanda([
      { kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS] } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].name).toBe("Pizza G");
    expect(r.itens[0].detail).toBe("Quatro Queijos");
    expect(r.itens[0].price).toBe(50);
    expect(r.itens[0].pizzaSelection).toEqual({ sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS] });
    expect(r.total).toBe(50);
  });

  it("meio a meio com borda: preserva os dois flavorIds e o borderId", async () => {
    const r = await validarItensComanda([
      {
        kind: "pizza",
        price: 0,
        qty: 1,
        pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_CHOCOLATE, FLAVOR_QUATRO_QUEIJOS], borderId: BORDER_REQUEIJAO },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].name).toBe("Pizza G (meio a meio)");
    expect(r.itens[0].detail).toBe("Chocolate / Quatro Queijos · borda Requeijão");
    expect(r.itens[0].price).toBe(58); // 50 + borda grande 8
    expect(r.itens[0].pizzaSelection).toEqual({
      sizeId: SIZE_G,
      flavorIds: [FLAVOR_CHOCOLATE, FLAVOR_QUATRO_QUEIJOS],
      borderId: BORDER_REQUEIJAO,
    });
  });

  it("quantidade multiplica o total corretamente com pizzaSelection presente", async () => {
    const r = await validarItensComanda([
      { kind: "pizza", price: 0, qty: 3, pizzaSelection: { sizeId: SIZE_P, flavorIds: [FLAVOR_QUATRO_QUEIJOS] } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].qty).toBe(3);
    expect(r.total).toBe(90); // Pizza P (30) x 3
  });

  it("preço, name e detail adulterados são ignorados quando pizzaSelection é válido — reconstrói do catálogo", async () => {
    const r = await validarItensComanda([
      {
        kind: "pizza",
        name: "Pizza de graça",
        detail: "Qualquer coisa",
        price: 0.01,
        qty: 1,
        pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS] },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].name).toBe("Pizza G");
    expect(r.itens[0].detail).toBe("Quatro Queijos");
    expect(r.itens[0].price).toBe(50);
  });

  it("sizeId inexistente é rejeitado, nunca cai para o legado", async () => {
    const r = await validarItensComanda([
      { kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: "size-inexistente", flavorIds: [FLAVOR_QUATRO_QUEIJOS] } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("flavorId inexistente é rejeitado", async () => {
    const r = await validarItensComanda([
      { kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: ["flavor-inexistente"] } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("borderId inexistente é rejeitado", async () => {
    const r = await validarItensComanda([
      {
        kind: "pizza",
        price: 0,
        qty: 1,
        pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS], borderId: "border-inexistente" },
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it("pizzaSelection: null é recusado — nunca cai para o legado mesmo com name/detail válidos junto", async () => {
    const r = await validarItensComanda([
      { kind: "pizza", name: "Pizza G", detail: "Quatro Queijos", price: 50, qty: 1, pizzaSelection: null },
    ]);
    expect(r.ok).toBe(false);
  });

  it.each([
    ["objeto vazio", {}],
    ["sizeId ausente", { flavorIds: [FLAVOR_QUATRO_QUEIJOS] }],
    ["flavorIds não é array", { sizeId: SIZE_G, flavorIds: "Quatro Queijos" }],
    ["string", "malformado"],
    ["número", 42],
  ])("pizzaSelection malformado (%s) é recusado, sem fallback legado", async (_desc, valor) => {
    const r = await validarItensComanda([
      { kind: "pizza", name: "Pizza G", detail: "Quatro Queijos", price: 50, qty: 1, pizzaSelection: valor },
    ]);
    expect(r.ok).toBe(false);
  });

  it("kind !== pizza com pizzaSelection presente é recusado (seleção estruturada só vale para pizza)", async () => {
    const r = await validarItensComanda([
      { kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS] } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("sabor esgotado é rejeitado", async () => {
    store.set("esgotados", ["Chocolate"]);
    const r = await validarItensComanda([
      { kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_CHOCOLATE] } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("borda esgotada é rejeitada", async () => {
    store.set("esgotados", ["Requeijão"]);
    const r = await validarItensComanda([
      { kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS], borderId: BORDER_REQUEIJAO } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("lista de esgotados é lida FRESCA a cada chamada — mesma seleção que passou antes agora é recusada", async () => {
    const payload = [
      { kind: "pizza" as const, price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_CHOCOLATE] } },
    ];
    const antes = await validarItensComanda(payload);
    expect(antes.ok).toBe(true);

    store.set("esgotados", ["Chocolate"]); // esgotou DEPOIS de salvar, ANTES de reenviar

    const depois = await validarItensComanda(payload);
    expect(depois.ok).toBe(false);
  });

  it("carrinho misto — item legado (name/detail) e item estruturado (pizzaSelection) no mesmo carrinho", async () => {
    const r = await validarItensComanda([
      { kind: "simple", name: "Refrigerante 2L", price: 0.01, qty: 1 },
      { kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS] } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].pizzaSelection).toBeUndefined();
    expect(r.itens[0].price).toBe(12);
    expect(r.itens[1].pizzaSelection).toEqual({ sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS] });
    expect(r.total).toBe(62);
  });

  it("comanda antiga sem pizzaSelection: pizza continua 100% pelo caminho legado (name/detail)", async () => {
    const r = await validarItensComanda([
      { kind: "pizza", name: "Pizza G", detail: "Quatro Queijos", price: 0.01, qty: 1 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].pizzaSelection).toBeUndefined();
    expect(r.itens[0].price).toBe(50);
  });

  it("propriedade extra adulterada dentro de pizzaSelection nunca chega ao item validado", async () => {
    const r = await validarItensComanda([
      {
        kind: "pizza",
        price: 0,
        qty: 1,
        pizzaSelection: {
          sizeId: SIZE_G,
          flavorIds: [FLAVOR_QUATRO_QUEIJOS],
          precoForjado: 0.01, // propriedade adulterada de propósito, testando sanitização
        },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].pizzaSelection).toEqual({ sizeId: SIZE_G, flavorIds: [FLAVOR_QUATRO_QUEIJOS] });
    expect(Object.keys(r.itens[0].pizzaSelection!)).toEqual(["sizeId", "flavorIds"]);
  });
});

// ===========================================================================
// Fase 6 — demais produtos configuráveis do Salão (Calzone, Mini-Pizza,
// Macarronada, sucos) usam os mesmos IDs oficiais (productId/sizeId/
// flavorId/milk) do cardápio público/pedido manual. IDs abaixo são
// determinísticos (slugify do nome já existente no cardápio — ver
// src/lib/catalog/ids.ts e src/lib/catalog/simpleProducts.ts), nunca
// inventados.
//
// Sabores REALMENTE compartilhados (mesmo nome em pizza/Calzone/Mini-Pizza,
// ex.: "Quatro Queijos") reutilizam o MESMO flavorId oficial — os mesmos
// FLAVOR_QUATRO_QUEIJOS/FLAVOR_CHOCOLATE já usados pela pizza acima, nunca
// um ID novo por produto. O que é próprio de cada produto é só a LISTA de
// sabores permitidos (menu.calzoneFlavors/miniPizzaFlavors) e a
// disponibilidade recalculada para essa lista — nunca por referência ao
// catálogo de outro produto.
// ===========================================================================

const CARDAPIO_TESTE_SIMPLES = {
  sizes: [{ code: "P", label: "Pequena", price: 30 }, { code: "G", label: "Grande", price: 50 }],
  // "Baiana" é um sabor de pizza válido, mas de propósito NÃO está em
  // nenhuma lista permitida de Calzone/Mini-Pizza abaixo — usado para provar
  // que a lista permitida (não a mera existência do flavorId) decide.
  saltyFlavors: ["Quatro Queijos", "Baiana"],
  sweetFlavors: ["Chocolate"],
  calzoneFlavors: ["Quatro Queijos", "Chocolate"],
  miniPizzaFlavors: ["Quatro Queijos"],
  borders: [],
  lanches: [
    { name: "Calzone", price: 35 },
    { name: "Mini-Pizza", price: 18 },
    { name: "Macarronada", price: 0, sizes: [{ code: "P", price: 25 }, { code: "G", price: 45 }] },
  ],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [{ name: "Laranja", price: 9 }],
  neighborhoods: [],
};

const PRODUCT_CALZONE = "product-calzone";
const PRODUCT_MINI_PIZZA = "product-mini-pizza";
const PRODUCT_MACARRONADA = "product-macarronada";
const PRODUCT_LARANJA = "product-laranja";
const SIZE_MACARRONADA_G = "size-g";
// flavorId de "Baiana" — mesmo esquema determinístico (flavor-<slug>), só
// para provar rejeição por lista permitida (nunca usado com sucesso abaixo).
const FLAVOR_BAIANA = "flavor-baiana";

describe("validarItensComanda — simpleSelection (Fase 6)", () => {
  beforeEach(() => {
    store.set("cardapio", CARDAPIO_TESTE_SIMPLES);
  });

  it("Calzone: resolve pelo catálogo oficial e preserva simpleSelection, reutilizando o MESMO flavorId da pizza", async () => {
    // FLAVOR_QUATRO_QUEIJOS é a mesma constante usada acima nos testes de
    // pizza (CARDAPIO_TESTE_PIZZA) — mesmo ID, mesmo sabor, produto diferente.
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].name).toBe("Calzone");
    expect(r.itens[0].detail).toBe("Sabor: Quatro Queijos");
    expect(r.itens[0].price).toBe(35);
    expect(r.itens[0].simpleSelection).toEqual({ productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS });
    expect(r.total).toBe(35);
  });

  it("Calzone: sabor doce (Chocolate) da lista oficial calzoneFlavors também resolve — preço não varia por sabor", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_CHOCOLATE } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].detail).toBe("Sabor: Chocolate");
    expect(r.itens[0].price).toBe(35);
  });

  it("Calzone: flavorId de sabor de pizza fora da lista permitida (Baiana) é rejeitado, mesmo sendo um ID oficial válido", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_BAIANA } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("Mini-Pizza: resolve pela lista oficial miniPizzaFlavors, reutilizando o MESMO flavorId da pizza", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_MINI_PIZZA, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].name).toBe("Mini-Pizza");
    expect(r.itens[0].detail).toBe("Sabor: Quatro Queijos");
    expect(r.itens[0].price).toBe(18);
  });

  it("Mini-Pizza com flavorId de sabor permitido só para Calzone (Chocolate) é rejeitada — listas permitidas são independentes por produto, mesmo com IDs compartilhados", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_MINI_PIZZA, flavorId: FLAVOR_CHOCOLATE } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("REGRESSÃO — disponibilidade específica por produto: Chocolate esgotado bloqueia só quem o usa (Calzone), Mini-Pizza nem o lista (não é opção ali) e Quatro Queijos continua disponível nos dois", async () => {
    store.set("esgotados", ["Chocolate"]);

    const calzoneComChocolate = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_CHOCOLATE } },
    ]);
    expect(calzoneComChocolate.ok).toBe(false);

    const calzoneComQuatroQueijos = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(calzoneComQuatroQueijos.ok).toBe(true);

    const miniPizzaComQuatroQueijos = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_MINI_PIZZA, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(miniPizzaComQuatroQueijos.ok).toBe(true);
  });

  it("Macarronada: resolve pelo tamanho e preserva simpleSelection", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_MACARRONADA, sizeId: SIZE_MACARRONADA_G } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].name).toBe("Macarronada");
    expect(r.itens[0].detail).toBe("Tamanho G");
    expect(r.itens[0].price).toBe(45);
    expect(r.itens[0].simpleSelection).toEqual({ productId: PRODUCT_MACARRONADA, sizeId: SIZE_MACARRONADA_G });
  });

  it("suco com leite: soma o adicional oficial", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_LARANJA, milk: "com" } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].detail).toBe("com leite");
    expect(r.itens[0].price).toBe(10); // 9 + 1
  });

  it("quantidade multiplica o total corretamente com simpleSelection presente", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 3, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].qty).toBe(3);
    expect(r.total).toBe(105); // Calzone (35) x 3
  });

  it("preço, name e detail adulterados são ignorados quando simpleSelection é válido — reconstrói do catálogo", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        name: "Calzone de graça",
        detail: "Qualquer coisa",
        price: 0.01,
        qty: 1,
        simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].name).toBe("Calzone");
    expect(r.itens[0].detail).toBe("Sabor: Quatro Queijos");
    expect(r.itens[0].price).toBe(35);
  });

  it("productId inexistente (ID adulterado) é rejeitado, nunca cai para o legado", async () => {
    const r = await validarItensComanda([
      { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 35, qty: 1, simpleSelection: { productId: "product-inexistente" } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("flavorId inexistente (ID adulterado) é rejeitado", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: "flavor-inexistente" } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("productId de outro catálogo (ex.: sizeId de pizza reaproveitado) é rejeitado", async () => {
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: "size-g" } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("simpleSelection: null é recusado — nunca cai para o legado mesmo com name/detail válidos junto", async () => {
    const r = await validarItensComanda([
      { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 35, qty: 1, simpleSelection: null },
    ]);
    expect(r.ok).toBe(false);
  });

  it.each([
    ["objeto vazio", {}],
    ["productId ausente", { flavorId: FLAVOR_QUATRO_QUEIJOS }],
    ["milk fora de com/sem", { productId: PRODUCT_LARANJA, milk: "banana" }],
    ["string", "malformado"],
    ["número", 42],
  ])("simpleSelection malformado (%s) é recusado, sem fallback legado", async (_desc, valor) => {
    const r = await validarItensComanda([
      { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 35, qty: 1, simpleSelection: valor },
    ]);
    expect(r.ok).toBe(false);
  });

  it("kind !== simple com simpleSelection presente é recusado (seleção estruturada só vale para produto simples)", async () => {
    const r = await validarItensComanda([
      { kind: "pizza", name: "Pizza G", price: 50, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("produto inteiro esgotado é rejeitado", async () => {
    store.set("esgotados", ["Calzone"]);
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("sabor de Calzone esgotado é rejeitado", async () => {
    store.set("esgotados", ["Quatro Queijos"]);
    const r = await validarItensComanda([
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(r.ok).toBe(false);
  });

  it("REGRESSÃO — item esgota ENTRE a montagem (PATCH salvando a rodada) e o envio: mesma seleção que passou antes agora é recusada", async () => {
    // Reproduz exatamente o cenário da auditoria: o atendente monta o item
    // (PATCH salva com sucesso, esgotados ainda vazio) e só DEPOIS o sabor
    // esgota — o reenvio (Beco de reprecificação em profundidade) precisa
    // pegar isso, nunca confiar no que foi validado da primeira vez.
    const payload = [
      { kind: "simple" as const, price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ];
    const antes = await validarItensComanda(payload);
    expect(antes.ok).toBe(true);

    store.set("esgotados", ["Quatro Queijos"]); // esgotou DEPOIS de salvar, ANTES de reenviar

    const depois = await validarItensComanda(payload);
    expect(depois.ok).toBe(false);
  });

  it("carrinho misto — item legado (name/detail), pizza estruturada e produto simples estruturado no mesmo carrinho", async () => {
    const r = await validarItensComanda([
      { kind: "simple", name: "Refrigerante 2L", price: 0.01, qty: 1 },
      { kind: "simple", price: 0, qty: 1, simpleSelection: { productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].simpleSelection).toBeUndefined();
    expect(r.itens[0].price).toBe(12);
    expect(r.itens[1].simpleSelection).toEqual({ productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS });
    expect(r.total).toBe(47);
  });

  it("comanda antiga sem simpleSelection: produto continua 100% pelo caminho legado (name/detail)", async () => {
    const r = await validarItensComanda([
      { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 0.01, qty: 1 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].simpleSelection).toBeUndefined();
    expect(r.itens[0].price).toBe(35);
  });

  it("propriedade extra adulterada dentro de simpleSelection nunca chega ao item validado", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        price: 0,
        qty: 1,
        simpleSelection: {
          productId: PRODUCT_CALZONE,
          flavorId: FLAVOR_QUATRO_QUEIJOS,
          precoForjado: 0.01, // propriedade adulterada de propósito, testando sanitização
        },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].simpleSelection).toEqual({ productId: PRODUCT_CALZONE, flavorId: FLAVOR_QUATRO_QUEIJOS });
    expect(Object.keys(r.itens[0].simpleSelection!)).toEqual(["productId", "flavorId"]);
  });
});

describe("atualizarItensComanda", () => {
  it("atualiza itens, observação e complemento de uma comanda aberta", async () => {
    const c = await abrirComandaOk("5");
    const validacao = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 1 }]);
    expect(validacao.ok).toBe(true);
    if (!validacao.ok) return;
    const atualizada = await atualizarItensComanda(c.id, validacao.itens, { observacao: "Sem gelo", complemento: "Varanda" });
    expect(atualizada).not.toBe("nao_encontrada");
    expect(atualizada).not.toBe("nao_esta_aberta");
    if (typeof atualizada === "object") {
      expect(atualizada.itens).toHaveLength(1);
      expect(atualizada.observacao).toBe("Sem gelo");
      expect(atualizada.complemento).toBe("Varanda");
    }
  });

  it("devolve nao_encontrada para id inexistente", async () => {
    const r = await atualizarItensComanda("comanda_inexistente", []);
    expect(r).toBe("nao_encontrada");
  });

  it("recusa atualizar uma comanda que não está mais aberta", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 10);
    const r = await atualizarItensComanda(c.id, []);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("marcarComandaEnviada", () => {
  it("marca como enviada e guarda o vínculo com o pedido", async () => {
    const c = await abrirComandaOk("5");
    const r = await marcarComandaEnviada(c.id, "ped_123", 42);
    expect(r).not.toBe("nao_encontrada");
    if (typeof r === "object") {
      expect(r.status).toBe("enviada");
      expect(r.pedidoId).toBe("ped_123");
      expect(r.pedidoNumero).toBe(42);
      expect(r.enviadaEm).toBeTruthy();
    }
  });

  it("recusa marcar como enviada uma comanda que já foi enviada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await marcarComandaEnviada(c.id, "ped_456", 43);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("fecharComanda", () => {
  it("recusa fechar uma comanda ainda aberta (sem pedido enviado)", async () => {
    const c = await abrirComandaOk("5");
    const r = await fecharComanda(c.id);
    expect(r).toBe("ainda_aberta");
  });

  it("fecha uma comanda já enviada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await fecharComanda(c.id);
    expect(r).not.toBe("nao_encontrada");
    if (typeof r === "object") {
      expect(r.status).toBe("fechada");
      expect(r.fechadaEm).toBeTruthy();
    }
  });

  it("recusa fechar uma comanda já fechada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    await fecharComanda(c.id);
    const r = await fecharComanda(c.id);
    expect(r).toBe("ja_fechada");
  });
});

describe("buscarComanda", () => {
  it("devolve null para id inexistente", async () => {
    expect(await buscarComanda("nao_existe")).toBeNull();
  });
});

async function itensRefrigerante(qty: number) {
  const v = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty }]);
  if (!v.ok) throw new Error("validação falhou no teste");
  return v.itens;
}

describe("comRodadasNormalizadas — comandas antigas viram Rodada 1", () => {
  it("comanda aberta (sem rodadas) vira Rodada 1 em rascunho", async () => {
    const c = await abrirComandaOk("5");
    const itens = await itensRefrigerante(2);
    await atualizarItensComanda(c.id, itens);
    const bruta = await buscarComanda(c.id);
    const normalizada = comRodadasNormalizadas(bruta!);
    expect(normalizada.rodadas).toHaveLength(1);
    expect(normalizada.rodadas![0].numero).toBe(1);
    expect(normalizada.rodadas![0].status).toBe("rascunho");
    expect(normalizada.rodadas![0].itens).toEqual(itens);
    expect(normalizada.rodadas![0].subtotal).toBe(24);
  });

  it("comanda enviada (sem rodadas) vira Rodada 1 enviada, com pedidoId preservado", async () => {
    const c = await abrirComandaOk("5");
    const r = await marcarComandaEnviada(c.id, "ped_123", 42);
    if (typeof r !== "object") throw new Error("esperava Comanda");
    const normalizada = comRodadasNormalizadas(r);
    expect(normalizada.rodadas).toHaveLength(1);
    expect(normalizada.rodadas![0].status).toBe("enviada");
    expect(normalizada.rodadas![0].pedidoId).toBe("ped_123");
    expect(normalizada.rodadas![0].pedidoNumero).toBe(42);
    expect(normalizada.rodadas![0].enviadaEm).toBeTruthy();
  });

  it("nunca apaga os campos antigos (itens, pedidoId) ao normalizar", async () => {
    const c = await abrirComandaOk("5");
    const r = await marcarComandaEnviada(c.id, "ped_123", 42);
    if (typeof r !== "object") throw new Error("esperava Comanda");
    const normalizada = comRodadasNormalizadas(r);
    expect(normalizada.itens).toEqual(r.itens);
    expect(normalizada.pedidoId).toBe("ped_123");
  });

  it("comanda que já tem rodadas volta como está (não normaliza de novo)", async () => {
    const c = await abrirComandaOk("5");
    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    const normalizada = comRodadasNormalizadas(criada.comanda);
    expect(normalizada.rodadas).toBe(criada.comanda.rodadas);
  });
});

describe("criarRodadaEmRascunho", () => {
  it("recusa comanda inexistente", async () => {
    const r = await criarRodadaEmRascunho("comanda_inexistente");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_encontrada");
  });

  it("recusa comanda fechada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    await fecharComanda(c.id);
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("comanda_fechada");
  });

  it("cria a Rodada 2 em rascunho depois da Rodada 1 enviada, com número sequencial correto", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.criada).toBe(true);
      expect(r.rodada.numero).toBe(2);
      expect(r.rodada.status).toBe("rascunho");
      expect(r.rodada.itens).toEqual([]);
      expect(r.comanda.rodadas).toHaveLength(2);
      expect(r.comanda.rodadas![0].numero).toBe(1);
      expect(r.comanda.rodadas![0].status).toBe("enviada");
    }
  });

  it("comanda 'aberta' (Rodada 1 ainda em rascunho) não ganha uma segunda rodada — devolve a própria Rodada 1", async () => {
    const c = await abrirComandaOk("5");
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.criada).toBe(false);
      expect(r.rodada.numero).toBe(1);
    }
  });

  it("nunca existem duas rodadas em rascunho — segunda chamada sem clientRequestId devolve a mesma rodada existente", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const primeira = await criarRodadaEmRascunho(c.id);
    const segunda = await criarRodadaEmRascunho(c.id);
    expect(primeira.ok && segunda.ok).toBe(true);
    if (primeira.ok && segunda.ok) {
      expect(segunda.criada).toBe(false);
      expect(segunda.rodada.id).toBe(primeira.rodada.id);
    }
    const lista = await listarComandas();
    expect(comRodadasNormalizadas(lista[0]).rodadas).toHaveLength(2);
  });

  it("idempotência por clientRequestId: mesma chamada duas vezes devolve a mesma rodada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const primeira = await criarRodadaEmRascunho(c.id, "req-abc");
    const segunda = await criarRodadaEmRascunho(c.id, "req-abc");
    expect(primeira.ok && segunda.ok).toBe(true);
    if (primeira.ok && segunda.ok) {
      expect(primeira.criada).toBe(true);
      expect(segunda.criada).toBe(false);
      expect(segunda.rodada.id).toBe(primeira.rodada.id);
    }
  });

  it("duplo clique / duas abas concorrentes — só uma Rodada 2 é criada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const [a, b] = await Promise.all([criarRodadaEmRascunho(c.id), criarRodadaEmRascunho(c.id)]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      const criadas = [a.criada, b.criada].filter(Boolean);
      expect(criadas).toHaveLength(1);
      expect(a.rodada.id).toBe(b.rodada.id);
    }
    const lista = await listarComandas();
    expect(comRodadasNormalizadas(lista[0]).rodadas).toHaveLength(2);
  });

  it("Redis indisponível: a operação rejeita (o chamador decide o erro seguro)", async () => {
    const c = await abrirComandaOk("5");
    redisMock.set.mockImplementationOnce(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(criarRodadaEmRascunho(c.id)).rejects.toThrow();
  });

  it("nunca cria pedido oficial nem toca em impressão — só devolve a estrutura da rodada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rodada.pedidoId).toBeUndefined();
      expect(r.rodada.enviadaEm).toBeUndefined();
    }
  });
});

describe("atualizarItensRodada", () => {
  async function comandaComRodada2() {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await criarRodadaEmRascunho(c.id);
    if (!r.ok) throw new Error("esperava sucesso");
    return { comandaId: c.id, rodadaId: r.rodada.id };
  }

  it("adiciona itens à Rodada 2", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    const itens = await itensRefrigerante(1);
    const r = await atualizarItensRodada(comandaId, rodadaId, itens);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rodada.itens).toEqual(itens);
      expect(r.rodada.subtotal).toBe(12);
    }
  });

  it("altera quantidade (nova chamada substitui a lista completa)", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    await atualizarItensRodada(comandaId, rodadaId, await itensRefrigerante(1));
    const r = await atualizarItensRodada(comandaId, rodadaId, await itensRefrigerante(3));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rodada.subtotal).toBe(36);
  });

  it("remove item (lista vazia é permitida numa rodada em rascunho)", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    await atualizarItensRodada(comandaId, rodadaId, await itensRefrigerante(1));
    const r = await atualizarItensRodada(comandaId, rodadaId, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rodada.itens).toEqual([]);
      expect(r.rodada.subtotal).toBe(0);
    }
  });

  it("salva observação da rodada", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    const r = await atualizarItensRodada(comandaId, rodadaId, [], { observacao: "Sem canudo" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rodada.observacao).toBe("Sem canudo");
  });

  it("a Rodada 1 permanece intacta ao editar a Rodada 2 — itens não vazam entre rodadas", async () => {
    const c = await abrirComandaOk("5");
    const r1 = await marcarComandaEnviada(c.id, "ped_1", 1);
    if (typeof r1 !== "object") throw new Error("esperava Comanda");
    const rodada1ItensAntes = comRodadasNormalizadas(r1).rodadas![0].itens;

    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(5));

    const final = await buscarComanda(c.id);
    const rodadas = comRodadasNormalizadas(final!).rodadas!;
    expect(rodadas[0].itens).toEqual(rodada1ItensAntes);
    expect(rodadas[1].itens).toHaveLength(1);
  });

  it("recusa editar uma rodada já enviada (imutável)", async () => {
    const c = await abrirComandaOk("5");
    const r1 = await marcarComandaEnviada(c.id, "ped_1", 1);
    if (typeof r1 !== "object") throw new Error("esperava Comanda");
    const rodada1Id = comRodadasNormalizadas(r1).rodadas![0].id;
    const r = await atualizarItensRodada(c.id, rodada1Id, await itensRefrigerante(9));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("rodada_nao_e_rascunho");
  });

  it("recusa rodada inexistente", async () => {
    const c = await abrirComandaOk("5");
    const r = await atualizarItensRodada(c.id, "rodada_inexistente", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("rodada_nao_encontrada");
  });

  it("recusa comanda fechada", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    await fecharComanda(comandaId);
    const r = await atualizarItensRodada(comandaId, rodadaId, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("comanda_fechada");
  });

  it("recusa comanda inexistente", async () => {
    const r = await atualizarItensRodada("comanda_inexistente", "rodada_x", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_encontrada");
  });
});

describe("totalParcialComanda", () => {
  it("soma o subtotal de todas as rodadas (enviada + rascunho)", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1); // Rodada 1: sem itens reais neste teste (itens vazios = subtotal 0)
    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(2));

    const final = await buscarComanda(c.id);
    expect(totalParcialComanda(final!)).toBe(24);
  });

  it("Rodada 1 com itens reais soma junto com a Rodada 2", async () => {
    const c = await abrirComandaOk("5");
    await atualizarItensComanda(c.id, await itensRefrigerante(1)); // Rodada 1 = R$ 12
    const r1 = await marcarComandaEnviada(c.id, "ped_1", 1);
    if (typeof r1 !== "object") throw new Error("esperava Comanda");

    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(2)); // Rodada 2 = R$ 24

    const final = await buscarComanda(c.id);
    expect(totalParcialComanda(final!)).toBe(36);
  });
});

describe("rodadas — isolamento de outros fluxos", () => {
  it("criar/atualizar rodada nunca chama redis.set na chave de impressão automática", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(1));

    const chamadasImpressao = redisMock.set.mock.calls.filter(([chave]: [string, ...unknown[]]) =>
      typeof chave === "string" && chave.startsWith("pedido:auto-print-claim:")
    );
    expect(chamadasImpressao).toHaveLength(0);
  });
});
