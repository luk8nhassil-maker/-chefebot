import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ESCALONAMENTO_TTL_MS } from "@/lib/escalonamento";

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

import { GET } from "./route";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_escalonado_1",
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

function getRequest() {
  return new NextRequest("http://localhost/api/orders", {
    headers: { cookie: "auth-token=token-admin" },
  });
}

beforeEach(() => {
  redisStore.clear();
  vi.clearAllMocks();
});

describe("GET /api/orders — escalonamento expira sozinho (sem alerta preso na tela)", () => {
  test("mantém escalonado=true e o pedido em 'novo' enquanto dentro do prazo", async () => {
    seedPedido({ escalonado: true, horarioEscalonado: Date.now() - 1000 });
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data[0].escalonado).toBe(true);
    expect(data[0].status).toBe("novo");
  });

  test("depois do prazo, escalonado vira false sozinho ao listar — sem mudar o status do pedido", async () => {
    seedPedido({ escalonado: true, horarioEscalonado: Date.now() - ESCALONAMENTO_TTL_MS - 1 });
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data[0].escalonado).toBe(false);
    expect(data[0].status).toBe("novo"); // continua "novo": só some o alerta, o pedido segue no fluxo normal

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].escalonado).toBe(false); // persiste — não volta a aparecer no próximo GET
  });

  test("um pedido já resolvido manualmente (escalonado=false) não é afetado", async () => {
    seedPedido({ escalonado: false, status: "em_preparo" });
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data[0].escalonado).toBe(false);
    expect(data[0].status).toBe("em_preparo");
  });
});

describe("GET /api/orders — pedido que é só um chamado de atendimento humano (sem carrinho) some sozinho", () => {
  function seedPlaceholder(overrides: Record<string, unknown> = {}) {
    return seedPedido({
      itens: ["Cliente precisa de atendimento humano"],
      total: 0,
      escalonado: true,
      horarioEscalonado: Date.now() - ESCALONAMENTO_TTL_MS - 1,
      ...overrides,
    });
  }

  test("some da lista principal (arquivado) depois do prazo — nunca aparece com botão de 'Começar a fazer'", async () => {
    seedPlaceholder();
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data).toHaveLength(0);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].isArchived).toBe(true);
    expect(pedidos[0].status).toBe("novo"); // arquivado, não "entregue" — não aparece em Prontos
  });

  test("continua visível com o alerta enquanto dentro do prazo", async () => {
    seedPlaceholder({ horarioEscalonado: Date.now() - 1000 });
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].escalonado).toBe(true);
  });

  test("limpa retroativamente um placeholder que já tinha ficado quebrado (escalonado=false, sem carrinho) antes desta correção", async () => {
    seedPlaceholder({ escalonado: false, horarioEscalonado: undefined });
    const res = await GET(getRequest());
    const data = await res.json();
    expect(data).toHaveLength(0);
  });

  test("aparece em ?arquivados=true depois de limpo — nada é apagado", async () => {
    seedPlaceholder();
    await GET(getRequest());
    const res = await GET(new NextRequest("http://localhost/api/orders?arquivados=true", { headers: { cookie: "auth-token=token-admin" } }));
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].archivedReason).toBe("atendimento_humano_sem_pedido");
  });
});
