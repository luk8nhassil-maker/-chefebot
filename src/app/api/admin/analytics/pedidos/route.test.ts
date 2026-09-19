import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

// ── Mock auth ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(),
}));

// ── Mock historicoAnalitico ────────────────────────────────────────────────────
vi.mock("@/lib/historicoAnalitico", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/historicoAnalitico")>();
  return {
    ...original,
    consultarEventosPorPeriodo: vi.fn(async () => []),
  };
});

import { verifyToken } from "@/lib/auth";
import { consultarEventosPorPeriodo } from "@/lib/historicoAnalitico";

const mockVerify = verifyToken as ReturnType<typeof vi.fn>;
const mockConsultar = consultarEventosPorPeriodo as ReturnType<typeof vi.fn>;

function makeReq(params: Record<string, string> = {}, cookie = "auth-token=tok") {
  const url = new URL("http://localhost/api/admin/analytics/pedidos");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { cookie } });
}

const eventoBase = {
  pedidoId: "p1",
  clienteId: "c1",
  tenantId: "default",
  criadoEmMs: Date.now(),
  expedienteId: "2024-01-01",
  valorElegivelCents: 5000,
  statusAnalitico: "entregue" as const,
  canal: "whatsapp" as const,
  estrelasGeradas: 3,
  schemaVersao: 1 as const,
  regraVersao: "estrelas-faixas-v1",
};

beforeEach(() => {
  mockVerify.mockReset();
  mockConsultar.mockReset();
  mockConsultar.mockResolvedValue([]);
});

describe("GET /api/admin/analytics/pedidos", () => {
  it("rejeita sem cookie de auth", async () => {
    mockVerify.mockResolvedValue(null);
    const res = await GET(makeReq({}, ""));
    expect(res.status).toBe(401);
  });

  it("rejeita role cliente", async () => {
    mockVerify.mockResolvedValue({ role: "cliente" });
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("aceita role admin", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
  });

  it("aceita role dev", async () => {
    mockVerify.mockResolvedValue({ role: "dev" });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
  });

  it("rejeita periodo invalido", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq({ periodo: "45" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/periodo/);
  });

  it("aceita periodo 7", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq({ periodo: "7" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.periodosDias).toBe(7);
  });

  it("aceita periodo 90", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq({ periodo: "90" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.periodosDias).toBe(90);
  });

  it("usa tenantId default quando ausente", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.tenantId).toBe("default");
  });

  it("usa tenantId fornecido", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq({ tenantId: "loja-xyz" }));
    const body = await res.json();
    expect(body.tenantId).toBe("loja-xyz");
  });

  it("retorna metricas zeradas para periodo vazio", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    mockConsultar.mockResolvedValue([]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.metricas.pedidosValidos).toBe(0);
    expect(body.metricas.clientesUnicos).toBe(0);
    expect(body.metricas.receitaElegivelCents).toBe(0);
  });

  it("retorna metricas com eventos", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    mockConsultar.mockResolvedValue([eventoBase]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.metricas.pedidosValidos).toBe(1);
    expect(body.metricas.receitaElegivelCents).toBe(5000);
    expect(body.totalEventosNoIndice).toBe(1);
  });

  it("nao expoe PII — resposta nao contem telefone, clienteId, nome", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    mockConsultar.mockResolvedValue([eventoBase]);
    const res = await GET(makeReq());
    const texto = await res.text();
    expect(texto).not.toContain("telefone");
    expect(texto).not.toContain("clienteId");
    expect(texto).not.toContain("nome");
    expect(texto).not.toContain("endereco");
  });

  it("responde 500 quando consultarEventosPorPeriodo lança", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    mockConsultar.mockRejectedValue(new Error("redis down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("inicioIso e fimIso são strings ISO no body", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq({ periodo: "30" }));
    const body = await res.json();
    expect(body.inicioIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.fimIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("header Cache-Control no-store presente", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const res = await GET(makeReq());
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
