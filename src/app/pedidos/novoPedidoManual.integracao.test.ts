// Integração da montagem manual com a rota real de criação de pedido.
//
// O ponto destes testes não é reexercitar POST /api/pedido-app (que já tem
// suíte própria), e sim provar o contrato que a montagem manual assume: o
// ItemApp produzido por `construirItemManual` é exatamente o que o servidor
// aceita e sabe precificar. Se alguém mudar a gramática de name/detail de um
// lado só, estes testes quebram.

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
    // Mesmo despacho dos três scripts Lua usado em route.test.ts.
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length === 2 && args.length === 3) {
        store.set(keys[0], JSON.parse(args[0]));
        store.set(keys[1], args[1]);
        return 1;
      }
      if (keys.length === 2) {
        const [chaveToken, chaveResultado] = keys;
        const tokenAtual = store.has(chaveToken) ? store.get(chaveToken) : undefined;
        const resultadoAtual = store.has(chaveResultado) ? store.get(chaveResultado) : undefined;
        if (tokenAtual === undefined && resultadoAtual === undefined) return "ja_ausente";
        if (resultadoAtual === undefined) { store.delete(chaveToken); return "ja_ausente"; }
        if (tokenAtual === undefined) return "incerto";
        if (tokenAtual === args[0]) { store.delete(chaveToken); store.delete(chaveResultado); return "removido"; }
        return "substituido_por_outro";
      }
      if (store.get(keys[0]) === args[0]) { store.delete(keys[0]); return 1; }
      return 0;
    }),
  };
  return { store, redisMock, defaultSetImpl, defaultGetImpl };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

import { POST } from "@/app/api/pedido-app/route";
import { getMENUDinamico } from "@/lib/menu";
import {
  listarProdutosManuais,
  construirItemManual,
  calcularTotalManual,
  adicionarAoCarrinho,
  selecaoVazia,
  type MenuManual,
  type ProdutoManual,
} from "@/lib/montagemManual";
import type { ItemApp } from "@/lib/pedidoAppItens";

// Cardápio de teste — nomes e valores inventados para o teste. `getMENUDinamico`
// sobrepõe estes campos ao cardápio estático, então rota e montagem manual
// enxergam exatamente o MESMO cardápio.
const CARDAPIO_TESTE = {
  sizes: [
    { code: "P", label: "Pequena", price: 30 },
    { code: "G", label: "Grande", price: 50 },
  ],
  saltyFlavors: ["Quatro Queijos", "Frango com Requeijão"],
  sweetFlavors: ["Chocolate"],
  borders: [{ label: "Requeijão", priceSmall: 5, priceLarge: 8 }],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [{ name: "Suco de Açaí", price: 10 }],
  neighborhoods: [{ name: "Centro", fee: 7 }],
};

function postReq(body: unknown) {
  return { json: async () => body } as never;
}

async function menuDoServidor(): Promise<MenuManual> {
  return (await getMENUDinamico()) as unknown as MenuManual;
}

function acharProduto(produtos: ProdutoManual[], id: string): ProdutoManual {
  const p = produtos.find((x) => x.id === id);
  if (!p) throw new Error(`produto ausente no catálogo derivado: ${id}`);
  return p;
}

/** Monta o carrinho como a tela monta, e o payload como a tela envia. */
async function montarCarrinho(): Promise<{ menu: MenuManual; itens: ItemApp[] }> {
  const menu = await menuDoServidor();
  const produtos = listarProdutosManuais(menu);
  const pizza = construirItemManual(
    acharProduto(produtos, "pizza:g"),
    { sabores: ["Chocolate", "Quatro Queijos"], borda: "Requeijão" },
    menu
  );
  const refri = construirItemManual(acharProduto(produtos, "bebidas:refrigerante 2l"), selecaoVazia(), menu);
  expect(pizza).not.toBeNull();
  expect(refri).not.toBeNull();
  return { menu, itens: adicionarAoCarrinho([pizza as ItemApp], refri as ItemApp) };
}

function payload(itens: ItemApp[], extra: Record<string, unknown> = {}) {
  return {
    cliente: "Cliente de Teste",
    telefone: "(86) 99999-8888",
    usarOutroWhatsapp: true,
    itens: itens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty })),
    tipoEntrega: "retirada",
    pagamento: "Pix",
    ...extra,
  };
}

function pedidosCriados(): Array<Record<string, unknown>> {
  return (store.get("pedidos") as Array<Record<string, unknown>>) || [];
}

