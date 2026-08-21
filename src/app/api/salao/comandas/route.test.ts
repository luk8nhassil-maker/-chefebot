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
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    incr: vi.fn(async (key: string) => { const next = Number(store.get(key) || 0) + 1; store.set(key, next); return next; }),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), verifyToken: verifyTokenMock }));

import { GET, POST } from "./route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function reqSalao(token: string, query = "") {
  return { cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) }, nextUrl: { searchParams: new URLSearchParams(query) } } as never;
}
function reqAdmin(query = "") {
  return { cookies: { get: (n: string) => (n === "auth-token" ? { value: "tok" } : undefined) }, nextUrl: { searchParams: new URLSearchParams(query) } } as never;
}
function reqSemSessao() { return { cookies: { get: () => undefined }, nextUrl: { searchParams: new URLSearchParams() } } as never; }
function postReqSalao(body: unknown, token: string) {
  return { json: async () => body, cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) } } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  verifyTokenMock.mockResolvedValue({ username: "brito", name: "Brito", role: "admin" });
});

describe("GET /api/salao/comandas", () => {
  it("bloqueia sem nenhuma sessão", async () => {
    const res = await GET(reqSemSessao());
    expect(res.status).toBe(401);
  });

  it("uma sessão do Salão consegue listar", async () => {
    const token = await criarTokenSalao();
    const res = await GET(reqSalao(token));
    expect(res.status).toBe(200);
  });

  it("uma sessão administrativa também consegue listar (visão do painel)", async () => {
    const res = await GET(reqAdmin());
    expect(res.status).toBe(200);
  });

  it("filtra por status quando informado", async () => {
    const token = await criarTokenSalao();
    await POST(postReqSalao({ cliente: "Ana", mesa: "5" }, token));
    const abertas = await GET(reqSalao(token, "status=aberta"));
    const fechadas = await GET(reqSalao(token, "status=fechada"));
    expect((await abertas.json()).comandas).toHaveLength(1);
    expect((await fechadas.json()).comandas).toHaveLength(0);
  });

  it("cada comanda vem com rodadas normalizadas e totalParcial", async () => {
    const token = await criarTokenSalao();
    await POST(postReqSalao({ mesa: "5" }, token));
    const res = await GET(reqSalao(token));
    const data = await res.json();
    expect(data.comandas[0].rodadas).toHaveLength(1);
    expect(data.comandas[0].rodadas[0].status).toBe("rascunho");
    expect(data.comandas[0].totalParcial).toBe(0);
    expect(data.comandas[0].cliente).toBeUndefined();
  });

  it("anexa à rodada enviada somente o status real do pedido oficial correspondente", async () => {
    const token = await criarTokenSalao();
    store.set("salao:comandas", [{ id: "comanda_1", numero: 1, cliente: "Ana", mesa: "5", itens: [], status: "enviada", abertaEm: "2026-08-16T20:00:00.000Z", rodadas: [{ id: "rodada_1", numero: 1, status: "enviada", itens: [], subtotal: 30, criadaEm: "2026-08-16T20:00:00.000Z", atualizadaEm: "2026-08-16T20:02:00.000Z", enviadaEm: "2026-08-16T20:02:00.000Z", pedidoId: "pedido_abc" }] }]);
    store.set("pedidos", [{ id: "pedido_outro", status: "entregue" }, { id: "pedido_abc", status: "saiu_entrega", statusAtualizadoEm: "2026-08-16T20:15:00.000Z" }]);
    const res = await GET(reqSalao(token));
    const data = await res.json();
    expect(data.comandas[0].rodadas[0]).toMatchObject({ pedidoId: "pedido_abc", pedidoStatus: "saiu_entrega", pedidoStatusAtualizadoEm: "2026-08-16T20:15:00.000Z" });
  });

  it("status ausente ou desconhecido não é inventado", async () => {
    const token = await criarTokenSalao();
    store.set("salao:comandas", [{ id: "comanda_1", numero: 1, cliente: "Ana", itens: [], status: "enviada", abertaEm: "2026-08-16T20:00:00.000Z", rodadas: [{ id: "rodada_1", numero: 1, status: "enviada", itens: [], subtotal: 0, criadaEm: "2026-08-16T20:00:00.000Z", atualizadaEm: "2026-08-16T20:00:00.000Z", pedidoId: "pedido_abc" }] }]);
    store.set("pedidos", [{ id: "pedido_abc", status: "estado_desconhecido" }]);
    const data = await (await GET(reqSalao(token))).json();
    expect(data.comandas[0].rodadas[0].pedidoStatus).toBeUndefined();
  });
});

describe("POST /api/salao/comandas (abrir)", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await POST({ json: async () => ({ mesa: "5" }), cookies: { get: () => ({ value: "tok" }) } } as never);
    expect(res.status).toBe(401);
  });

  it("abre rascunho sem nome para montar o pedido primeiro", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReqSalao({ mesa: "5", complemento: "Varanda" }, token));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comanda.cliente).toBeUndefined();
    expect(data.comanda.mesa).toBe("5");
    expect(data.comanda.complemento).toBe("Varanda");
    expect(data.comanda.status).toBe("aberta");
  });

  it("continua aceitando nome quando já informado por compatibilidade", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReqSalao({ cliente: "Ana" }, token));
    expect(res.status).toBe(200);
    expect((await res.json()).comanda.cliente).toBe("Ana");
  });

  it("abre uma comanda Sem mesa", async () => {
    const token = await criarTokenSalao();
    const data = await (await POST(postReqSalao({}, token))).json();
    expect(data.comanda.mesa).toBeUndefined();
  });

  it("recusa segunda comanda para mesa ocupada", async () => {
    const token = await criarTokenSalao();
    expect((await POST(postReqSalao({ mesa: "8" }, token))).status).toBe(200);
    expect((await POST(postReqSalao({ mesa: "8" }, token))).status).toBe(409);
  });
});
