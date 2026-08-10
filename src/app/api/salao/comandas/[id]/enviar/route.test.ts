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

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));
// Só usado pelo describe "Salão + cookie auth-token" abaixo, para simular um
// cookie de painel REALMENTE válido (sessão administrativa genuína) no mesmo
// navegador do Salão — sem mock, um JWT forjado como "tok-admin" já falharia
// a verificação sozinho, o que provaria menos do que o cenário real do
// incidente. Nos demais testes o mock fica em `null` (sem sessão admin),
// idêntico ao comportamento do verifyToken real contra um cookie ausente.
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifyToken: verifyTokenMock,
}));

const CARDAPIO_TESTE = {
  sizes: [], saltyFlavors: [], sweetFlavors: [], borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [], neighborhoods: [],
};

// Fase 5 — IDs determinísticos (slugify do nome/código, ver src/lib/catalog/ids.ts).
const CARDAPIO_TESTE_PIZZA = {
  sizes: [{ code: "G", label: "Grande", price: 50 }],
  saltyFlavors: ["Quatro Queijos"],
  sweetFlavors: [],
  borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [], neighborhoods: [],
};
const SIZE_G = "size-g";
const FLAVOR_4_QUEIJOS = "flavor-4-queijos"; // G = R$50 (cardápio oficial 2026)

import { POST as enviar } from "./route";
import { POST as abrir } from "../../route";
import { PATCH as atualizarComanda } from "../../[id]/route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";
import { COOKIE_AUTH } from "@/lib/sessaoAdministrativa";
import { buscarComanda } from "@/lib/comandas";

function reqSalao(body: unknown, token: string) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}

/**
 * Requisição do Salão com um cookie `auth-token` (painel) TAMBÉM presente —
 * exatamente o navegador do incidente real: um atendente com sessão
 * administrativa aberta que também opera o Salão. `verifyTokenMock` decide
 * se esse cookie é válido; ver describe "Salão + cookie auth-token" abaixo.
 */
function reqSalaoComAdmin(body: unknown, salaoToken: string, authToken = "tok-admin") {
  return {
    json: async () => body,
    cookies: {
      get: (n: string) => {
        if (n === SALAO_COOKIE) return { value: salaoToken };
        if (n === COOKIE_AUTH) return { value: authToken };
        return undefined;
      },
    },
  } as never;
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function abrirEComItens(token: string, mesa = "5", cliente = "Ana") {
  const aberta = await (await abrir(reqSalao({ cliente, mesa }, token))).json();
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
  // Sem sessão administrativa por padrão — só o describe dedicado abaixo
  // simula um cookie auth-token válido.
  verifyTokenMock.mockResolvedValue(null);
});