beforeEach(() => {
  store.clear();
  store.set("cardapio", CARDAPIO_TESTE);
  vi.clearAllMocks();
  redisMock.set.mockImplementation(defaultSetImpl);
  redisMock.get.mockImplementation(defaultGetImpl);
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("montagem manual → POST /api/pedido-app", () => {
  it("cria o pedido e o servidor confirma o total calculado na tela", async () => {
    const { menu, itens } = await montarCarrinho();
    const totalTela = calcularTotalManual(itens, menu, 0);

    const res = await POST(postReq(payload(itens)));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    // Pizza G meio a meio com borda grande (50 + 8) + refrigerante (12) = 70.
    expect(totalTela.total).toBe(70);
    expect(data.total).toBe(totalTela.total);
    expect(pedidosCriados()).toHaveLength(1);
  });

  it("o servidor recalcula o preço e ignora valor adulterado no payload", async () => {
    const { itens } = await montarCarrinho();
    const adulterados = itens.map((i) => ({ ...i, price: 0.01 }));

    const res = await POST(postReq(payload(adulterados)));
    const data = await res.json();
    expect(data.total).toBe(70);
  });

  it("retirada não cobra taxa de entrega", async () => {
    const { itens } = await montarCarrinho();
    const res = await POST(postReq(payload(itens, { tipoEntrega: "retirada" })));
    const data = await res.json();
    expect(data.total).toBe(70);
    expect(pedidosCriados()[0].taxaEntrega).toBeUndefined();
  });

  it("delivery soma a taxa do bairro calculada no servidor", async () => {
    const { menu, itens } = await montarCarrinho();
    const res = await POST(
      postReq(payload(itens, { tipoEntrega: "delivery", bairro: "Centro", rua: "Rua A", numero: "10" }))
    );
    const data = await res.json();

    expect(data.total).toBe(77); // 70 + taxa 7
    expect(calcularTotalManual(itens, menu, 7).total).toBe(77); // a tela previu o mesmo
    expect(pedidosCriados()[0].taxaEntrega).toBe(7);
  });

  it("delivery sem endereço completo é recusado e nada é persistido", async () => {
    const { itens } = await montarCarrinho();
    const res = await POST(postReq(payload(itens, { tipoEntrega: "delivery", bairro: "", rua: "", numero: "" })));
    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("aceita pagamento simples", async () => {
    const { itens } = await montarCarrinho();
    const res = await POST(postReq(payload(itens, { pagamento: "Cartao" })));
    expect((await res.json()).ok).toBe(true);
    expect(pedidosCriados()[0].pagamento).toBe("Cartao");
  });

  it("aceita pagamento misto na forma canônica do módulo central", async () => {
    const { itens } = await montarCarrinho();
    const misto = "Pix (R$ 40,00) + Dinheiro (R$ 30,00)"; // fecha os R$ 70
    const res = await POST(postReq(payload(itens, { pagamento: misto, troco: "Sem troco" })));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(pedidosCriados()[0].pagamento).toBe(misto);
    // A parte em Pix é a do misto, não o total do pedido.
    expect((pedidosCriados()[0].pix as { valorEsperado: number }).valorEsperado).toBe(40);
  });

  it("pagamento com dinheiro sem troco informado é recusado", async () => {
    const { itens } = await montarCarrinho();
    const res = await POST(postReq(payload(itens, { pagamento: "Dinheiro" })));
    expect(res.status).toBe(400);
  });

  it("item fora do cardápio é recusado pelo servidor (e nunca é montável na tela)", async () => {
    const menu = await menuDoServidor();
    const produtos = listarProdutosManuais(menu);
    expect(produtos.find((p) => p.nome === "Produto Fantasma")).toBeUndefined();

    const res = await POST(
      postReq(payload([{ kind: "simple", name: "Produto Fantasma", detail: "", price: 5, qty: 1 }]))
    );
    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("carrinho vazio é recusado", async () => {
    const res = await POST(postReq(payload([])));
    expect(res.status).toBe(400);
  });
});

describe("criação sem duplicidade", () => {
  it("reenvio com o MESMO clientRequestId não cria um segundo pedido", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: "montagem-manual-tentativa-0001" });

    const primeira = await POST(postReq(corpo));
    const r1 = await primeira.json();
    expect(r1.ok).toBe(true);
    expect(pedidosCriados()).toHaveLength(1);

    // Mesmo corpo, mesma tentativa: é o retry de uma falha de rede.
    const segunda = await POST(postReq(corpo));
    const r2 = await segunda.json();
    expect(r2.ok).toBe(true);
    expect(pedidosCriados()).toHaveLength(1);
    expect(r2.pedidoId).toBe(r1.pedidoId);
  });

  it("tentativas diferentes criam pedidos diferentes", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { itens } = await montarCarrinho();

    await POST(postReq(payload(itens, { clientRequestId: "montagem-manual-tentativa-0001" })));
    await POST(postReq(payload(itens, { clientRequestId: "montagem-manual-tentativa-0002" })));

    expect(pedidosCriados()).toHaveLength(2);
  });
});

describe("erro de servidor e recuperação", () => {
  it("falha de persistência não cria pedido e devolve erro tratado", async () => {
    const { itens } = await montarCarrinho();
    redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (key === "pedidos") throw new Error("redis indisponivel");
      return defaultSetImpl(key, value, opts);
    });

    const res = await POST(postReq(payload(itens)));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const data = await res.json();
    expect(data.ok).not.toBe(true);
    // Erro para a tela, nunca stack trace nem detalhe de infraestrutura.
    expect(typeof data.error === "string" || data.error === undefined).toBe(true);
    expect(String(data.error ?? "")).not.toContain("redis");
    expect(pedidosCriados()).toHaveLength(0);
  });

  it("depois de a falha passar, a MESMA tentativa cria o pedido uma única vez", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: "montagem-manual-tentativa-0003" });

    redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (key === "pedidos") throw new Error("redis indisponivel");
      return defaultSetImpl(key, value, opts);
    });
    const falha = await POST(postReq(corpo));
    expect((await falha.json()).ok).not.toBe(true);

    // Infra volta; o atendente toca em "tentar de novo" com a mesma tentativa.
    redisMock.set.mockImplementation(defaultSetImpl);
    const sucesso = await POST(postReq(corpo));
    expect((await sucesso.json()).ok).toBe(true);
    expect(pedidosCriados()).toHaveLength(1);
  });
});
