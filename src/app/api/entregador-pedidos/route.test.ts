import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisInstanceMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisInstanceMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
  };
  return { store, redisInstanceMock };
});

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = redisInstanceMock.get;
    set = redisInstanceMock.set;
  },
}));

vi.mock("@/lib/fidelidade", () => ({
  creditarPontosPedidoEntregue: vi.fn(async () => {}),
}));

import { GET, POST } from "./route";

const ENTREGADOR_ATIVO = { id: "e1", nome: "João", telefone: "86988887777", ativo: true };
const ENTREGADOR_INATIVO = { id: "e2", nome: "Pedro", telefone: "86988887778", ativo: false };

function reqGET(entregadorId: string) {
  return new NextRequest(`https://x.test/api/entregador-pedidos?entregadorId=${entregadorId}`);
}

function reqPOST(body: unknown) {
  return new NextRequest("https://x.test/api/entregador-pedidos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.clear();
  redisInstanceMock.get.mockClear();
  redisInstanceMock.set.mockClear();
  store.set("entregadores", [ENTREGADOR_ATIVO, ENTREGADOR_INATIVO]);
});

describe("GET /api/entregador-pedidos", () => {
  it("400 sem entregadorId", async () => {
    const res = await GET(new NextRequest("https://x.test/api/entregador-pedidos"));
    expect(res.status).toBe(400);
  });

  it("404 para entregadorId inventado (não cadastrado)", async () => {
    const res = await GET(reqGET("nao-existe"));
    expect(res.status).toBe(404);
  });

  it("404 para entregador desativado", async () => {
    const res = await GET(reqGET(ENTREGADOR_INATIVO.id));
    expect(res.status).toBe(404);
  });

  it("200 para entregador ativo cadastrado, mesmo sem pedidos", async () => {
    const res = await GET(reqGET(ENTREGADOR_ATIVO.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("200 retorna os pedidos atribuídos ao entregador ativo", async () => {
    store.set(`entregador:pedidos:${ENTREGADOR_ATIVO.id}`, [
      { pedidoId: "p1", entregadorId: ENTREGADOR_ATIVO.id, status: "pendente" },
    ]);
    const res = await GET(reqGET(ENTREGADOR_ATIVO.id));
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].pedidoId).toBe("p1");
  });
});

describe("POST /api/entregador-pedidos", () => {
  it("400 com campos obrigatórios faltando", async () => {
    const res = await POST(reqPOST({ entregadorId: ENTREGADOR_ATIVO.id }));
    expect(res.status).toBe(400);
  });

  it("404 para entregadorId inventado — não executa nenhuma mutação", async () => {
    const res = await POST(reqPOST({ entregadorId: "fake", pedidoId: "p1", acao: "iniciar" }));
    expect(res.status).toBe(404);
    expect(redisInstanceMock.set).not.toHaveBeenCalled();
  });

  it("404 para entregador desativado — não executa nenhuma mutação", async () => {
    const res = await POST(reqPOST({ entregadorId: ENTREGADOR_INATIVO.id, pedidoId: "p1", acao: "iniciar" }));
    expect(res.status).toBe(404);
    expect(redisInstanceMock.set).not.toHaveBeenCalled();
  });

  it("404 quando o pedido não pertence a esse entregador", async () => {
    store.set(`entregador:pedidos:${ENTREGADOR_ATIVO.id}`, []);
    const res = await POST(reqPOST({ entregadorId: ENTREGADOR_ATIVO.id, pedidoId: "p-outro", acao: "iniciar" }));
    expect(res.status).toBe(404);
  });

  it("200: entregador ativo inicia a entrega do próprio pedido atribuído", async () => {
    store.set(`entregador:pedidos:${ENTREGADOR_ATIVO.id}`, [
      { pedidoId: "p1", entregadorId: ENTREGADOR_ATIVO.id, status: "pendente" },
    ]);
    const res = await POST(reqPOST({ entregadorId: ENTREGADOR_ATIVO.id, pedidoId: "p1", acao: "iniciar" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pedido.status).toBe("em_rota");
  });

  it("200: entregador ativo confirma entrega e credita fidelidade sem quebrar em caso de falha", async () => {
    store.set(`entregador:pedidos:${ENTREGADOR_ATIVO.id}`, [
      { pedidoId: "p1", entregadorId: ENTREGADOR_ATIVO.id, status: "em_rota" },
    ]);
    store.set("pedidos", [{ id: "p1", status: "em_rota", telefone: "86988880000", total: 50 }]);
    const res = await POST(reqPOST({ entregadorId: ENTREGADOR_ATIVO.id, pedidoId: "p1", acao: "entregar" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pedido.status).toBe("entregue");
  });

  it("400 para ação inválida", async () => {
    store.set(`entregador:pedidos:${ENTREGADOR_ATIVO.id}`, [
      { pedidoId: "p1", entregadorId: ENTREGADOR_ATIVO.id, status: "pendente" },
    ]);
    const res = await POST(reqPOST({ entregadorId: ENTREGADOR_ATIVO.id, pedidoId: "p1", acao: "voar" }));
    expect(res.status).toBe(400);
  });
});
