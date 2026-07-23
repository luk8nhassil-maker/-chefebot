import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { GET } from "./route";

function req(pedidoId?: string) {
  const url = pedidoId ? `https://x.test/api/pedido-status?pedidoId=${pedidoId}` : "https://x.test/api/pedido-status";
  return new NextRequest(url);
}

describe("GET /api/pedido-status", () => {
  it("pedidoId ausente: 400", async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it("pedido não encontrado: 404", async () => {
    store.set("pedidos", []);
    const res = await GET(req("inexistente"));
    expect(res.status).toBe(404);
  });

  it("pedido encontrado: expõe só campos não-sensíveis", async () => {
    store.set("pedidos", [
      { id: "ped-1", numero: 10, status: "novo", itens: ["Pizza"], total: 50, cliente: "Fulano", telefone: "119" },
    ]);
    const res = await GET(req("ped-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ numero: 10, status: "novo", tipoEntrega: "delivery", itens: ["Pizza"], total: 50 });
    expect(JSON.stringify(body)).not.toContain("Fulano");
  });

  it("IDs duplicados: nunca escolhe um dos dois arbitrariamente — erro crítico sanitizado (503)", async () => {
    store.set("pedidos", [
      { id: "dup", numero: 1, status: "novo", itens: [], total: 10 },
      { id: "dup", numero: 2, status: "entregue", itens: [], total: 20 },
    ]);
    const res = await GET(req("dup"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("leitura de 'pedidos' indisponível: 503 recuperável, nunca 500 cru", async () => {
    redisMock.get.mockImplementationOnce(async () => {
      throw new Error("Redis indisponível (simulado)");
    });
    const res = await GET(req("qualquer"));
    expect(res.status).toBe(503);
  });
});
