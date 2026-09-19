import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => { const had = store.has(key); store.delete(key); return had ? 1 : 0; }),
  },
}));

const adminToken = "tok-admin";
const devToken = "tok-dev";
const atendenteToken = "tok-atendente";

vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async (token: string) => {
    if (token === adminToken) return { role: "admin" };
    if (token === devToken) return { role: "dev" };
    if (token === atendenteToken) return { role: "atendente" };
    return null;
  }),
}));

import { GET, POST } from "./route";

function makeReq(token: string | null, opts: { method?: string; body?: unknown; search?: string } = {}): NextRequest {
  const url = `http://localhost/api/admin/fidelidade/temporadas${opts.search ? `?${opts.search}` : ""}`;
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const r = new NextRequest(url, {
    method,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body), headers: { "content-type": "application/json" } } : {}),
  });
  if (token) {
    Object.defineProperty(r, "cookies", {
      value: { get: (name: string) => name === "auth-token" ? { value: token } : undefined },
    });
  } else {
    Object.defineProperty(r, "cookies", { value: { get: () => undefined } });
  }
  return r;
}

beforeEach(() => { store.clear(); });

describe("GET /api/admin/fidelidade/temporadas", () => {
  test("401 sem token", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
  });

  test("401 para atendente", async () => {
    const res = await GET(makeReq(atendenteToken));
    expect(res.status).toBe(401);
  });

  test("retorna lista vazia para tenant sem temporadas", async () => {
    const res = await GET(makeReq(adminToken));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.temporadas).toEqual([]);
  });

  test("retorna temporadas criadas", async () => {
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t1" } }));
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t2" } }));
    const res = await GET(makeReq(adminToken));
    const json = await res.json();
    expect(json.temporadas).toHaveLength(2);
  });
});

describe("POST /api/admin/fidelidade/temporadas — criar", () => {
  test("401 sem token", async () => {
    const res = await POST(makeReq(null, { body: { acao: "criar", temporadaId: "t1" } }));
    expect(res.status).toBe(401);
  });

  test("400 sem temporadaId", async () => {
    const res = await POST(makeReq(adminToken, { body: { acao: "criar" } }));
    expect(res.status).toBe(400);
  });

  test("400 sem acao", async () => {
    const res = await POST(makeReq(adminToken, { body: { temporadaId: "t1" } }));
    expect(res.status).toBe(400);
  });

  test("cria temporada em rascunho com dev token", async () => {
    const res = await POST(makeReq(devToken, { body: { acao: "criar", temporadaId: "t1", nome: "Verão 2026" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.config.estado).toBe("rascunho");
    expect(json.config.nome).toBe("Verão 2026");
  });

  test("400 para acao desconhecida", async () => {
    const res = await POST(makeReq(adminToken, { body: { acao: "deletar", temporadaId: "t1" } }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/fidelidade/temporadas — ativar e encerrar", () => {
  test("ativar transiciona rascunho para ativa", async () => {
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t1" } }));
    const res = await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "t1" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.config.estado).toBe("ativa");
  });

  test("encerrar transiciona ativa para encerrada", async () => {
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t1" } }));
    await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "t1" } }));
    const res = await POST(makeReq(adminToken, { body: { acao: "encerrar", temporadaId: "t1" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.config.estado).toBe("encerrada");
  });

  test("422 ao ativar temporada inexistente", async () => {
    const res = await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "nao-existe" } }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  test("422 ao ativar temporada já encerrada", async () => {
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t1" } }));
    await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "t1" } }));
    await POST(makeReq(adminToken, { body: { acao: "encerrar", temporadaId: "t1" } }));
    const res = await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "t1" } }));
    expect(res.status).toBe(422);
  });
});
