import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

import { PATCH } from "./route";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_print_1",
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

beforeEach(() => {
  redisStore.clear();
  vi.clearAllMocks();
});

describe("PATCH /api/orders — proteção contra impressão automática duplicada", () => {
  test("o aceite (novo -> em_preparo) concede podeImprimirAutomaticamente: true", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_print_1", status: "em_preparo", silent: true }));
    const data = await res.json();
    expect(data.podeImprimirAutomaticamente).toBe(true);
  });

  test("uma segunda tentativa de aceitar o MESMO pedido nunca recebe a permissão de novo", async () => {
    seedPedido();
    await PATCH(patchRequest({ id: "ped_print_1", status: "em_preparo", silent: true }));

    // Simula uma segunda aba/dispositivo: o pedido já está em_preparo, mas
    // mesmo que alguém force outro PATCH novo->em_preparo (ex.: um retry que
    // desfez e refez o status), o claim já foi consumido — nunca imprime de
    // novo pelo mesmo evento.
    redisStore.set("pedidos", [{ ...seedPedido(), status: "novo" }]);
    const res2 = await PATCH(patchRequest({ id: "ped_print_1", status: "em_preparo", silent: true }));
    const data2 = await res2.json();
    expect(data2.podeImprimirAutomaticamente).toBeUndefined();
  });

  test("duas requisições concorrentes de aceite do mesmo pedido: só uma recebe a permissão", async () => {
    seedPedido();
    const [r1, r2] = await Promise.all([
      PATCH(patchRequest({ id: "ped_print_1", status: "em_preparo", silent: true })),
      PATCH(patchRequest({ id: "ped_print_1", status: "em_preparo", silent: true })),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    const concedidos = [d1.podeImprimirAutomaticamente, d2.podeImprimirAutomaticamente].filter(Boolean);
    expect(concedidos).toHaveLength(1);
  });

  test("transições que não são novo -> em_preparo nunca concedem a permissão", async () => {
    seedPedido({ status: "em_preparo" });
    const res = await PATCH(patchRequest({ id: "ped_print_1", status: "saiu_entrega", silent: true }));
    const data = await res.json();
    expect(data.podeImprimirAutomaticamente).toBeUndefined();
  });

  test("cancelar um pedido novo nunca concede a permissão de imprimir", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_print_1", status: "cancelado", silent: true }));
    const data = await res.json();
    expect(data.podeImprimirAutomaticamente).toBeUndefined();
  });

  test("a permissão fica registrada persistentemente (chave dedicada no Redis, não em memória)", async () => {
    seedPedido();
    await PATCH(patchRequest({ id: "ped_print_1", status: "em_preparo", silent: true }));
    expect(redisStore.has("pedido:auto-print-claim:ped_print_1")).toBe(true);
  });

  test("não altera pedido, preço nem pagamento — só concede/nega a permissão de imprimir", async () => {
    seedPedido({ pagamento: "Pix", total: 50 });
    await PATCH(patchRequest({ id: "ped_print_1", status: "em_preparo", silent: true }));
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pagamento).toBe("Pix");
    expect(pedidos[0].total).toBe(50);
  });
});
