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
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    // Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [chave] = keys;
      const [tokenEsperado] = args;
      if (store.get(chave) === tokenEsperado) {
        store.delete(chave);
        return 1;
      }
      return 0;
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST as iniciar } from "./iniciar/route";
import { GET as status } from "./status/route";
import { POST as salvar } from "./salvar/route";
import { POST as descartar } from "./descartar/route";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { buildCatalog } from "@/lib/catalog/adapter";
import { MENU } from "@/lib/menu";

function req(body: unknown) {
  return { json: async () => body } as never;
}
function getReq(query: string) {
  return { nextUrl: new URL(`https://chefebot.test/api/pedido-app/x/editar/status${query}`) } as never;
}
function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

const PEDIDO_ID = "ped_1";
const TOKEN = "token-publico-abc";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: PEDIDO_ID,
    numero: 10,
    cliente: "Fulano de Tal",
    telefone: "86999998888",
    itens: ["1x Refrigerante 2L"],
    itensDetalhados: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 1 }],
    total: 15,
    status: "novo",
    horario: "12:00",
    endereco: "Retirada na loja",
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
    statusToken: TOKEN,
    revision: 1,
    ...overrides,
  };
  store.set("pedidos", [pedido]);
  return pedido;
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST iniciar", () => {
  it("inicia a edicao normalmente e cria um lock com editSessionId", async () => {
    seedPedido();
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ok).toBe(true);
    expect(typeof data.editSessionId).toBe("string");
    expect(data.revision).toBe(1);

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].editStatus).toBe("editing");
    expect(pedidos[0].editSessionId).toBe(data.editSessionId);
  });

  it("rejeita token publico invalido (nunca autentica so pelo id)", async () => {
    seedPedido();
    const res = await iniciar(req({ statusToken: "token-errado" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(404);
  });

  it("rejeita pedido de outro cliente (token nao bate)", async () => {
    seedPedido({ id: "ped_outro", statusToken: "outro-token" });
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor("ped_outro"));
    expect(res.status).toBe(404);
  });

  it("bloqueia quando o pedido ja foi aceito", async () => {
    seedPedido({ status: "em_preparo" });
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
    const data = await json(res);
    expect(String(data.error)).toMatch(/aceito/i);
  });

  it("bloqueia quando o Pix ja foi confirmado", async () => {
    seedPedido({ pagamento: "Pix", pix: { status: "confirmado" } });
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
    const data = await json(res);
    expect(String(data.error)).toMatch(/pagamento/i);
  });

  it("duas tentativas de edicao simultaneas: a segunda e rejeitada enquanto a primeira estiver ativa", async () => {
    seedPedido();
    const res1 = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    expect(res1.status).toBe(200);

    const res2 = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    expect(res2.status).toBe(409);
  });

  it("aceite concluido antes do inicio da edicao bloqueia a edicao (concorrencia)", async () => {
    const pedido = seedPedido();
    // Simula a Kellyne aceitando entre a leitura do cliente e a tentativa de iniciar.
    store.set("pedidos", [{ ...pedido, status: "em_preparo" }]);
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
  });
});

