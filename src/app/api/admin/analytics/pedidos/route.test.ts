import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  consultarEventosAnaliticosComFallback: vi.fn(),
  consultarClientesComHistoricoAnterior: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("@/lib/analyticsPedidosReadModel.server", () => ({
  consultarEventosAnaliticosComFallback: mocks.consultarEventosAnaliticosComFallback,
}));
vi.mock("@/lib/historicoAnalitico", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/historicoAnalitico")>();
  return {
    ...original,
    consultarClientesComHistoricoAnterior: mocks.consultarClientesComHistoricoAnterior,
  };
});

import { GET } from "./route";

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
  expedienteId: "2026-10-07",
  valorElegivelCents: 5000,
  statusAnalitico: "entregue" as const,
  canal: "whatsapp" as const,
  estrelasGeradas: 3,
  schemaVersao: 1 as const,
  regraVersao: "estrelas-faixas-v1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyToken.mockResolvedValue({ role: "admin" });
  mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
    eventos: [],
    fallbackTodos: [],
    fonte: {
      indiceDisponivel: true,
      fallbackPedidosDisponivel: true,
      eventosIndice: 0,
      eventosFallbackAdicionados: 0,
      origem: "pedidos",
    },
  });
  mocks.consultarClientesComHistoricoAnterior.mockResolvedValue(new Set());
});

describe("GET /api/admin/analytics/pedidos", () => {
  it("rejeita sem autenticação", async () => {
    mocks.verifyToken.mockResolvedValue(null);
    expect((await GET(makeReq({}, ""))).status).toBe(401);
  });

  it("aceita admin e retorna vazio sem travar", async () => {
    const res = await GET(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.metricas.pedidosValidos).toBe(0);
    expect(body.totalEventosConsiderados).toBe(0);
  });

  it("usa fallback de pedidos reais quando necessário", async () => {
    mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
      eventos: [eventoBase],
      fallbackTodos: [eventoBase],
      fonte: {
        indiceDisponivel: true,
        fallbackPedidosDisponivel: true,
        eventosIndice: 0,
        eventosFallbackAdicionados: 1,
        origem: "pedidos",
      },
    });
    const res = await GET(makeReq({ periodo: "30" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.metricas.pedidosValidos).toBe(1);
    expect(body.metricas.receitaElegivelCents).toBe(5000);
    expect(body.totalEventosNoIndice).toBe(0);
    expect(body.totalEventosConsiderados).toBe(1);
    expect(body.fonteDados.origem).toBe("pedidos");
    expect(body.coberturaDados.janelaSolicitadaDias).toBe(30);
    expect(body.coberturaDados.amplitudeDadosDias).toBeGreaterThanOrEqual(1);
    expect(body.coberturaDados.amplitudeDadosDias).toBeLessThanOrEqual(30);
    expect(body.coberturaDados.primeiroDadoIso).toBeTruthy();
  });

  it("30d mostra todo dado disponível mesmo com histórico menor que 30 dias", async () => {
    const agora = Date.now();
    mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
      eventos: [
        { ...eventoBase, pedidoId: "p-hoje", criadoEmMs: agora },
        { ...eventoBase, pedidoId: "p-11d", clienteId: "c2", criadoEmMs: agora - 11 * 86_400_000 },
      ],
      fallbackTodos: [],
      fonte: {
        indiceDisponivel: false,
        fallbackPedidosDisponivel: true,
        eventosIndice: 0,
        eventosFallbackAdicionados: 2,
        origem: "pedidos",
      },
    });
    const body = await (await GET(makeReq({ periodo: "30" }))).json();
    expect(body.metricas.pedidosValidos).toBe(2);
    expect(body.coberturaDados.janelaSolicitadaDias).toBe(30);
    expect(body.coberturaDados.amplitudeDadosDias).toBeGreaterThanOrEqual(12);
    expect(body.coberturaDados.amplitudeDadosDias).toBeLessThanOrEqual(13);
  });

  it("consulta histórico anterior somente dos clientes atuais", async () => {
    mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
      eventos: [eventoBase, { ...eventoBase, pedidoId: "p2", clienteId: "c2" }],
      fallbackTodos: [],
      fonte: {
        indiceDisponivel: true,
        fallbackPedidosDisponivel: true,
        eventosIndice: 2,
        eventosFallbackAdicionados: 0,
        origem: "analytics",
      },
    });
    mocks.consultarClientesComHistoricoAnterior.mockResolvedValue(new Set(["c1"]));
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.metricas.clientesUnicos).toBe(2);
    expect(body.metricas.clientesRecorrentes).toBe(1);
    expect(body.metricas.clientesNovos).toBe(1);
    expect(mocks.consultarClientesComHistoricoAnterior).toHaveBeenCalled();
  });

  it("não expõe PII", async () => {
    mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
      eventos: [eventoBase],
      fallbackTodos: [eventoBase],
      fonte: { indiceDisponivel: true, fallbackPedidosDisponivel: true, eventosIndice: 1, eventosFallbackAdicionados: 0, origem: "analytics" },
    });
    const texto = await (await GET(makeReq())).text();
    expect(texto).not.toContain("clienteId");
    expect(texto).not.toContain("telefone");
    expect(texto).not.toContain("endereco");
  });

  it("rejeita período inválido", async () => {
    const res = await GET(makeReq({ periodo: "45" }));
    expect(res.status).toBe(400);
  });

  it("falha 500 apenas quando as duas fontes ficam indisponíveis", async () => {
    mocks.consultarEventosAnaliticosComFallback.mockRejectedValue(new Error("down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });

  it("responde sem cache", async () => {
    const res = await GET(makeReq());
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
