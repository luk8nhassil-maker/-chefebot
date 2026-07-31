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

const { verifyTokenMock, criarCobrancaPixMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  criarCobrancaPixMock: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: criarCobrancaPixMock }));
// Só o cookie decide se a requisição é administrativa; `verifyToken` é o
// único ponto de verdade e é o que mockamos aqui.
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifyToken: verifyTokenMock,
}));

import { POST } from "@/app/api/pedido-app/route";
import { getMENUDinamico } from "@/lib/menu.server";
import {
  listarProdutosManuais,
  construirItemManual,
  calcularTotalManual,
  adicionarAoCarrinho,
  selecaoVazia,
  adaptarCardapioParaMontagem,
  type MenuManual,
  type ProdutoManual,
} from "@/lib/montagemManual";
import type { ItemApp } from "@/lib/pedidoAppItens";
// Nomes reais das chaves — nunca reescritos à mão no teste, senão um erro de
// prefixo faria a limpeza virar no-op e o teste passaria pelo caminho errado.
import { chaveResultadoPedido, chaveResultadoTokenPedido } from "@/survival/pedidoIdempotencia";

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

/** Requisição pública: sem cookie de painel. */
function postReq(body: unknown) {
  return { json: async () => body, cookies: { get: () => undefined } } as never;
}

/** Requisição do painel: cookie presente, sessão resolvida por verifyToken. */
function postReqAdmin(body: unknown) {
  return {
    json: async () => body,
    cookies: { get: (nome: string) => (nome === "auth-token" ? { value: "token-de-painel" } : undefined) },
  } as never;
}

async function menuDoServidor(): Promise<MenuManual> {
  // Mesmo adaptador validado que o painel usa — nada de cast nem aqui.
  const menu = adaptarCardapioParaMontagem(await getMENUDinamico());
  if (!menu) throw new Error("cardápio de teste inválido");
  return menu;
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
  verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
  criarCobrancaPixMock.mockResolvedValue({
    provider: "mercadopago",
    providerPaymentId: "mp-teste",
    qrCode: "pix-copia-e-cola",
    qrCodeBase64: "base64",
    ticketUrl: "https://mp.test/t",
    idempotencyKey: "chefebot_pix_teste",
    statusOriginal: "pending",
  });
  // A flag global do Modo Sobrevivência fica DESLIGADA em todo este arquivo:
  // é exatamente essa a condição que estes testes precisam provar.
  expect(process.env.SURVIVAL_MODE_ENABLED).not.toBe("true");
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

// ===========================================================================
// Idempotência do pedido administrativo — COM A FLAG GLOBAL DESLIGADA.
//
// Estes testes são a prova de que a proteção passou a valer por SESSÃO, e não
// por `SURVIVAL_MODE_ENABLED`. O `beforeEach` afirma que a flag está
// desligada; se alguém a ligar para "fazer os testes passarem", o próprio
// beforeEach falha.
// ===========================================================================

const TENTATIVA = "montagem-manual-tentativa-0001";

describe("idempotência administrativa (SURVIVAL_MODE_ENABLED desligada)", () => {
  it("retry após resposta perdida devolve o MESMO pedido, sem criar um segundo", async () => {
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: TENTATIVA });

    const primeira = await POST(postReqAdmin(corpo));
    const r1 = await primeira.json();
    expect(r1.ok).toBe(true);
    expect(pedidosCriados()).toHaveLength(1);

    // A resposta se perdeu na rede; o atendente toca em "tentar de novo".
    const segunda = await POST(postReqAdmin(corpo));
    const r2 = await segunda.json();
    expect(r2.ok).toBe(true);
    expect(r2.pedidoId).toBe(r1.pedidoId);
    expect(r2.numero).toBe(r1.numero);
    expect(pedidosCriados()).toHaveLength(1);
  });

  it("duas requisições SIMULTÂNEAS da mesma tentativa criam um pedido só", async () => {
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: TENTATIVA });

    const [a, b] = await Promise.all([POST(postReqAdmin(corpo)), POST(postReqAdmin(corpo))]);
    const [ra, rb] = [await a.json(), await b.json()];

    // Uma vence o claim e cria; a outra ou recupera a mesma, ou responde
    // "ainda processando"/"incerto" — o que nunca pode acontecer é existirem
    // dois pedidos.
    expect(pedidosCriados()).toHaveLength(1);
    const criado = pedidosCriados()[0];
    for (const r of [ra, rb]) {
      if (r.ok) expect(r.pedidoId).toBe(String(criado.id));
    }
    expect([ra.ok, rb.ok]).toContain(true);
  });

  it("mesmo identificador com payload DIFERENTE é conflito (409), sem segundo pedido", async () => {
    const { itens } = await montarCarrinho();

    const primeira = await POST(postReqAdmin(payload(itens, { clientRequestId: TENTATIVA })));
    expect((await primeira.json()).ok).toBe(true);

    // Mesma tentativa, cliente diferente: não é retry, é reuso indevido.
    const segunda = await POST(
      postReqAdmin(payload(itens, { clientRequestId: TENTATIVA, cliente: "Outro Cliente" }))
    );
    expect(segunda.status).toBe(409);
    expect((await segunda.json()).ok).toBe(false);
    expect(pedidosCriados()).toHaveLength(1);
  });

  it("leitura incerta do Redis responde 503 e NÃO cria outro pedido", async () => {
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: TENTATIVA });

    expect((await (await POST(postReqAdmin(corpo))).json()).ok).toBe(true);
    expect(pedidosCriados()).toHaveLength(1);
    const antes = JSON.stringify(pedidosCriados());

    // O registro de resultado some (expirou) e a leitura da lista de pedidos
    // falha: o servidor não consegue provar se a tentativa já virou pedido.
    // Nesse estado, prosseguir criaria um duplicado — a resposta correta é
    // "não sei", nunca "crio outro".
    store.delete(chaveResultadoPedido(TENTATIVA));
    store.delete(chaveResultadoTokenPedido(TENTATIVA));
    expect(store.has(chaveResultadoPedido(TENTATIVA))).toBe(false);
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === "pedidos") throw new Error("leitura indisponivel");
      return defaultGetImpl(key);
    });

    const incerta = await POST(postReqAdmin(corpo));
    expect(incerta.status).toBe(503);
    const data = await incerta.json();
    expect(data.ok).toBe(false);
    expect(data.unresolved).toBe(true);

    redisMock.get.mockImplementation(defaultGetImpl);
    expect(pedidosCriados()).toHaveLength(1);
    expect(JSON.stringify(pedidosCriados())).toBe(antes);
  });

  it("retry não gera uma segunda cobrança Pix", async () => {
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: TENTATIVA, pagamento: "Pix" });

    await POST(postReqAdmin(corpo));
    const chamadasApos1 = criarCobrancaPixMock.mock.calls.length;
    await POST(postReqAdmin(corpo));
    await POST(postReqAdmin(corpo));

    expect(criarCobrancaPixMock.mock.calls.length).toBe(chamadasApos1);
    expect(pedidosCriados()).toHaveLength(1);
  });

  it("identificador presente porém malformado é rejeitado na sessão de painel", async () => {
    const { itens } = await montarCarrinho();
    const res = await POST(postReqAdmin(payload(itens, { clientRequestId: "curto" })));
    expect(res.status).toBe(400);
    expect(pedidosCriados()).toHaveLength(0);
  });

  it("sessão administrativa SEM identificador é rejeitada (400) — idempotência é obrigatória, não opcional", async () => {
    // O componente do painel sempre gera e envia um clientRequestId (ver
    // NovoPedidoManual.tsx); a ausência aqui só pode significar defeito ou
    // adulteração. Diferente do cardápio público, aqui NÃO existe fallback
    // "cria sem proteção".
    const { itens } = await montarCarrinho();
    const res = await POST(postReqAdmin(payload(itens)));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(pedidosCriados()).toHaveLength(0);
  });

  it("ausência do identificador no cardápio público continua nunca sendo rejeitada", async () => {
    // Compatibilidade preservada: cliente antigo do site que ainda não envia
    // clientRequestId continua criando pedido normalmente.
    const { itens } = await montarCarrinho();
    const res = await POST(postReq(payload(itens)));
    expect((await res.json()).ok).toBe(true);
    expect(pedidosCriados()).toHaveLength(1);
  });

  it("o cardápio público continua SEM proteção por sessão — comportamento inalterado", async () => {
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: TENTATIVA });

    // Sem cookie de painel e com a flag desligada, o clientRequestId é
    // ignorado exatamente como antes deste PR.
    await POST(postReq(corpo));
    await POST(postReq(corpo));
    expect(pedidosCriados()).toHaveLength(2);
  });
});