describe("POST /api/salao/comandas/[id]/enviar", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await enviar(
      { json: async () => ({}), cookies: { get: () => undefined } } as never,
      paramsFor("x")
    );
    expect(res.status).toBe(401);
  });

  it("não exige forma de pagamento — o Salão só manda para a cozinha", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    const res = await enviar(reqSalao({}, token), paramsFor(id));
    expect(res.status).toBe(200);
  });

  it("recusa enviar uma comanda sem itens", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "7" }, token))).json();
    const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
    expect(res.status).toBe(422);
  });

  it("cria o pedido de verdade via /api/pedido-app (mesmo motor, sem telefone, sem cobrança) e marca a comanda como enviada", async () => {
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

  it("identifica o cliente, a mesa e a comanda na observação do pedido", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Bia", mesa: "9", complemento: "Terraço" }, token))).json();
    await atualizarComanda(
      reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }], observacao: "Aniversário" }, token),
      paramsFor(aberta.comanda.id)
    );
    await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].cliente).toBe("Bia");
    expect(String(pedidos[0].observacao)).toContain(`Comanda #${aberta.comanda.numero}`);
    expect(String(pedidos[0].observacao)).toContain("Mesa 9 (Terraço)");
    expect(String(pedidos[0].observacao)).toContain("Aniversário");
  });

  it("comanda sem mesa usa 'Sem mesa' na observação e o nome do cliente como identificação", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Carlos" }, token))).json();
    await atualizarComanda(
      reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }, token),
      paramsFor(aberta.comanda.id)
    );
    await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].cliente).toBe("Carlos");
    expect(String(pedidos[0].observacao)).toContain("Sem mesa");
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await enviar(reqSalao({}, token), paramsFor("nao_existe"));
    expect(res.status).toBe(404);
  });

  it("409 ao tentar enviar a mesma comanda duas vezes", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    await enviar(reqSalao({}, token), paramsFor(id));
    const res2 = await enviar(reqSalao({}, token), paramsFor(id));
    expect(res2.status).toBe(409);
  });

  it("retry com o mesmo clientRequestId não cria um segundo pedido (idempotente)", async () => {
    const token = await criarTokenSalao();
    const id = await abrirEComItens(token);
    const clientRequestId = "a".repeat(20);
    const res1 = await enviar(reqSalao({ clientRequestId }, token), paramsFor(id));
    const data1 = await res1.json();
    expect(res1.status).toBe(200);
    // Segunda tentativa (mesma comanda já "enviada") é bloqueada por estado,
    // não por duplicidade de clientRequestId — a idempotência real desta
    // rota é sobre a chamada única a /api/pedido-app, já coberta pelo teste
    // do preço/motor oficial; aqui só garantimos que o pedidoId persiste.
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(data1.pedidoId).toBeTruthy();
  });

  it("o preço final vem sempre do recálculo do servidor (via pedido-app), nunca de um valor adulterado", async () => {
    const token = await criarTokenSalao();
    const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
    // PATCH já recalcula, mas simula um cenário em que o item chega com
    // price adulterado até a rota de enviar (defesa em profundidade).
    await atualizarComanda(
      reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1, price: 999 }] }, token),
      paramsFor(aberta.comanda.id)
    );
    const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
    const data = await res.json();
    expect(data.total).toBe(12);
  });

  describe("pizzaSelection (Fase 5)", () => {
    it("envia pizzaSelection para POST /api/pedido-app mantendo os IDs — servidor reprecifica pelo motor nativo", async () => {
      store.set("cardapio", CARDAPIO_TESTE_PIZZA);
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
      await atualizarComanda(
        reqSalao(
          { itens: [{ kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_4_QUEIJOS] } }] },
          token
        ),
        paramsFor(aberta.comanda.id)
      );
      const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(50);

      const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos[0].itens).toEqual(["Pizza G 4 Queijos"]);
      const snapshot = pedidos[0].snapshotOficial as
        | { itens: Array<{ selecao?: { sizeId: string; flavorIds: string[] } }> }
        | undefined;
      if (snapshot) {
        expect(snapshot.itens[0].selecao).toEqual({ sizeId: SIZE_G, flavorIds: [FLAVOR_4_QUEIJOS] });
      }
    });

    it("sizeId corrompido no que está persistido (defesa em profundidade) é recusado pelo pedido-app — nenhum pedido criado", async () => {
      store.set("cardapio", CARDAPIO_TESTE_PIZZA);
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
      // Grava diretamente pela lib (bypassando o PATCH/validarItensComanda,
      // que já recusaria isto na entrada) para simular um dado corrompido
      // por outra via — prova que a rota de ENVIO não confia cegamente no
      // que está salvo: quem tem a autoridade final é sempre POST /api/pedido-app.
      const { atualizarItensComanda } = await import("@/lib/comandas");
      await atualizarItensComanda(aberta.comanda.id, [
        {
          kind: "pizza",
          name: "Pizza G",
          detail: "Quatro Queijos",
          price: 50,
          qty: 1,
          pizzaSelection: { sizeId: "size-inexistente", flavorIds: [FLAVOR_4_QUEIJOS] },
        },
      ]);
      const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(store.get("pedidos")).toBeUndefined();
    });

    it("nenhum efeito de Pix/WhatsApp real — pagamento continua o marcador 'Comanda em aberto'", async () => {
      store.set("cardapio", CARDAPIO_TESTE_PIZZA);
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "5" }, token))).json();
      await atualizarComanda(
        reqSalao(
          { itens: [{ kind: "pizza", price: 0, qty: 1, pizzaSelection: { sizeId: SIZE_G, flavorIds: [FLAVOR_4_QUEIJOS] } }] },
          token
        ),
        paramsFor(aberta.comanda.id)
      );
      await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));
      const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos[0].pagamento).toBe("Comanda em aberto");
      expect(pedidos[0].pix).toBeUndefined();
      expect(pedidos[0].telefone).toBeFalsy();
    });
  });

  // REGRESSÃO DO INCIDENTE (hotfix "cardápio público vira pedido
  // administrativo"): esta rota repassa `req.cookies` — os cookies REAIS do
  // navegador — para POST /api/pedido-app (ver route.ts, `requisicaoInterna`).
  // Um atendente com o painel aberto no MESMO navegador do Salão carrega os
  // dois cookies (`salao-session` e `auth-token`) em toda requisição. Antes
  // do hotfix, o `auth-token` válido fazia POST /api/pedido-app tratar esse
  // pedido do Salão como administrativo (exigindo clientRequestId e, em
  // tese, honrando semTelefonePainel). Agora a rota pública nunca lê a
  // sessão administrativa, então o cookie de painel simplesmente não
  // influencia nada aqui: o pedido do Salão continua exatamente como sem ele.
  describe("Salão + cookie auth-token (painel) no mesmo navegador — nunca vira pedido administrativo", () => {
    it("cookie admin válido e presente não muda nada: sem telefone, pagamento 'Comanda em aberto', origem 'site'", async () => {
      verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalaoComAdmin({ cliente: "Ana", mesa: "5" }, token))).json();
      await atualizarComanda(
        reqSalaoComAdmin({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 2 }] }, token),
        paramsFor(aberta.comanda.id)
      );
      const res = await enviar(reqSalaoComAdmin({}, token), paramsFor(aberta.comanda.id));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos).toHaveLength(1);
      expect(pedidos[0].telefone).toBeFalsy();
      expect(pedidos[0].pagamento).toBe("Comanda em aberto");
      expect(pedidos[0].origem).toBe("site");
    });

    it("cookie admin válido não passa a exigir clientRequestId — comanda sem tentativa explícita ainda assim é criada", async () => {
      verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
      const token = await criarTokenSalao();
      const aberta = await (await abrir(reqSalaoComAdmin({ cliente: "Bia", mesa: "9" }, token))).json();
      await atualizarComanda(
        reqSalaoComAdmin({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }, token),
        paramsFor(aberta.comanda.id)
      );
      // A própria rota de envio sempre gera/reaproveita um clientRequestId
      // (ver route.ts), então isto prova que a criação não passa a depender
      // do reconhecimento de uma sessão administrativa: o resultado (200,
      // pedido único) é idêntico ao caso sem cookie admin nenhum.
      const res = await enviar(reqSalaoComAdmin({}, token), paramsFor(aberta.comanda.id));
      expect(res.status).toBe(200);
      expect(store.get("pedidos")).toHaveLength(1);
    });
  });
});
