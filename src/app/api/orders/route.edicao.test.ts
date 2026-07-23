import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  const valor = redisStore.has(key) ? redisStore.get(key) : null;
  // Clona via JSON round-trip — como o Redis real, que sempre desserializa
  // um payload novo a cada GET — para nunca devolver a mesma referência de
  // objeto armazenada. Sem isso, uma mutação local em memória (ex.:
  // `pedidos[index] = {...}`) vazaria silenciosamente para o "estado
  // persistido" do mock mesmo quando a escrita real nunca aconteceu,
  // mascarando os testes de reconciliação após timeout (mais abaixo).
  return Promise.resolve(valor === null ? null : JSON.parse(JSON.stringify(valor)));
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}
function defaultDelImpl(key: string) {
  const existed = redisStore.has(key);
  redisStore.delete(key);
  return Promise.resolve(existed ? 1 : 0);
}
// Dois scripts do lock global de pedidosStore.ts: compare-and-delete (1
// key, libera o lock) e a escrita cercada de "pedidos" via
// escreverPedidosCercado (2 keys: lock + "pedidos").
function defaultEvalImpl(_script: string, keys: string[], args: string[]) {
  if (keys.length >= 2) {
    const [lockKey, pedidosKey] = keys;
    const [token, jsonValor] = args;
    if (redisStore.get(lockKey) !== token) return Promise.resolve(0);
    redisStore.set(pedidosKey, JSON.parse(jsonValor));
    return Promise.resolve(1);
  }
  const [key] = keys;
  const [token] = args;
  if (redisStore.get(key) === token) {
    redisStore.delete(key);
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(defaultDelImpl),
    eval: vi.fn(defaultEvalImpl),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => (token === "token-admin" ? { username: "kellyne", name: "Kellyne", role: "admin" } : null)),
  };
});

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { PATCH, GET } from "./route";
import { redis } from "@/lib/redis";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_edicao_1",
    numero: 5,
    cliente: "Cliente Teste",
    telefone: "86999998888",
    itens: ["1x Pizza G Calabresa"],
    total: 50,
    status: "novo",
    horario: "12:00",
    endereco: "Retirada na loja",
    revision: 1,
    ...overrides,
  };
  redisStore.set("pedidos", [pedido]);
  return pedido;
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}
function getRequest() {
  return new NextRequest("http://localhost/api/orders", {
    headers: { cookie: "auth-token=token-admin" },
  });
}

beforeEach(() => {
  redisStore.clear();
  vi.clearAllMocks();
});

describe("PATCH /api/orders — bloqueio durante edição do cliente", () => {
  test("rejeita o aceite (novo -> em_preparo) com 409 enquanto o cliente edita", async () => {
    seedPedido({
      editStatus: "editing",
      editSessionId: "sessao-cliente",
      editExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const res = await PATCH(patchRequest({ id: "ped_edicao_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(409);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].status).toBe("novo"); // não muda o status
  });

  test("qualquer mudança de status (não só aceitar) é bloqueada durante a edição", async () => {
    seedPedido({
      status: "em_preparo",
      editStatus: "editing",
      editSessionId: "sessao-cliente",
      editExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const res = await PATCH(patchRequest({ id: "ped_edicao_1", status: "cancelado", silent: true }));
    expect(res.status).toBe(409);
  });

  test("aceite funciona normalmente quando não há edição em andamento", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_edicao_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(200);
  });

  test("libera o aceite automaticamente quando o lock já expirou (limpeza preguiçosa)", async () => {
    seedPedido({
      editStatus: "editing",
      editSessionId: "sessao-velha",
      editExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await PATCH(patchRequest({ id: "ped_edicao_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(200);
  });

  test("aceite concluído primeiro: uma tentativa de edição depois é bloqueada (verificado no endpoint de edição, aqui confirmamos que o aceite grava o novo status)", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_edicao_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(200);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].status).toBe("em_preparo");
  });
});

describe("PATCH /api/orders — reconciliação após exceção de rede na escrita cercada (achado MÉDIO da revisão externa do PR #252)", () => {
  test("EVAL lança (timeout), mas a escrita foi de fato aplicada: reconciliação confirma sucesso (nunca finge falha)", async () => {
    seedPedido();

    // Simula um EVAL que realmente aplica a escrita no Redis (efeito real
    // aconteceu do lado do servidor), mas cuja resposta ao cliente sofreu
    // timeout — exatamente o cenário que a reconciliação existe para tratar.
    vi.mocked(redis.eval).mockImplementationOnce(async (script: string, keys: string[], args: unknown[]) => {
      await defaultEvalImpl(script, keys, args as string[]);
      throw new Error("ECONNRESET");
    });

    const res = await PATCH(patchRequest({ id: "ped_edicao_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(200);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].status).toBe("em_preparo");
  });

  test("EVAL lança (timeout) e a releitura mostra estado divergente: nunca finge sucesso, retorna erro explícito de escrita incerta", async () => {
    seedPedido();

    // Simula um EVAL que lança SEM aplicar a escrita (falha real, ou
    // aplicada por outra tentativa concorrente com conteúdo diferente) — a
    // releitura de reconciliação nunca bate com o que se esperava gravar.
    vi.mocked(redis.eval).mockImplementationOnce(async () => {
      throw new Error("ECONNRESET");
    });

    const res = await PATCH(patchRequest({ id: "ped_edicao_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/não foi possível confirmar/i);
    // Estado nunca mudou: nem o status foi promovido a "em_preparo" (a
    // escrita nunca foi confirmada), nem uma segunda tentativa cega foi
    // aplicada por cima.
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].status).toBe("novo");
  });
});

describe("GET /api/orders — resposta do painel", () => {
  test("nunca expõe o editSessionId (token interno de bloqueio) ao painel", async () => {
    seedPedido({ editStatus: "editing", editSessionId: "segredo-nao-pode-vazar", editExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data[0]).not.toHaveProperty("editSessionId");
    expect(data[0].editStatus).toBe("editing");
  });

  test("limpa locks expirados ao listar, refletindo o estado atualizado no painel sem recarregar manualmente", async () => {
    seedPedido({ editStatus: "editing", editSessionId: "sessao-velha", editExpiresAt: new Date(Date.now() - 5000).toISOString() });
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data[0].editStatus).toBe("none");
  });
});
