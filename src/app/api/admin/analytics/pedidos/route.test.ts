import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  consultarEventosAnaliticosComFallback: vi.fn(),
  existeHistoricoAnaliticoAntesDe: vi.fn(),
  consultarClientesComHistoricoAnterior: vi.fn(),
  consultarEstrelasCreditadasPorPedidos: vi.fn(),
  obterTemporadaAtiva: vi.fn(),
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
    existeHistoricoAnaliticoAntesDe: mocks.existeHistoricoAnaliticoAntesDe,
  };
});
vi.mock("@/lib/fidelidade", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/fidelidade")>();
  return { ...original, consultarEstrelasCreditadasPorPedidos: mocks.consultarEstrelasCreditadasPorPedidos };
});
vi.mock("@/lib/temporadas", () => ({ obterTemporadaAtiva: mocks.obterTemporadaAtiva }));

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
  mocks.existeHistoricoAnaliticoAntesDe.mockResolvedValue(false);
  mocks.consultarEstrelasCreditadasPorPedidos.mockResolvedValue({ estrelas: 0, pedidosComCredito: 0 });
  mocks.obterTemporadaAtiva.mockResolvedValue(null);
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
    expect(body.cobertura.janelaSolicitadaDias).toBe(30);
    expect(body.cobertura.historicoEncontradoDesdeIso).toBeTruthy();
    expect(body.cobertura.diasHistoricoEncontrado).toBeGreaterThanOrEqual(1);
  });

  it("inclui todo o histórico disponível e lê estrelas confirmadas do extrato", async () => {
    mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
      eventos: [eventoBase], fallbackTodos: [eventoBase],
      fonte: { indiceDisponivel: false, fallbackPedidosDisponivel: true, eventosIndice: 0, eventosFallbackAdicionados: 1, origem: "pedidos" },
    });
    mocks.consultarEstrelasCreditadasPorPedidos.mockResolvedValue({ estrelas: 5, pedidosComCredito: 1 });
    const body = await (await GET(makeReq({ periodo: "historico" }))).json();
    expect(body.periodosDias).toBeNull();
    expect(body.cobertura.janelaSolicitadaDias).toBeNull();
    expect(body.metricas.estrelasDistribuidas).toBe(5);
    expect(body.metricas.pedidosComEstrelasRegistradas).toBe(1);
    const [, inicioMs] = mocks.consultarEventosAnaliticosComFallback.mock.calls[0];
    expect(inicioMs).toBe(0);
  });

  it("informa quando a janela de 30d só possui parte do histórico coletado", async () => {
    const agora = Date.now();
    const antigo = { ...eventoBase, pedidoId: "p-antigo", criadoEmMs: agora - 12 * 86400000 };
    const recente = { ...eventoBase, pedidoId: "p-recente", criadoEmMs: agora - 2 * 86400000 };
    mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
      eventos: [antigo, recente],
      fallbackTodos: [antigo, recente],
      fonte: {
        indiceDisponivel: false,
        fallbackPedidosDisponivel: true,
        eventosIndice: 0,
        eventosFallbackAdicionados: 2,
        origem: "pedidos",
      },
    });

    const body = await (await GET(makeReq({ periodo: "30" }))).json();
    expect(body.cobertura.janelaSolicitadaDias).toBe(30);
    expect(body.cobertura.diasHistoricoEncontrado).toBeGreaterThanOrEqual(11);
    expect(body.cobertura.diasHistoricoEncontrado).toBeLessThan(30);
    expect(body.cobertura.possuiDadosAntesDaJanela).toBe(false);
    expect(body.metricas.pedidosValidos).toBe(2);
  });

  it("ancora os filtros no início civil da campanha e limita ao dia atual", async () => {
    mocks.obterTemporadaAtiva.mockResolvedValue({
      temporadaId: "t-campanha",
      tenantId: "default",
      estado: "ativa",
      ativadaEm: "2026-09-19T18:00:00.000Z",
      duracaoDias: 30,
    });
    const agora = new Date("2026-09-25T15:00:00.000Z").getTime();
    vi.setSystemTime(agora);

    const res = await GET(makeReq({ periodo: "30" }));
    const body = await res.json();
    expect(body.inicioIso).toBe("2026-09-19T03:00:00.000Z");
    expect(body.fimIso).toBe(new Date(agora).toISOString());
    expect(body.cobertura.ancoradaNoInicioCampanha).toBe(true);
    expect(body.cobertura.diasCorridosDisponiveis).toBe(7);
    expect(mocks.consultarEventosAnaliticosComFallback.mock.calls[0][1]).toBe(new Date("2026-09-19T03:00:00.000Z").getTime());
    expect(mocks.consultarEventosAnaliticosComFallback.mock.calls[0][4]).toEqual({ incluirIndiceCompleto: true });
    vi.useRealTimers();
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
    mocks.existeHistoricoAnaliticoAntesDe.mockResolvedValue(true);
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

  it("não bloqueia janelas grandes lendo extratos completos de centenas de clientes", async () => {
    const eventos = Array.from({ length: 401 }, (_, indice) => ({
      ...eventoBase,
      pedidoId: `p-${indice}`,
      clienteId: `c-${indice}`,
    }));
    mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
      eventos,
      fallbackTodos: [],
      fonte: { indiceDisponivel: true, fallbackPedidosDisponivel: false, eventosIndice: eventos.length, eventosFallbackAdicionados: 0, origem: "analytics" },
    });

    const body = await (await GET(makeReq({ periodo: "30" }))).json();
    expect(body.metricas.pedidosValidos).toBe(401);
    expect(body.metricas.estrelasDistribuidas).toBeNull();
    expect(mocks.consultarEstrelasCreditadasPorPedidos).not.toHaveBeenCalled();
  });

  it("rejeita período inválido", async () => {
    const res = await GET(makeReq({ periodo: "45" }));
    expect(res.status).toBe(400);
  });

  it("não mistura pedidos da loja com outro tenant informado na URL", async () => {
    const res = await GET(makeReq({ tenantId: "outra-loja" }));
    expect(res.status).toBe(400);
    expect(mocks.consultarEventosAnaliticosComFallback).not.toHaveBeenCalled();
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
