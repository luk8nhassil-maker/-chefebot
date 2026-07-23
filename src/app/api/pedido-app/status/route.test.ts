import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { GET } from "./route";

function getReq(query: string) {
  return {
    nextUrl: new URL(`https://chefebot.test/api/pedido-app/status${query}`),
  } as never;
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("GET /api/pedido-app/status", () => {
  it("pedido Pix pendente retorna aguardando_pix", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 123,
      statusToken: "token-ok",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pix: { status: "pendente", valorEsperado: 50 },
      telefone: "(99) 99999-9999",
      endereco: "Rua Secreta",
    }]);

    const res = await GET(getReq("?id=pedido-1&token=token-ok"));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: "pedido-1",
      numero: 123,
      pagamentoStatus: "aguardando_pix",
      pixConfirmado: false,
      pix: { status: "pendente" },
    });
    expect(body).not.toHaveProperty("telefone");
    expect(body).not.toHaveProperty("endereco");
  });

  it("pedido Pix confirmado retorna pago", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      statusToken: "token-ok",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pixConfirmado: true,
      pix: { status: "confirmado", confirmadoPor: "comprovante" },
    }]);

    const body = await json(await GET(getReq("?id=pedido-1&token=token-ok")));

    expect(body).toMatchObject({
      pagamentoStatus: "pago",
      pixConfirmado: true,
      pix: { status: "confirmado", confirmadoPor: "comprovante" },
    });
  });

  it("pedido em revisao retorna em_revisao", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      statusToken: "token-ok",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pix: { status: "em_revisao", evidencia: { decisao: "revisar", motivos: ["x"] } },
    }]);

    const body = await json(await GET(getReq("?id=pedido-1&token=token-ok")));

    expect(body).toMatchObject({
      pagamentoStatus: "em_revisao",
      pixConfirmado: false,
      pix: { status: "em_revisao", evidencia: { decisao: "revisar" } },
    });
  });

  it("pedido suspeito retorna conferencia_manual", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      statusToken: "token-ok",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pix: { status: "suspeito", evidencia: { decisao: "suspeito" } },
    }]);

    const body = await json(await GET(getReq("?id=pedido-1&token=token-ok")));

    expect(body).toMatchObject({
      pagamentoStatus: "conferencia_manual",
      pixConfirmado: false,
      pix: { status: "suspeito", evidencia: { decisao: "suspeito" } },
    });
  });

  it("token invalido nao retorna pedido", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      statusToken: "token-ok",
      status: "novo",
      total: 50,
      pagamento: "Pix",
    }]);

    const res = await GET(getReq("?id=pedido-1&token=errado"));
    const body = await json(res);

    expect(res.status).toBe(404);
    expect(body).not.toHaveProperty("id");
  });

  it("id inexistente retorna 404 seguro", async () => {
    store.set("pedidos", []);

    const res = await GET(getReq("?id=nao-existe&token=token-ok"));

    expect(res.status).toBe(404);
  });

  it("IDs duplicados: nunca escolhe um dos dois arbitrariamente — erro crítico sanitizado (503), nunca expõe o status errado", async () => {
    store.set("pedidos", [
      { id: "dup", statusToken: "token-a", status: "novo", total: 10, pagamento: "Pix" },
      { id: "dup", statusToken: "token-b", status: "entregue", total: 20, pagamento: "Dinheiro" },
    ]);

    const res = await GET(getReq("?id=dup&token=token-a"));
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("status");
  });

  it("leitura de 'pedidos' indisponível: 503 recuperável, nunca 500 cru nem 404 enganoso", async () => {
    redisMock.get.mockImplementationOnce(async () => {
      throw new Error("Redis indisponível (simulado)");
    });
    const res = await GET(getReq("?id=qualquer&token=qualquer"));
    expect(res.status).toBe(503);
  });
});
