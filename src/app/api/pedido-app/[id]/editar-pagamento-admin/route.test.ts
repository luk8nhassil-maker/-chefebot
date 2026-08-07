import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    // Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [chave] = keys;
      const [tokenEsperado] = args;
      if (store.get(chave) === tokenEsperado) {
        store.delete(chave);
        return 1;
      }
      return 0;
    }),
  };
  return { store, redisMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifyToken: verifyTokenMock,
}));

import { POST } from "./route";

const PEDIDO_ID = "ped_1";

function req(body: unknown, comSessaoAdmin = true) {
  return {
    json: async () => body,
    cookies: {
      get: (name: string) => (comSessaoAdmin && name === "auth-token" ? { value: "tok" } : undefined),
    },
  } as never;
}
function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: PEDIDO_ID,
    numero: 10,
    cliente: "Fulano de Tal",
    telefone: "86999998888",
    itens: ["1x Refrigerante 2L"],
    itensDetalhados: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 1 }],
    total: 15,
    status: "novo",
    horario: "12:00",
    endereco: "Retirada na loja",
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
    statusToken: "token-publico-abc",
    revision: 1,
    ...overrides,
  };
  store.set("pedidos", [pedido]);
  return pedido;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
});

describe("POST /api/pedido-app/[id]/editar-pagamento-admin — autorização", () => {
  it("bloqueia sem sessão administrativa", async () => {
    seedPedido();
    const res = await POST(req({ pagamento: "Pix" }, false), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(401);
  });

  it("bloqueia papel não administrativo (ex.: entregador)", async () => {
    seedPedido();
    verifyTokenMock.mockResolvedValue({ username: "x", name: "X", role: "entregador" });
    const res = await POST(req({ pagamento: "Pix" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(401);
  });

  it("aceita admin, atendente e dev", async () => {
    for (const role of ["admin", "atendente", "dev"]) {
      seedPedido();
      verifyTokenMock.mockResolvedValue({ username: "x", name: "X", role });
      const res = await POST(req({ pagamento: "Cartao" }), paramsFor(PEDIDO_ID));
      expect(res.status).toBe(200);
    }
  });
});

describe("POST /api/pedido-app/[id]/editar-pagamento-admin — validação", () => {
  it("rejeita sem forma de pagamento", async () => {
    seedPedido();
    const res = await POST(req({}), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(400);
  });

  it("pedido inexistente devolve 404", async () => {
    seedPedido();
    const res = await POST(req({ pagamento: "Cartao" }), paramsFor("ped_outro"));
    expect(res.status).toBe(404);
  });

  it("rejeita pedido cancelado", async () => {
    seedPedido({ status: "cancelado" });
    const res = await POST(req({ pagamento: "Cartao" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
  });

  it("dinheiro exige troco", async () => {
    seedPedido();
    const res = await POST(req({ pagamento: "Dinheiro" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(400);
    expect(String((await json(res)).error)).toMatch(/troco/i);
  });

  it("funciona em pedido já aceito pela loja (diferente da edição do cliente)", async () => {
    seedPedido({ status: "em_preparo" });
    const res = await POST(req({ pagamento: "Cartao" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/pedido-app/[id]/editar-pagamento-admin — proteção de pagamento confirmado", () => {
  it("bloqueia quando o Pix já foi confirmado (pixConfirmado)", async () => {
    seedPedido({ pagamento: "Pix", pixConfirmado: true, pix: { status: "confirmado" } });
    const res = await POST(req({ pagamento: "Dinheiro", troco: "Sem troco" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
    expect(String((await json(res)).error)).toMatch(/confirmado/i);
  });

  it("bloqueia quando pix.status === 'confirmado' mesmo sem a flag pixConfirmado", async () => {
    seedPedido({ pagamento: "Pix", pix: { status: "confirmado" } });
    const res = await POST(req({ pagamento: "Dinheiro", troco: "Sem troco" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
  });

  it("nunca marca uma nova cobrança Pix como confirmada — trocar para Pix sempre cria cobrança pendente", async () => {
    seedPedido({ pagamento: "Dinheiro", troco: "Sem troco" });
    const res = await POST(req({ pagamento: "Pix" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    const pix = pedidos[0].pix as Record<string, unknown>;
    expect(pix.status).toBe("pendente");
  });

  it("bloqueia enquanto o cliente está com a edição ativa (lock em janela válida)", async () => {
    const futuro = new Date(Date.now() + 60_000).toISOString();
    seedPedido({ editStatus: "editing", editExpiresAt: futuro });
    const res = await POST(req({ pagamento: "Cartao" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(409);
    expect(String((await json(res)).error)).toMatch(/edit/i);
  });

  it("permite editar quando o lock do cliente já expirou", async () => {
    const passado = new Date(Date.now() - 60_000).toISOString();
    seedPedido({ editStatus: "editing", editExpiresAt: passado });
    const res = await POST(req({ pagamento: "Cartao" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/pedido-app/[id]/editar-pagamento-admin — troca de forma preserva o resto", () => {
  it("Pix pendente → Dinheiro: substitui o Pix e nunca perde o registro anterior", async () => {
    seedPedido({
      pagamento: "Pix",
      pix: { status: "pendente", txid: "chefebot_ped_1", valorEsperado: 15, providerPaymentId: "mp-antigo" },
    });
    const res = await POST(req({ pagamento: "Dinheiro", troco: "Sem troco" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.pixSubstituido).toBe(true);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pix).toBeUndefined();
    const substituido = (pedidos[0].pixSubstituido as Array<Record<string, unknown>>)[0];
    expect(substituido.providerPaymentId).toBe("mp-antigo");
  });

  it("não mexe em itens, total ou endereço — só pagamento e troco", async () => {
    seedPedido({ total: 42, endereco: "Rua X, 10", itens: ["1x Pizza G"] });
    const res = await POST(req({ pagamento: "Cartao" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].total).toBe(42);
    expect(pedidos[0].endereco).toBe("Rua X, 10");
    expect(pedidos[0].itens).toEqual(["1x Pizza G"]);
  });

  it("registra editedBy: atendente e mantém o histórico anterior", async () => {
    seedPedido({ editHistory: [{ tipo: "salvo", horario: "2026-01-01T00:00:00.000Z", revisaoAnterior: 0, revisaoNova: 1 }] });
    const res = await POST(req({ pagamento: "Cartao" }), paramsFor(PEDIDO_ID));
    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].editedBy).toBe("atendente");
    expect((pedidos[0].editHistory as unknown[]).length).toBe(2);
  });

  it("recusa (400) pagamento misto que não fecha com o total do pedido", async () => {
    seedPedido({ total: 70 });
    const res = await POST(
      req({ pagamento: "Pix (R$ 30,00) + Dinheiro (R$ 30,00)", troco: "Sem troco" }),
      paramsFor(PEDIDO_ID)
    );
    expect(res.status).toBe(400);
  });

  it("aceita pagamento misto que fecha com o total do pedido", async () => {
    seedPedido({ total: 70 });
    const res = await POST(
      req({ pagamento: "Pix (R$ 40,00) + Dinheiro (R$ 30,00)", troco: "Sem troco" }),
      paramsFor(PEDIDO_ID)
    );
    expect(res.status).toBe(200);
  });

  it("nada muda (mesma forma e mesmo troco) devolve changed: false, sem gravar histórico novo", async () => {
    seedPedido({ pagamento: "Dinheiro", troco: "Sem troco" });
    const res = await POST(req({ pagamento: "Dinheiro", troco: "Sem troco" }), paramsFor(PEDIDO_ID));
    const data = await json(res);
    expect(data.changed).toBe(false);
    const pedidos = store.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].editedBy).toBeUndefined();
  });
});
