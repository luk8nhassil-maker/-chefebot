import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Prova de integração ENTRE ROTAS DIFERENTES de produção — complementa os
// testes por escritor (cada rota já prova, isoladamente, que sua própria
// leitura-modificação-escrita de "pedidos" está protegida) com a prova de
// que o lock GLOBAL (src/lib/pedidosConcorrencia.ts) realmente serializa
// dois escritores DISTINTOS (módulos diferentes, handlers diferentes)
// operando ao mesmo tempo sobre pedidos DIFERENTES — o cenário exato que a
// auditoria original (docs/architecture/DECISAO-CONCORRENCIA-CHAVE-PEDIDOS.md)
// apontou como não coberto por nenhum mutex por-pedido/por-cliente existente.

const redisStore = new Map<string, unknown>();

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? deepClone(redisStore.get(key)) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
    // Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [chave] = keys;
      const [tokenEsperado] = args;
      if (redisStore.get(chave) === tokenEsperado) {
        redisStore.delete(chave);
        return 1;
      }
      return 0;
    }),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) =>
      token === "token-admin" ? { username: "kellyne", name: "Kellyne", role: "admin" } : null
    ),
  };
});

vi.mock("@/lib/evolutionApi", () => ({
  obterConfigEvolution: vi.fn(() => ({
    baseUrl: "https://evolution.test",
    apiKey: "key",
    instanceName: "chefebot",
    webhookUrl: "https://x.test/api/whatsapp",
  })),
}));

const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => ({ ok: true, json: async () => ({}) }));
vi.stubGlobal("fetch", fetchMock);

import { PATCH as ordersPatch } from "@/app/api/orders/route";
import { POST as arquivarPost } from "@/app/api/arquivar/route";
import { POST as resolverPost } from "@/app/api/resolver/route";
import { POST as finalizarPost } from "@/app/api/finalizar-atendimento/route";

function authedRequest(url: string, method: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function seedPedidos(pedidos: Record<string, unknown>[]) {
  redisStore.set("pedidos", pedidos);
}

beforeEach(() => {
  redisStore.clear();
  fetchMock.mockClear();
});

describe("Lock global de 'pedidos' — serialização ENTRE rotas de produção diferentes", () => {
  test("PATCH /api/orders (mudança de status) x POST /api/arquivar (arquivamento) em pedidos DIFERENTES, simultâneos: as duas mutações persistem", async () => {
    seedPedidos([
      { id: "cr-1001", numero: 1, cliente: "Cliente A", telefone: "5551111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "cr-1002", numero: 2, cliente: "Cliente B", telefone: "5552222222222", itens: ["x"], total: 20, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    const [resPatch, resArquivar] = await Promise.all([
      ordersPatch(authedRequest("http://localhost/api/orders", "PATCH", { id: "cr-1001", status: "em_preparo" })),
      arquivarPost(authedRequest("http://localhost/api/arquivar", "POST", { id: "cr-1002" })),
    ]);

    expect(resPatch.status).toBe(200);
    expect(resArquivar.status).toBe(200);

    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    const pedidoA = persistidos.find((p) => p.id === "cr-1001");
    const pedidoB = persistidos.find((p) => p.id === "cr-1002");

    expect(pedidoA?.status).toBe("em_preparo");
    expect(pedidoB?.isArchived).toBe(true);
  });

  test("POST /api/resolver x POST /api/finalizar-atendimento em pedidos escalonados DIFERENTES, simultâneos: as duas mutações persistem", async () => {
    seedPedidos([
      { id: "cr-2001", numero: 1, cliente: "Cliente C", telefone: "5553333333333", itens: ["Cliente precisa de atendimento humano"], total: 0, status: "novo", horario: "10:00", endereco: "Rua 3", escalonado: true },
      { id: "cr-2002", numero: 2, cliente: "Cliente D", telefone: "5554444444444", itens: ["x"], total: 30, status: "novo", horario: "10:00", endereco: "Rua 4", escalonado: true },
    ]);

    const [resResolver, resFinalizar] = await Promise.all([
      resolverPost(authedRequest("http://localhost/api/resolver", "POST", { phone: "5553333333333" })),
      finalizarPost(authedRequest("http://localhost/api/finalizar-atendimento", "POST", { id: "cr-2002", telefone: "5554444444444" })),
    ]);

    expect(resResolver.status).toBe(200);
    expect(resFinalizar.status).toBe(200);

    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    // cr-2001 é um ticket puro de escalonamento (itens só com o marcador) —
    // /api/resolver não deleta pedidos, só desmarca o escalonamento.
    const pedidoC = persistidos.find((p) => p.id === "cr-2001");
    const pedidoD = persistidos.find((p) => p.id === "cr-2002");

    expect(pedidoC?.escalonado).toBe(false);
    // cr-2002 não é um ticket puro (tem item real) e não estava marcado como
    // escalonado=false ainda, então /api/finalizar-atendimento cai no ramo
    // "remove flag escalonado" (mesmo pedido real na fila).
    expect(pedidoD?.escalonado).toBe(false);
  });
});