describe("origem do pedido", () => {
  it("pedido criado no painel é gravado com origem 'painel'", async () => {
    const { itens } = await montarCarrinho();
    // Sessão administrativa genuína: precisa do clientRequestId (obrigatório).
    await POST(postReqAdmin(payload(itens, { clientRequestId: "montagem-manual-tentativa-origem" })));
    expect(pedidosCriados()[0].origem).toBe("painel");
  });

  it("pedido do cardápio público continua com origem 'site'", async () => {
    const { itens } = await montarCarrinho();
    await POST(postReq(payload(itens)));
    expect(pedidosCriados()[0].origem).toBe("site");
  });

  it("usuário público NÃO consegue forjar origem administrativa pelo corpo", async () => {
    const { itens } = await montarCarrinho();
    await POST(
      postReq(
        payload(itens, {
          origem: "painel",
          origemAdmin: true,
          role: "admin",
          isAdmin: 1,
          sessao: { role: "atendente" },
        })
      )
    );
    expect(pedidosCriados()[0].origem).toBe("site");
  });

  it("cookie presente mas de papel NÃO administrativo continua sendo 'site'", async () => {
    verifyTokenMock.mockResolvedValue({ username: "ze", name: "Zé", role: "entregador" });
    const { itens } = await montarCarrinho();
    await POST(postReqAdmin(payload(itens)));
    expect(pedidosCriados()[0].origem).toBe("site");
  });

  it("cookie inválido/expirado continua sendo 'site' e sem idempotência por sessão", async () => {
    verifyTokenMock.mockResolvedValue(null);
    const { itens } = await montarCarrinho();
    const corpo = payload(itens, { clientRequestId: TENTATIVA });

    await POST(postReqAdmin(corpo));
    await POST(postReqAdmin(corpo));

    expect(pedidosCriados()).toHaveLength(2);
    expect(pedidosCriados()[0].origem).toBe("site");
  });
});
