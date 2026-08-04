import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ESCALONAMENTO_TTL_MS } from "@/lib/escalonamento";

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
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

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(defaultDelImpl),
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
