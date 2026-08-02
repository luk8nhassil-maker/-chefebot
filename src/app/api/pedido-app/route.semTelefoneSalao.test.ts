import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, defaultSetImpl, defaultGetImpl, redisMock } = vi.hoisted(() => {
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
  return { store, defaultSetImpl, defaultGetImpl, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

import { POST } from "./route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function postReq(body: unknown, salaoToken?: string) {
  return {
    json: async () => body,
    cookies: {
      get: (n: string) => (salaoToken && n === SALAO_COOKIE ? { value: salaoToken } : undefined),
    },
  } as never;
}

const basePayloadMesa = {
  cliente: "Mesa 5",
  itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 1, qty: 1 }],
  tipoEntrega: "dine_in",
  pagamento: "Dinheiro",
  troco: "Sem troco",
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redisMock.set.mockImplementation(defaultSetImpl);
  redisMock.get.mockImplementation(defaultGetImpl);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/pedido-app — telefone dispensado por sessão do Salão", () => {
  it("rejeita pedido de mesa sem telefone quando NÃO há sessão do Salão", async () => {
    const res = await POST(postReq(basePayloadMesa));
    expect(res.status).toBe(400);
  });

  it("token do Salão adulterado/inválido continua exigindo telefone", async () => {
    const res = await POST(postReq(basePayloadMesa, "token-invalido-adulterado"));
    expect(res.status).toBe(400);
  });

  it("aceita pedido de mesa sem telefone com uma sessão do Salão real", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReq(basePayloadMesa, token));
    expect(res.status).toBe(200);
  });

  it("continua exigindo telefone no cardápio público mesmo com itens/forma iguais (sem sessão nenhuma)", async () => {
    const res = await POST(postReq({ ...basePayloadMesa, tipoEntrega: "retirada" }));
    expect(res.status).toBe(400);
  });
});