describe("GET status", () => {
  it("retorna o estado atual, incluindo editStatus e revision", async () => {
    seedPedido();
    const res = await status(getReq(`?id=${PEDIDO_ID}&token=${TOKEN}`), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.editStatus).toBe("none");
    expect(data.revision).toBe(1);
  });

  it("token invalido nao encontra o pedido", async () => {
    seedPedido();
    const res = await status(getReq(`?id=${PEDIDO_ID}&token=errado`), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(404);
  });

  it("limpa preguicosamente um lock expirado e libera o aceite", async () => {
    seedPedido({
      editStatus: "editing",
      editSessionId: "sessao-velha",
      editExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await status(getReq(`?id=${PEDIDO_ID}&token=${TOKEN}`), paramsFor(PEDIDO_ID));
    const data = await json(res);
    expect(data.editStatus).toBe("none");
    expect(data.lockAtivo).toBe(false);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].editStatus).toBe("none");
  });
});

describe("POST descartar", () => {
  it("descarta a edicao ativa e preserva o pedido original", async () => {
    seedPedido();
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const { editSessionId } = await json(iniciarRes);

    const res = await descartar(req({ statusToken: TOKEN, editSessionId }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].editStatus).toBe("none");
    expect(pedidos[0].total).toBe(15); // original preservado
    expect(pedidos[0].id).toBe(PEDIDO_ID);
  });

  it("descarte duplicado (clique duplo) e idempotente", async () => {
    seedPedido();
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const { editSessionId } = await json(iniciarRes);

    const res1 = await descartar(req({ statusToken: TOKEN, editSessionId }), paramsFor(PEDIDO_ID));
    const res2 = await descartar(req({ statusToken: TOKEN, editSessionId }), paramsFor(PEDIDO_ID));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("libera o aceite apos o descarte (nao ha mais lock ativo)", async () => {
    seedPedido();
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const { editSessionId } = await json(iniciarRes);
    await descartar(req({ statusToken: TOKEN, editSessionId }), paramsFor(PEDIDO_ID));

    // Uma nova edicao pode comecar normalmente — prova de que o lock foi liberado.
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
  });
});

describe("POST salvar", () => {
  const payloadBase = {
    itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 2 }],
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
  };

  async function iniciarEdicao() {
    seedPedido();
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    return data.editSessionId as string;
  }

  it("salva as alteracoes, recalcula o total no servidor e incrementa a revisao", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({ statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.total).toBe(30); // 2x R$15 recalculado no servidor
    expect(data.revision).toBe(2);

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].id).toBe(PEDIDO_ID); // mesmo pedido, nao duplicado
    expect(pedidos.length).toBe(1);
    expect(pedidos[0].revision).toBe(2);
    expect(pedidos[0].editStatus).toBe("edited");
    expect(pedidos[0].editSessionId).toBeUndefined();
  });

  it("preserva o ID e o numero sequencial do pedido", async () => {
    const editSessionId = await iniciarEdicao();
    await salvar(req({ statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase }), paramsFor(PEDIDO_ID));
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].id).toBe(PEDIDO_ID);
    expect(pedidos[0].numero).toBe(10);
  });

  it("rejeita payload com item invalido (nao existe no cardapio) sem alterar o pedido", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Produto Inexistente XPTO", detail: "", price: 999, qty: 1 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(400);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(15);
  });

  it("ignora preco adulterado enviado pelo cliente — recalcula sempre no servidor", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 0.01, qty: 1 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    expect(data.total).toBe(15); // preco oficial do cardapio, nao o 0.01 enviado
  });

  it("rejeita revisao desatualizada (conflito de concorrencia)", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({ statusToken: TOKEN, editSessionId, revision: 99, ...payloadBase }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
  });

  it("rejeita sessao de edicao invalida", async () => {
    seedPedido();
    const res = await salvar(req({ statusToken: TOKEN, editSessionId: "sessao-forjada", revision: 1, ...payloadBase }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
  });

  it("rejeita salvar quando a sessao expirou (410)", async () => {
    seedPedido({
      editStatus: "editing",
      editSessionId: "sessao-expirada",
      editExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await salvar(req({ statusToken: TOKEN, editSessionId: "sessao-expirada", revision: 1, ...payloadBase }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(410);
  });

  it("rejeita salvar apos o pedido ter sido aceito", async () => {
    const editSessionId = await iniciarEdicao();
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    store.set("pedidos", [{ ...pedidos[0], status: "em_preparo" }]);
    const res = await salvar(req({ statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
  });

  it("nao permite alterar campos protegidos (id, numero, status) via payload", async () => {
    const editSessionId = await iniciarEdicao();
    await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase,
      id: "outro-id-forjado", numero: 999, status: "entregue",
    } as never), paramsFor(PEDIDO_ID));
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].id).toBe(PEDIDO_ID);
    expect(pedidos[0].numero).toBe(10);
    expect(pedidos[0].status).toBe("novo");
  });

  it("clique duplo no salvar (mesma sessao) e idempotente e nao duplica o pedido", async () => {
    const editSessionId = await iniciarEdicao();
    const body = { statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase };
    const res1 = await salvar(req(body), paramsFor(PEDIDO_ID));
    const data1 = await json(res1);
    const res2 = await salvar(req(body), paramsFor(PEDIDO_ID));
    const data2 = await json(res2);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(data2.idempotent).toBe(true);
    expect(data1.total).toBe(data2.total);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos.length).toBe(1);
  });

  it("libera o aceite apos salvar (lock removido, editStatus = edited)", async () => {
    const editSessionId = await iniciarEdicao();
    await salvar(req({ statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase }), paramsFor(PEDIDO_ID));
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].editStatus).toBe("edited");
    expect(pedidos[0].editExpiresAt).toBeUndefined();
  });

  it("registra o resumo das alteracoes (changesSummary)", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({ statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase, pagamento: "Pix" }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    expect(Array.isArray(data.changesSummary)).toBe(true);
    expect((data.changesSummary as string[]).some((l) => l.includes("Pagamento"))).toBe(true);
  });

  it("bloqueia salvar quando o Pix ja foi confirmado", async () => {
    seedPedido({ pagamento: "Pix", pix: { status: "pendente" } });
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const { editSessionId } = await json(iniciarRes);
    // Confirma o Pix depois de iniciar a edicao (ex: webhook chegou nesse meio-tempo).
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    store.set("pedidos", [{ ...pedidos[0], pix: { status: "confirmado" } }]);

    const res = await salvar(req({ statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
  });

  it("Pix nao pago substituido: nova cobranca some com txid igual mas providerPaymentId marcado como substituido", async () => {
    seedPedido({
      pagamento: "Pix",
      pix: { status: "pendente", txid: "chefebot_ped_1", valorEsperado: 15, providerPaymentId: "mp-antigo" },
    });
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const { editSessionId } = await json(iniciarRes);

    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 3 }],
      tipoEntrega: "retirada", pagamento: "Pix",
    }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.pixSubstituido).toBe(true);

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    const pixSubstituido = pedidos[0].pixSubstituido as Array<Record<string, unknown>>;
    expect(pixSubstituido[0].providerPaymentId).toBe("mp-antigo");
    // Sem integracao Mercado Pago ativa no teste, o novo pix fica pendente/manual —
    // o importante e que o valorEsperado bate com o NOVO total, nunca o antigo.
    const novoPix = pedidos[0].pix as Record<string, unknown>;
    expect(novoPix.valorEsperado).toBe(45);
  });

  it("Pix para dinheiro: remove o pix da resposta ao cliente e registra a substituicao", async () => {
    seedPedido({
      pagamento: "Pix",
      pix: { status: "pendente", txid: "chefebot_ped_1", valorEsperado: 15, providerPaymentId: "mp-antigo" },
    });
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const { editSessionId } = await json(iniciarRes);

    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase, pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    expect(data.pix).toBeUndefined();
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pix).toBeUndefined();
    expect((pedidos[0].pixSubstituido as unknown[]).length).toBe(1);
  });

  it("Dinheiro para Pix: gera cobranca nova somente apos salvar", async () => {
    const editSessionId = await iniciarEdicao(); // pedido base e Dinheiro
    const res = await salvar(req({ statusToken: TOKEN, editSessionId, revision: 1, ...payloadBase, pagamento: "Pix", troco: undefined }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pix).toBeTruthy();
  });
});

