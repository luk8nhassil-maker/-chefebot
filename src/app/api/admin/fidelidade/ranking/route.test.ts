import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockTemporadaAtiva, mockTopRanking } = vi.hoisted(() => ({
  mockTemporadaAtiva: vi.fn(),
  mockTopRanking: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async (t: string) =>
    t === "valid-token" ? { role: "dev", sub: "u1" } : null
  ),
}));

vi.mock("@/lib/temporadas", () => ({
  obterTemporadaAtiva: mockTemporadaAtiva,
}));
vi.mock("@/lib/rankingClientes", () => ({
  obterTopRanking: mockTopRanking,
}));

import { GET } from "./route";

function makeReq(cookie = "valid-token", qs = "") {
  return new NextRequest(`http://localhost/api/admin/fidelidade/ranking${qs}`, {
    headers: { cookie: `auth-token=${cookie}` },
  });
}

beforeEach(() => {
  mockTemporadaAtiva.mockResolvedValue(null);
  mockTopRanking.mockResolvedValue([]);
});

describe("GET /api/admin/fidelidade/ranking", () => {
  test("rejeita sem token", async () => {
    const r = await GET(makeReq("bad"));
    expect(r.status).toBe(401);
  });

  test("retorna mensagem de aguardando quando sem temporada ativa", async () => {
    const r = await GET(makeReq());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.temporadaId).toBeNull();
    expect(body.ranking).toEqual([]);
    expect(body.nota).toContain("aguardando");
  });

  test("retorna ranking sem clienteId quando há temporada ativa", async () => {
    mockTemporadaAtiva.mockResolvedValue({
      temporadaId: "t1",
      estado: "ativa",
      tenantId: "default",
      criadaEm: "2026-01-01T00:00:00.000Z",
      nome: "T1",
    });
    mockTopRanking.mockResolvedValue([
      { clienteId: "secret-id", posicao: 1, score: 200 },
    ]);

    const r = await GET(makeReq());
    const body = await r.json();
    expect(body.temporadaId).toBe("t1");
    expect(body.ranking).toHaveLength(1);
    expect(body.ranking[0]).toEqual({ posicao: 1, score: 200 });
    expect(JSON.stringify(body.ranking)).not.toContain("secret-id");
  });

  test("respeita parâmetro limite com teto de 50", async () => {
    mockTemporadaAtiva.mockResolvedValue({
      temporadaId: "t1",
      estado: "ativa",
      tenantId: "default",
      criadaEm: "2026-01-01T00:00:00.000Z",
    });
    const r = await GET(makeReq("valid-token", "?limite=100"));
    expect(r.status).toBe(200);
  });
});
