import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { GET } from "./route";

function getReq(query: string) {
  return {
    nextUrl: new URL(`http://localhost/api/pedido-status${query}`),
  } as never;
}

const pedidoPixPendente = {
  id: "1001",
  numero: 45,
  cliente: "Lucas Brito",
  telefone: "(99) 99999-9999",
  endereco: "Rua das Flores, 123",
  status: "novo",
  tipoEntrega: "retirada",
  itens: ["Pizza G Calabresa"],
  total: 52,
  pagamento: "Pix",
  statusToken: "token-secreto-abc",
  pix: { status: "pendente", valorEsperado: 52 },
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("pedidos", [pedidoPixPendente]);
});

describe("GET /api/pedido-status", () => {
  it("sem pedidoId retorna 400", async () => {
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
  });

  it("pedido inexistente retorna 404", async () => {
    const res = await GET(getReq("?pedidoId=9999"));
    expect(res.status).toBe(404);
  });

  it("sem token retorna status basico sem bloco pix (compat /rastrear)", async () => {
    const res = await GET(getReq("?pedidoId=1001"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      numero: 45,
      status: "novo",
      tipoEntrega: "retirada",
      itens: ["Pizza G Calabresa"],
      total: 52,
    });
    expect(data.pix).toBeUndefined();
  });

  it("token invalido nao retorna bloco pix", async () => {
    const res = await GET(getReq("?pedidoId=1001&token=token-errado"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.pix).toBeUndefined();
  });

  it("token valido com pix pendente retorna estado aguardando", async () => {
    const res = await GET(getReq("?pedidoId=1001&token=token-secreto-abc"));
    const data = await res.json();

    expect(data.pix).toEqual({ estado: "aguardando" });
  });

  it("token valido com pix confirmado retorna pago com origem", async () => {
    store.set("pedidos", [{
      ...pedidoPixPendente,
      pixConfirmado: true,
      pix: { status: "confirmado", confirmadoPor: "comprovante" },
    }]);

    const res = await GET(getReq("?pedidoId=1001&token=token-secreto-abc"));
    const data = await res.json();

    expect(data.pix).toEqual({ estado: "pago", confirmadoPor: "comprovante" });
  });

  it("token valido com pix em revisao retorna em_analise", async () => {
    store.set("pedidos", [{ ...pedidoPixPendente, pix: { status: "em_revisao" } }]);

    const res = await GET(getReq("?pedidoId=1001&token=token-secreto-abc"));
    const data = await res.json();

    expect(data.pix).toEqual({ estado: "em_analise" });
  });

  it("pix suspeito aparece para o cliente como em_analise, nunca como suspeito", async () => {
    store.set("pedidos", [{ ...pedidoPixPendente, pix: { status: "suspeito" } }]);

    const res = await GET(getReq("?pedidoId=1001&token=token-secreto-abc"));
    const data = await res.json();

    expect(data.pix).toEqual({ estado: "em_analise" });
    expect(JSON.stringify(data)).not.toContain("suspeito");
  });

  it("pedido sem pix (dinheiro/cartao) nao retorna bloco pix mesmo com token", async () => {
    store.set("pedidos", [{
      id: "1001",
      numero: 45,
      status: "novo",
      itens: ["Pizza G"],
      total: 52,
      pagamento: "Dinheiro",
      statusToken: "token-secreto-abc",
    }]);

    const res = await GET(getReq("?pedidoId=1001&token=token-secreto-abc"));
    const data = await res.json();

    expect(data.pix).toBeUndefined();
  });

  it("nunca expoe dados sensiveis: cliente, telefone, endereco, pagamento, statusToken", async () => {
    const res = await GET(getReq("?pedidoId=1001&token=token-secreto-abc"));
    const data = await res.json();
    const chaves = Object.keys(data);

    expect(chaves).not.toContain("cliente");
    expect(chaves).not.toContain("telefone");
    expect(chaves).not.toContain("endereco");
    expect(chaves).not.toContain("pagamento");
    expect(chaves).not.toContain("statusToken");
    expect(JSON.stringify(data)).not.toContain("token-secreto-abc");
    expect(JSON.stringify(data)).not.toContain("99999");
  });

  it("pedido antigo sem statusToken nunca casa com token (nem vazio)", async () => {
    store.set("pedidos", [{ ...pedidoPixPendente, statusToken: undefined }]);

    const res = await GET(getReq("?pedidoId=1001&token="));
    const data = await res.json();

    expect(data.pix).toBeUndefined();
  });
});