describe("POST salvar — seleção estruturada de pizza por ID (Fase 2)", () => {
  const catalog = buildPizzaCatalog(MENU);
  const sizeIdG = catalog.sizes.find((s) => s.code === "G")!.id;
  const flavorCalabresa = catalog.flavors.find((f) => f.name === "Calabresa")!.id;

  async function iniciarEdicao() {
    seedPedido();
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    return data.editSessionId as string;
  }

  it("recalcula nativamente e grava name/detail canônicos em itensDetalhados, ignorando o que o cliente mandou", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "pizza", name: "Pizza F", detail: "sabor inventado", price: 0.01, qty: 1, pizzaSelection: { sizeId: sizeIdG, flavorIds: [flavorCalabresa] } }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.total).toBe(50); // preço oficial da Grande no Menu

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].itens).toEqual(["Pizza G Calabresa"]);
    const itensDetalhados = pedidos[0].itensDetalhados as Array<Record<string, unknown>>;
    expect(itensDetalhados[0]).toMatchObject({ name: "Pizza G", detail: "Calabresa", price: 50 });
  });

  it("rejeita seleção com tamanho inexistente e nunca cai para o caminho legado, mesmo com name/detail válidos", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 1, pizzaSelection: { sizeId: "size-inexistente", flavorIds: [flavorCalabresa] } }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(400);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(15); // pedido original intacto
    expect(pedidos[0].revision).toBe(1);
  });

  it("pizzaSelection: null com name/detail legado válido é tratado como formato estruturado inválido — 400, nunca cai no legado", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 1, pizzaSelection: null }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(400);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(15); // pedido original intacto
    expect(pedidos[0].revision).toBe(1);
  });

  it.each([false, 0, "", "texto", 42, [], {}])(
    "pizzaSelection malformado (%p) com name/detail legado válido é tratado como formato estruturado inválido — 400",
    async (valor) => {
      const editSessionId = await iniciarEdicao();
      const res = await salvar(req({
        statusToken: TOKEN, editSessionId, revision: 1,
        itens: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 1, pizzaSelection: valor }],
        tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
      }), paramsFor(PEDIDO_ID));

      expect(res.status).toBe(400);
      const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos[0].total).toBe(15); // pedido original intacto
      expect(pedidos[0].revision).toBe(1);
    }
  );

  it("ausência total de pizzaSelection continua 100% legado (name/detail funcionam normalmente)", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 999, qty: 1 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const data = await json(res);
    const sizeG = MENU.sizes.find((s) => s.code === "G")!;
    expect(data.total).toBe(sizeG.price); // preço do servidor, nunca o 999 enviado pelo cliente
  });
});

