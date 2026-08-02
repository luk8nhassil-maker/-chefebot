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
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

const CARDAPIO_TESTE = {
  sizes: [], saltyFlavors: [], sweetFlavors: [], borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [], neighborhoods: [],
};

import { POST as enviarRodada } from "./route";
import { POST as criarRodadaRoute } from "../../route";
import { PATCH as atualizarRodada } from "../route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";
import { abrirComanda, buscarComanda, marcarComandaEnviada, type Comanda } from "@/lib/comandas";

function req(token: string, body: unknown) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}
function reqSemSessao(body: unknown = {}) {
  return { json: async () => body, cookies: { get: () => undefined } } as never;
}
function paramsFor(id: string, rodadaId: string) {
  return { params: Promise.resolve({ id, rodadaId }) };
}

async function abrirComandaOk(mesa: string): Promise<Comanda> {
  const r = await abrirComanda(mesa);
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

async function comandaComRodada2ComItens(token: string, mesa = "5") {
  const c = await abrirComandaOk(mesa);
  await marcarComandaEnviada(c.id, "ped_1", 1);
  const criada = await (await criarRodadaRoute(req(token, {}), { params: Promise.resolve({ id: c.id }) })).json();
  const rodadaId = criada.rodada.id as string;
  await atualizarRodada(
    req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 2 }] }),
    paramsFor(c.id, rodadaId)
  );
  return { comandaId: c.id, rodadaId, rodada1Id: criada.comanda.rodadas[0].id as string };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/salao/comandas/[id]/rodadas/[rodadaId]/enviar", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await enviarRodada(reqSemSessao({ clientRequestId: "a".repeat(20) }), paramsFor("x", "y"));
    expect(res.status).toBe(401);
  });

  it("exige clientRequestId", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    const res = await enviarRodada(req(token, {}), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(400);
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await enviarRodada(req(token, { clientRequestId: "a".repeat(20) }), paramsFor("nao_existe", "y"));
    expect(res.status).toBe(404);
  });

  it("404 para rodada inexistente", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const res = await enviarRodada(req(token, { clientRequestId: "a".repeat(20) }), paramsFor(c.id, "rodada_x"));
    expect(res.status).toBe(404);
  });

  it("422 para rodada vazia", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const criada = await (await criarRodadaRoute(req(token, {}), { params: Promise.resolve({ id: c.id }) })).json();
    const res = await enviarRodada(req(token, { clientRequestId: "a".repeat(20) }), paramsFor(c.id, criada.rodada.id));
    expect(res.status).toBe(422);
  });

  it("cria o pedido oficial da rodada via /api/pedido-app e marca a rodada como enviada, mantendo a comanda aberta", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    const res = await enviarRodada(req(token, { clientRequestId: "a".repeat(20) }), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pedidoId).toBeTruthy();
    expect(data.rodada.status).toBe("enviada");

    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].cliente).toBe("Mesa 5");
    expect(pedidos[0].tipoEntrega).toBe("dine_in");
    expect(String(pedidos[0].observacao)).toContain("Rodada 2");

    const comanda = await buscarComanda(comandaId);
    expect(comanda?.status).toBe("enviada"); // bookkeeping da Rodada 1 — comanda continua "aberta ao atendimento"
    const rodada2 = comanda?.rodadas?.find((r) => r.id === rodadaId);
    expect(rodada2?.status).toBe("enviada");
    expect(rodada2?.pedidoId).toBe(String(data.pedidoId));
  });

  it("cada rodada gera um pedido só com os itens daquela rodada (nunca os itens acumulados)", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    await enviarRodada(req(token, { clientRequestId: "a".repeat(20) }), paramsFor(comandaId, rodadaId));
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    const itensPedidoRodada2 = pedidos[0].itensDetalhados as unknown[];
    expect(itensPedidoRodada2).toHaveLength(1);
  });

  it("retry com o mesmo clientRequestId não cria um segundo pedido (idempotente)", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    const clientRequestId = "b".repeat(20);
    const res1 = await enviarRodada(req(token, { clientRequestId }), paramsFor(comandaId, rodadaId));
    const data1 = await res1.json();
    const res2 = await enviarRodada(req(token, { clientRequestId }), paramsFor(comandaId, rodadaId));
    const data2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(data2.pedidoId).toBe(data1.pedidoId);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
  });

  it("409 ao tentar enviar a mesma rodada com um clientRequestId diferente depois de já enviada", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    await enviarRodada(req(token, { clientRequestId: "c".repeat(20) }), paramsFor(comandaId, rodadaId));
    const res2 = await enviarRodada(req(token, { clientRequestId: "d".repeat(20) }), paramsFor(comandaId, rodadaId));
    expect(res2.status).toBe(409);
  });

  it("409 ao tentar enviar uma rodada já enviada por outra requisição concorrente (mesmo id de reivindicação já em uso)", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodada1Id } = await comandaComRodada2ComItens(token);
    // rodada1Id já está "enviada" (Rodada 1, criada pelo fluxo antigo)
    const res = await enviarRodada(req(token, { clientRequestId: "e".repeat(20) }), paramsFor(comandaId, rodada1Id));
    expect(res.status).toBe(409);
  });

  it("bloqueia enviar rodada de comanda fechada", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    // Fecha diretamente via lib para simular o estado, sem depender da rota de fechar
    const { fecharComanda } = await import("@/lib/comandas");
    await fecharComanda(comandaId);
    const res = await enviarRodada(req(token, { clientRequestId: "f".repeat(20) }), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(409);
  });

  it("preço sempre recalculado no servidor, nunca confiado do valor salvo", async () => {
    const token = await criarTokenSalao();
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const criada = await (await criarRodadaRoute(req(token, {}), { params: Promise.resolve({ id: c.id }) })).json();
    const rodadaId = criada.rodada.id as string;
    await atualizarRodada(
      req(token, { itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1, price: 999 }] }),
      paramsFor(c.id, rodadaId)
    );
    const res = await enviarRodada(req(token, { clientRequestId: "g".repeat(20) }), paramsFor(c.id, rodadaId));
    const data = await res.json();
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    const itens = pedidos[0].itensDetalhados as Array<{ price: number }>;
    expect(data.ok).toBe(true);
    expect(itens[0].price).toBe(12);
  });

  it("Rodada 1 permanece intacta ao enviar a Rodada 2", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId, rodada1Id } = await comandaComRodada2ComItens(token);
    await enviarRodada(req(token, { clientRequestId: "h".repeat(20) }), paramsFor(comandaId, rodadaId));
    const comanda = await buscarComanda(comandaId);
    const rodada1 = comanda?.rodadas?.find((r) => r.id === rodada1Id);
    expect(rodada1?.pedidoId).toBe("ped_1");
    expect(rodada1?.status).toBe("enviada");
  });

  it("permite criar uma nova rodada (Rodada 3) depois que a Rodada 2 foi enviada", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    await enviarRodada(req(token, { clientRequestId: "i".repeat(20) }), paramsFor(comandaId, rodadaId));
    const res = await criarRodadaRoute(req(token, {}), { params: Promise.resolve({ id: comandaId }) });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.rodada.numero).toBe(3);
  });

  it("falha na criação do pedido preserva a rodada para retry (não perde os itens)", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    // Simula o item saindo do cardápio entre o rascunho e o envio — a
    // reprecificação em profundidade da rota rejeita antes de chegar no
    // motor de pedido.
    store.set("cardapio", { ...CARDAPIO_TESTE, bebidas: [{ name: "Água com gás", price: 6 }] });
    const res = await enviarRodada(req(token, { clientRequestId: "j".repeat(20) }), paramsFor(comandaId, rodadaId));
    expect(res.status).toBe(422);

    const comanda = await buscarComanda(comandaId);
    const rodada = comanda?.rodadas?.find((r) => r.id === rodadaId);
    expect(rodada?.status).toBe("falha_envio");
    expect(rodada?.itens).toHaveLength(1);

    // Retry com o mesmo clientRequestId depois de restaurar o cardápio
    store.set("cardapio", CARDAPIO_TESTE);
    const res2 = await enviarRodada(req(token, { clientRequestId: "j".repeat(20) }), paramsFor(comandaId, rodadaId));
    expect(res2.status).toBe(200);
  });

  it("não altera Delivery/Retirada/WhatsApp/Pix — pagamento gravado é só um marcador de conta em aberto", async () => {
    const token = await criarTokenSalao();
    const { comandaId, rodadaId } = await comandaComRodada2ComItens(token);
    await enviarRodada(req(token, { clientRequestId: "k".repeat(20) }), paramsFor(comandaId, rodadaId));
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pagamento).toBe("Comanda em aberto");
    expect(pedidos[0].telefone).toBeFalsy();
  });
});
