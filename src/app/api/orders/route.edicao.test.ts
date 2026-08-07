import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  if (!redisStore.has(key)) return Promise.resolve(null);
  return Promise.resolve(JSON.parse(JSON.stringify(redisStore.get(key))));
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
// Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
// src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
function defaultEvalImpl(_script: string, keys: string[], args: string[]) {
  const [chave] = keys;
  const [tokenEsperado] = args;
  if (redisStore.get(chave) === tokenEsperado) {
    redisStore.delete(chave);
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