describe("POST salvar — seleção estruturada de produto simples por ID (Fase 6)", () => {
  const simpleCatalog = buildCatalog(MENU);
  const productIdCalzone = simpleCatalog.lanches.find((l) => l.name === "Calzone")!.id;
  const productIdMacarronada = simpleCatalog.lanches.find((l) => l.name === "Macarronada de Carne")!.id;
  const sizeGMacarronada = simpleCatalog.lanches.find((l) => l.name === "Macarronada de Carne")!.sizes!.find((s) => s.code === "G")!.id;
  const flavorCalabresaSimples = simpleCatalog.saltyFlavors.find((f) => f.name === "Calabresa")!.id;

  async function iniciarEdicao() {
    seedPedido();
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    return data.editSessionId as string;
  }

  it("Calzone: recalcula nativamente e grava name/detail canônicos, ignorando o que o cliente mandou", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Produto Inventado", detail: "sabor inventado", price: 0.01, qty: 1, simpleSelection: { productId: productIdCalzone, flavorId: flavorCalabresaSimples } }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const data = await json(res);
    const calzone = MENU.lanches.find((l) => l.name === "Calzone")!;
    expect(data.total).toBe(calzone.price);

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].itens).toEqual(["Calzone Sabor: Calabresa"]);
    const itensDetalhados = pedidos[0].itensDetalhados as Array<Record<string, unknown>>;
    expect(itensDetalhados[0]).toMatchObject({ name: "Calzone", detail: "Sabor: Calabresa", price: calzone.price });
  });

  it("Macarronada: exige tamanho e recalcula pelo tamanho escolhido", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "", price: 0, qty: 1, simpleSelection: { productId: productIdMacarronada, sizeId: sizeGMacarronada } }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const data = await json(res);
    const macarronada = MENU.lanches.find((l) => l.name === "Macarronada de Carne")!;
    const sizeG = macarronada.sizes!.find((s) => s.code === "G")!;
    expect(data.total).toBe(sizeG.price);
  });

  it("rejeita seleção com productId inexistente e nunca cai para o caminho legado, mesmo com name/detail válidos", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 35, qty: 1, simpleSelection: { productId: "product-inexistente" } }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(400);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(15); // pedido original intacto
    expect(pedidos[0].revision).toBe(1);
  });

  it("simpleSelection: null com name/detail legado válido é tratado como formato estruturado inválido — 400, nunca cai no legado", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 35, qty: 1, simpleSelection: null }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(400);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(15); // pedido original intacto
    expect(pedidos[0].revision).toBe(1);
  });

  it.each([false, 0, "", "texto", 42, [], {}])(
    "simpleSelection malformado (%p) com name/detail legado válido é tratado como formato estruturado inválido — 400",
    async (valor) => {
      const editSessionId = await iniciarEdicao();
      const res = await salvar(req({
        statusToken: TOKEN, editSessionId, revision: 1,
        itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 35, qty: 1, simpleSelection: valor }],
        tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
      }), paramsFor(PEDIDO_ID));

      expect(res.status).toBe(400);
      const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos[0].total).toBe(15); // pedido original intacto
      expect(pedidos[0].revision).toBe(1);
    }
  );

  it("ausência total de simpleSelection continua 100% legado (name/detail funcionam normalmente)", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 999, qty: 1 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const data = await json(res);
    const calzone = MENU.lanches.find((l) => l.name === "Calzone")!;
    expect(data.total).toBe(calzone.price); // preço do servidor, nunca o 999 enviado pelo cliente
  });
});

