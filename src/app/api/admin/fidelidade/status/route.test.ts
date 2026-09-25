import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockConfigPontos,
  mockTemporadaAtiva,
  mockListarTemporadas,
  mockTopRanking,
} = vi.hoisted(() => ({
  mockConfigPontos: vi.fn(),
  mockTemporadaAtiva: vi.fn(),
  mockListarTemporadas: vi.fn(),
  mockTopRanking: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async (t: string) =>
    t === "valid-token" ? { role: "admin", sub: "u1" } : null
  ),
}));

vi.mock("@/lib/fidelidade", () => ({
  obterConfigFidelidadePontos: mockConfigPontos,
  estrelasV1Ativa: (c: { ativo: boolean; regraVersao?: string }) =>
    c.ativo === true && c.regraVersao === "estrelas-faixas-v1",
}));
vi.mock("@/lib/temporadas", () => ({
  obterTemporadaAtiva: mockTemporadaAtiva,
  listarTemporadas: mockListarTemporadas,
}));
vi.mock("@/lib/rankingClientes", () => ({
  obterTopRanking: mockTopRanking,
}));

import { GET } from "./route";

function makeReq(cookie = "valid-token") {
  return new NextRequest("http://localhost/api/admin/fidelidade/status", {
    headers: { cookie: `auth-token=${cookie}` },
  });
}

beforeEach(() => {
  mockConfigPontos.mockResolvedValue({
    ativo: true,
    regraVersao: "estrelas-faixas-v1",
    metaEstrelas: 50,
    coberturaEconomicaAprovada: false,
    descricaoRecompensa: "Pizza",
  });
  mockTemporadaAtiva.mockResolvedValue(null);
  mockListarTemporadas.mockResolvedValue([]);
  mockTopRanking.mockResolvedValue([]);
});

describe("GET /api/admin/fidelidade/status", () => {
  test("rejeita sem token", async () => {
    const r = await GET(makeReq("bad"));
    expect(r.status).toBe(401);
  });

  test("retorna estrutura completa com temporada inativa", async () => {
    const r = await GET(makeReq());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.estrelas.ativa).toBe(true);
    expect(body.temporada.ativa).toBeNull();
    expect(body.ranking.configurado).toBe(false);
    expect(body.missoes.configuradas).toBe(false);
  });

  test("retorna temporada ativa quando presente", async () => {
    mockTemporadaAtiva.mockResolvedValue({
      temporadaId: "t1",
      nome: "Temporada 1",
      estado: "ativa",
      tenantId: "default",
      criadaEm: "2026-01-01T00:00:00.000Z",
      ativadaEm: "2026-01-01T00:00:00.000Z",
      fimEm: "2026-01-31T00:00:00.000Z",
      duracaoDias: 30,
    });
    mockListarTemporadas.mockResolvedValue([{ temporadaId: "t1", estado: "ativa" }]);

    const r = await GET(makeReq());
    const body = await r.json();
    expect(body.temporada.ativa?.temporadaId).toBe("t1");
    expect(body.temporada.ativa?.fimEm).toBe("2026-01-31T00:00:00.000Z");
    expect(body.temporada.total).toBe(1);
  });

  test("coberturaEconomicaAprovada NUNCA exposta no status", async () => {
    const r = await GET(makeReq());
    const body = await r.json();
    const text = JSON.stringify(body);
    expect(text).not.toContain("coberturaEconomicaAprovada");
  });

  test("ultimaEncerradaId aponta para a mais recente por encerradaEm, não a última da lista", async () => {
    mockListarTemporadas.mockResolvedValue([
      { temporadaId: "t-antiga", estado: "encerrada", encerradaEm: "2026-01-01T00:00:00.000Z", criadaEm: "" },
      { temporadaId: "t-recente", nome: "Verão", estado: "encerrada", encerradaEm: "2026-06-01T00:00:00.000Z", criadaEm: "" },
    ]);
    const body = await (await GET(makeReq())).json();
    expect(body.temporada.encerradas).toBe(2);
    expect(body.temporada.ultimaEncerradaId).toBe("t-recente");
    expect(body.temporada.ultimaEncerradaNome).toBe("Verão");
  });

  test("ultimaEncerradaId null quando nenhuma temporada foi encerrada", async () => {
    mockListarTemporadas.mockResolvedValue([{ temporadaId: "t1", estado: "rascunho", criadaEm: "" }]);
    const body = await (await GET(makeReq())).json();
    expect(body.temporada.ultimaEncerradaId).toBeNull();
  });

  test("ranking top5 sem PII — apenas posicao e score", async () => {
    mockTemporadaAtiva.mockResolvedValue({
      temporadaId: "t1",
      estado: "ativa",
      tenantId: "default",
      criadaEm: "2026-01-01T00:00:00.000Z",
    });
    mockTopRanking.mockResolvedValue([
      { clienteId: "cliente-secreto-123", posicao: 1, score: 100 },
      { clienteId: "outro-cliente-456", posicao: 2, score: 80 },
    ]);
    const r = await GET(makeReq());
    const body = await r.json();
    expect(body.ranking.top5).toHaveLength(2);
    expect(body.ranking.top5[0]).toEqual({ posicao: 1, score: 100 });
    expect(JSON.stringify(body.ranking.top5)).not.toContain("cliente-secreto-123");
    expect(JSON.stringify(body.ranking.top5)).not.toContain("outro-cliente-456");
  });
});
