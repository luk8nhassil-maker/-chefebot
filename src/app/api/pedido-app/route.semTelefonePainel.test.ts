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

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifyToken: verifyTokenMock,
}));

import { POST } from "./route";
import { POST as POST_ADMIN } from "../admin/pedido-app/route";

function postReq(body: unknown, comSessaoAdmin = false) {
  return {
    json: async () => body,
    cookies: {
      get: (name: string) => (comSessaoAdmin && name === "auth-token" ? { value: "tok" } : undefined),
    },
  } as never;
}

const basePayloadSemTelefone = {
  cliente: "Cliente balcão",
  itens: [
    { kind: "simple", name: "Refrigerante 2L", detail: "", price: 1, qty: 1 },
  ],
  tipoEntrega: "retirada",
  pagamento: "Dinheiro",
  troco: "Sem troco",
  semTelefonePainel: true,
  clientRequestId: "req-sem-telefone-teste-0001",
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redisMock.set.mockImplementation(defaultSetImpl);
  redisMock.get.mockImplementation(defaultGetImpl);
  verifyTokenMock.mockReset();
  verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/pedido-app (cardápio público) — semTelefonePainel NUNCA é honrado, mesmo com cookie admin", () => {
  it("rejeita pedido sem telefone quando NÃO há sessão administrativa, mesmo com a flag no body", async () => {
    const res = await POST(postReq(basePayloadSemTelefone, false));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Telefone obrigatório");
  });

  it("rejeita pedido sem telefone quando a sessão do cookie não é administrativa", async () => {
    verifyTokenMock.mockResolvedValue({ username: "x", name: "X", role: "entregador" });
    const res = await POST(postReq(basePayloadSemTelefone, true));
    expect(res.status).toBe(400);
  });

  // REGRESSÃO DO INCIDENTE (hotfix): antes, um cookie `auth-token`
  // administrativo válido no MESMO navegador do cardápio público fazia
  // POST /api/pedido-app honrar `semTelefonePainel` — bastava um
  // atendente/admin ter o painel aberto na mesma sessão do navegador para o
  // pedido público burlar o telefone obrigatório. Rota pública agora NUNCA
  // lê a sessão administrativa, então nem chega a considerar a flag.
  it("cookie admin válido em rota PÚBLICA NÃO permite semTelefonePainel — continua exigindo telefone", async () => {
    const res = await POST(postReq(basePayloadSemTelefone, true));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Telefone obrigatório");
  });

  it("continua exigindo telefone quando a flag não foi enviada (rota pública, sem sessão)", async () => {
    const { semTelefonePainel, ...semFlag } = basePayloadSemTelefone;
    void semTelefonePainel;
    const res = await POST(postReq(semFlag, false));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/pedido-app (painel) — único lugar onde semTelefonePainel funciona", () => {
  it("aceita pedido sem telefone com sessão administrativa real e a flag explícita", async () => {
    const res = await POST_ADMIN(postReq(basePayloadSemTelefone, true));
    expect(res.status).toBe(200);
  });

  it("continua exigindo telefone quando a flag não foi enviada, mesmo com sessão administrativa", async () => {
    const { semTelefonePainel, ...semFlag } = basePayloadSemTelefone;
    void semTelefonePainel;
    const res = await POST_ADMIN(postReq(semFlag, true));
    expect(res.status).toBe(400);
  });

  it("rejeita com 401 quando não há sessão administrativa (nunca cai para comportamento público)", async () => {
    const res = await POST_ADMIN(postReq(basePayloadSemTelefone, false));
    expect(res.status).toBe(401);
  });

  it("rejeita com 401 quando a sessão do cookie não é administrativa (papel não autorizado)", async () => {
    verifyTokenMock.mockResolvedValue({ username: "x", name: "X", role: "entregador" });
    const res = await POST_ADMIN(postReq(basePayloadSemTelefone, true));
    expect(res.status).toBe(401);
  });
});