describe("POST salvar — invariante do pagamento composto", () => {
  const itensDobrados = [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 2 }];

  async function iniciarEdicao() {
    seedPedido({ pagamento: "Pix (R$ 10,00) + Dinheiro (R$ 5,00)", troco: "Sem troco" });
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    return data.editSessionId as string;
  }

  it("recusa (400) um pagamento misto que deixou de fechar com o total recalculado", async () => {
    // Pedido de R$ 15 dividido 10 + 5. O cliente dobra a quantidade: o total
    // passa a R$ 30 e a divisao antiga nao fecha mais.
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: itensDobrados, tipoEntrega: "retirada",
      pagamento: "Pix (R$ 10,00) + Dinheiro (R$ 5,00)", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(400);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(15); // pedido intacto
    expect(pedidos[0].revision).toBe(1);
  });

  it("aceita o pagamento misto quando a divisao acompanha o novo total", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: itensDobrados, tipoEntrega: "retirada",
      pagamento: "Pix (R$ 20,00) + Dinheiro (R$ 10,00)", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(30);
    expect(pedidos[0].pagamento).toBe("Pix (R$ 20,00) + Dinheiro (R$ 10,00)");
  });

  it("normaliza a grafia legada com ponto decimal antes de gravar", async () => {
    // A tela de edicao antiga gravava "R$ 20.00"; os helpers de src/lib/bot.ts
    // leem o ponto como separador de milhar (R$ 2.000 na cobranca Pix).
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: itensDobrados, tipoEntrega: "retirada",
      pagamento: "Pix (R$ 20.00) + Dinheiro (R$ 10.00)", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pagamento).toBe("Pix (R$ 20,00) + Dinheiro (R$ 10,00)");
    expect((pedidos[0].pix as { valorEsperado: number }).valorEsperado).toBe(20);
  });

  it("pagamento simples continua passando sem invariante de soma", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: itensDobrados, tipoEntrega: "retirada", pagamento: "Pix",
    }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
  });
});

