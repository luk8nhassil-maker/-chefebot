import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock, authMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
    },
    authMock: vi.fn(),
  };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/entregadorAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/entregadorAuth")>();
  return { ...actual, autenticarEntregador: authMock };
});

import { GET, POST } from "./route";

const authA = {
  entregador: { id: "ent-a", nome: "A", telefone: "86999990000", ativo: true },
  sessao: { entregadorId: "ent-a", nome: "A", tipo: "entregador", issuedAt: 1, expiresAt: 2 },
};

function postRequest(body: unknown) {
  return new NextRequest("https://x.test/api/localizacao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedAutorizado(statusFila = "em_rota", entregadorId = "ent-a") {
  store.set("entregador:pedidos:ent-a", [{ pedidoId: "ped-1", status: statusFila }]);
  store.set("pedidos", [{ id: "ped-1", status: "saiu_entrega", entregador: { id: entregadorId } }]);
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  authMock.mockResolvedValue(authA);
});

describe("POST /api/localizacao", () => {
  it("sem sessão retorna 401 e não escreve", async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(postRequest({ pedidoId: "ped-1", lat: -6, lng: -44 }))).status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("entregadorId do body é ignorado e a sessão assina a localização", async () => {
    seedAutorizado();
    const res = await POST(postRequest({ pedidoId: "ped-1", entregadorId: "ent-b", lat: -6.1, lng: -44.2 }));
    expect(res.status).toBe(200);
    expect(store.get("loc:ped-1")).toMatchObject({ entregadorId: "ent-a", lat: -6.1, lng: -44.2 });
  });

  it("não atualiza pedido alheio e não cria rate/localização", async () => {
    seedAutorizado("em_rota", "ent-b");
    expect((await POST(postRequest({ pedidoId: "ped-1", lat: -6, lng: -44 }))).status).toBe(403);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it.each([
    ["string", "-6", -44],
    ["NaN", Number.NaN, -44],
    ["Infinity", Number.POSITIVE_INFINITY, -44],
    ["latitude", 91, -44],
    ["longitude", -6, 181],
  ])("rejeita coordenada inválida: %s", async (_caso, lat, lng) => {
    expect((await POST(postRequest({ pedidoId: "ped-1", lat, lng }))).status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("limita frequência sem sobrescrever a localização anterior", async () => {
    seedAutorizado();
    expect((await POST(postRequest({ pedidoId: "ped-1", lat: -6, lng: -44 }))).status).toBe(200);
    const anterior = store.get("loc:ped-1");
    expect((await POST(postRequest({ pedidoId: "ped-1", lat: -7, lng: -45 }))).status).toBe(429);
    expect(store.get("loc:ped-1")).toEqual(anterior);
  });
});

describe("GET /api/localizacao", () => {
  it("continua público e não expõe entregadorId", async () => {
    store.set("loc:ped-1", { entregadorId: "ent-a", pedidoId: "ped-1", lat: -6, lng: -44, timestamp: 123 });
    const res = await GET(new NextRequest("https://x.test/api/localizacao?pedidoId=ped-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pedidoId: "ped-1", lat: -6, lng: -44, timestamp: 123 });
  });
});
