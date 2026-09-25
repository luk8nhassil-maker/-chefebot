import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const store = new Map<string, unknown>();
const zsets = new Map<string, Map<string, number>>();
function getZ(key: string): Map<string, number> {
  if (!zsets.has(key)) zsets.set(key, new Map());
  return zsets.get(key)!;
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => { const had = store.has(key); store.delete(key); return had ? 1 : 0; }),
    zadd: vi.fn(async (key: string, entry: { score: number; member: string }) => {
      getZ(key).set(entry.member, entry.score);
      return 1;
    }),
    zrange: vi.fn(async (key: string, _start: number, stop: number, opts?: { rev?: boolean }) => {
      const entries = Array.from(getZ(key).entries()).sort((a, b) => (opts?.rev ? b[1] - a[1] : a[1] - b[1]));
      const end = stop < 0 ? entries.length + stop + 1 : stop + 1;
      return entries.slice(0, end).map(([m]) => m);
    }),
    zscore: vi.fn(async (key: string, member: string) => getZ(key).get(member) ?? null),
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

beforeEach(() => { store.clear(); zsets.clear(); });

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

  test("encerrar arquiva o resultado da temporada (fail-closed sem premio configurado)", async () => {
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t1" } }));
    await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "t1" } }));
    const res = await POST(makeReq(adminToken, { body: { acao: "encerrar", temporadaId: "t1" } }));
    const json = await res.json();
    expect(json.resultadoTemporada).toBeTruthy();
    expect(json.resultadoTemporada.vencedorDeclarado).toBe(false);
    expect(json.resultadoTemporada.premioAprovado).toBe(false);
  });

  test("encerrar duas vezes não recalcula nem sobrescreve o resultado já arquivado", async () => {
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t1" } }));
    await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "t1" } }));
    const primeiro = await (await POST(makeReq(adminToken, { body: { acao: "encerrar", temporadaId: "t1" } }))).json();
    const segundo = await (await POST(makeReq(adminToken, { body: { acao: "encerrar", temporadaId: "t1" } }))).json();
    expect(segundo.resultadoTemporada).toEqual(primeiro.resultadoTemporada);
  });
});

describe("POST /api/admin/fidelidade/temporadas — criar com prêmio configurado", () => {
  test("guarda descrição, quantidade e aprovação do prêmio quando os três vêm explícitos", async () => {
    const res = await POST(makeReq(adminToken, {
      body: {
        acao: "criar",
        temporadaId: "t-premio",
        premioDescricao: "1 Pizza Família",
        premioQuantidadePremiados: 3,
        premioAprovado: true,
      },
    }));
    const json = await res.json();
    expect(json.config.premioDescricao).toBe("1 Pizza Família");
    expect(json.config.premioQuantidadePremiados).toBe(3);
    expect(json.config.premioAprovado).toBe(true);
  });

  test("sem premioAprovado explícito, nunca infere aprovação só pela descrição/quantidade existirem", async () => {
    const res = await POST(makeReq(adminToken, {
      body: { acao: "criar", temporadaId: "t-sem-aprovacao", premioDescricao: "1 Pizza Família", premioQuantidadePremiados: 1 },
    }));
    const json = await res.json();
    expect(json.config.premioAprovado).toBeUndefined();
  });
});

describe("GET /api/admin/fidelidade/temporadas?resultado=", () => {
  test("null quando a temporada ainda não foi encerrada", async () => {
    await POST(makeReq(adminToken, { body: { acao: "criar", temporadaId: "t1" } }));
    const res = await GET(makeReq(adminToken, { search: "resultado=t1" }));
    const json = await res.json();
    expect(json.resultado).toBeNull();
  });

  test("carrega a config de prêmio no resultado, mas nunca declara vencedor sem ninguém rankeado", async () => {
    await POST(makeReq(adminToken, {
      body: { acao: "criar", temporadaId: "t1", premioDescricao: "1 Pizza Família", premioQuantidadePremiados: 1, premioAprovado: true },
    }));
    await POST(makeReq(adminToken, { body: { acao: "ativar", temporadaId: "t1" } }));
    await POST(makeReq(adminToken, { body: { acao: "encerrar", temporadaId: "t1" } }));

    const res = await GET(makeReq(adminToken, { search: "resultado=t1" }));
    const json = await res.json();
    // Prêmio aprovado, mas ranking vazio: fail-closed, sem vencedor inventado.
    expect(json.resultado.premioDescricao).toBe("1 Pizza Família");
    expect(json.resultado.premioAprovado).toBe(true);
    expect(json.resultado.vencedorDeclarado).toBe(false);
    expect(json.resultado.vencedores).toEqual([]);
  });
});