describe("POST salvar — snapshotOficial (Fase 3)", () => {
  const catalog = buildPizzaCatalog(MENU);
  const sizeIdG = catalog.sizes.find((s) => s.code === "G")!.id;
  const flavorCalabresa = catalog.flavors.find((f) => f.name === "Calabresa")!.id;
  const sizeG = MENU.sizes.find((s) => s.code === "G")!;
  const refri = MENU.bebidas.find((b) => b.name === "Refrigerante 2L")!;

  type PedidoComSnapshot = {
    total: number;
    descontoFidelidade?: number;
    snapshotOficial?: {
      itens: { kind: string; nome: string; quantidade: number; precoUnitarioCents: number; totalCents: number; selecao?: { sizeId: string; flavorIds: string[]; borderId?: string } }[];
      subtotalCents: number;
      descontoFidelidadeCents: number;
      taxaEntregaCents: number;
      totalCents: number;
      entrega: { tipo: string; bairro?: string };
    };
  };

  async function iniciarEdicao() {
    seedPedido();
    const res = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    return data.editSessionId as string;
  }

  it("edição recalcula o snapshot do zero (nunca reaproveita o snapshot anterior, que ficaria desatualizado)", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "pizza", name: "", price: 0, qty: 1, pizzaSelection: { sizeId: sizeIdG, flavorIds: [flavorCalabresa] } }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<PedidoComSnapshot>;
    const snapshot = pedidos[0].snapshotOficial!;
    expect(snapshot.itens).toEqual([{
      kind: "pizza", nome: "Pizza G", detalhe: "Calabresa", quantidade: 1,
      precoUnitarioCents: Math.round(sizeG.price * 100),
      totalCents: Math.round(sizeG.price * 100),
      selecao: { sizeId: sizeIdG, flavorIds: [flavorCalabresa] },
    }]);
    expect(snapshot.totalCents).toBe(Math.round(pedidos[0].total * 100));
  });

  it("preço adulterado no payload de edição não afeta o snapshot recalculado", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 999999, qty: 1 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<PedidoComSnapshot>;
    const item = pedidos[0].snapshotOficial!.itens[0];
    expect(item.precoUnitarioCents).toBe(Math.round(refri.price * 100));
  });

  it("seleção estruturada inválida na edição: 400 e o snapshot do pedido original permanece intocado", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 1, pizzaSelection: { sizeId: "size-inexistente", flavorIds: [flavorCalabresa] } }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(400);
    const pedidos = store.get("pedidos") as Array<PedidoComSnapshot>;
    expect(pedidos[0].snapshotOficial).toBeUndefined(); // pedido original (seedPedido) nunca teve snapshot
    expect(pedidos[0].total).toBe(15);
  });

  it("carrinho misto na edição (item novo por ID + item legado): snapshot traz os dois", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [
        { kind: "pizza", name: "", price: 0, qty: 1, pizzaSelection: { sizeId: sizeIdG, flavorIds: [flavorCalabresa] } },
        { kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 1 },
      ],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<PedidoComSnapshot>;
    const snapshot = pedidos[0].snapshotOficial!;
    expect(snapshot.itens).toHaveLength(2);
    expect(snapshot.itens[0].selecao).toBeDefined();
    expect(snapshot.itens[1]).not.toHaveProperty("selecao");
    expect(snapshot.subtotalCents).toBe(Math.round((sizeG.price + refri.price) * 100));
  });

  // Fase 3 (hardening): a edição preserva o desconto de fidelidade concedido
  // na criação (nunca revalida a reserva) — o snapshot precisa refletir
  // exatamente essa mesma derivação, a que hoje produz `subtotalComDesconto`.
  it("edição com desconto de fidelidade: descontoFidelidadeCents reflete o desconto preservado e a invariante vale", async () => {
    seedPedido({ descontoFidelidade: 10 });
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const editSessionId = (await json(iniciarRes)).editSessionId as string;

    // subtotal 3x Refrigerante 2L = R$45; desconto R$10 não é capado (45 > 10).
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 3 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<PedidoComSnapshot>;
    const pedido = pedidos[0];
    const snapshot = pedido.snapshotOficial!;
    expect(snapshot.subtotalCents).toBe(Math.round(refri.price * 3 * 100));
    expect(snapshot.descontoFidelidadeCents).toBe(1000);
    expect(snapshot.subtotalCents - snapshot.descontoFidelidadeCents + snapshot.taxaEntregaCents).toBe(snapshot.totalCents);
    expect(snapshot.totalCents).toBe(Math.round(pedido.total * 100));
  });

  it("edição com desconto MAIOR que o novo subtotal: descontoFidelidadeCents usa o valor efetivo (capado), igual a subtotalComDesconto — nunca o desconto bruto", async () => {
    seedPedido({ descontoFidelidade: 20 });
    const iniciarRes = await iniciar(req({ statusToken: TOKEN }), paramsFor(PEDIDO_ID));
    const editSessionId = (await json(iniciarRes)).editSessionId as string;

    // subtotal 1x Refrigerante 2L = R$15; desconto bruto é R$20 (> subtotal),
    // então o efetivo é capado em R$15 (subtotalComDesconto = 0).
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 1 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<PedidoComSnapshot>;
    const pedido = pedidos[0];
    const snapshot = pedido.snapshotOficial!;
    expect(pedido.total).toBe(0);
    expect(snapshot.subtotalCents).toBe(Math.round(refri.price * 100));
    expect(snapshot.descontoFidelidadeCents).toBe(Math.round(refri.price * 100)); // capado no subtotal, não 2000
    expect(snapshot.totalCents).toBe(0);
    expect(snapshot.subtotalCents - snapshot.descontoFidelidadeCents + snapshot.taxaEntregaCents).toBe(snapshot.totalCents);
  });

  it("edição sem desconto: descontoFidelidadeCents é 0", async () => {
    const editSessionId = await iniciarEdicao();
    const res = await salvar(req({
      statusToken: TOKEN, editSessionId, revision: 1,
      itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 1 }],
      tipoEntrega: "retirada", pagamento: "Dinheiro", troco: "Sem troco",
    }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<PedidoComSnapshot>;
    expect(pedidos[0].snapshotOficial!.descontoFidelidadeCents).toBe(0);
  });
});
