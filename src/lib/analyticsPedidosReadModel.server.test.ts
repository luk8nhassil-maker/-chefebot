import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  consultarEventosPorPeriodo: vi.fn(),
}));

vi.mock("./redis", () => ({
  redis: { get: mocks.redisGet },
}));

vi.mock("./fidelidade", () => ({
  derivarClienteIdPorTelefone: (telefone?: string) => {
    const digits = String(telefone ?? "").replace(/\D/g, "");
    return digits.length >= 10 ? `cli_${digits}` : undefined;
  },
}));

vi.mock("./historicoAnalitico", () => ({
  TENANT_PADRAO_ANALYTICS: "default",
  calcularValorElegivelCentsParaHistorico: (pedido: { total?: number; taxaEntrega?: number }) =>
    Math.max(Math.round(((pedido.total ?? 0) - (pedido.taxaEntrega ?? 0)) * 100), 0),
  consultarEventosPorPeriodo: mocks.consultarEventosPorPeriodo,
}));

import {
  consultarEventosAnaliticosComFallback,
  eventosAnaliticosDePedidos,
} from "./analyticsPedidosReadModel.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redisGet.mockResolvedValue([]);
  mocks.consultarEventosPorPeriodo.mockResolvedValue([]);
});

describe("analyticsPedidosReadModel", () => {
  test("converte pedido entregue real em evento analítico sem escrever", () => {
    const ms = new Date("2026-10-05T20:00:00-03:00").getTime();
    const eventos = eventosAnaliticosDePedidos([
      {
        id: String(ms),
        telefone: "(99) 99999-1234",
        total: 70,
        taxaEntrega: 5,
        status: "entregue",
        origem: "whatsapp",
      },
    ], "default", ms + 1000);

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      pedidoId: String(ms),
      clienteId: "cli_99999991234",
      valorElegivelCents: 6500,
      canal: "whatsapp",
      statusAnalitico: "entregue",
      regraVersao: "fallback-pedidos-readonly",
    });
  });

  test("classifica como painel o pedido com origem administrativa oficial", () => {
    const agora = new Date("2026-10-05T20:00:00-03:00").getTime();
    const eventos = eventosAnaliticosDePedidos([{
      id: "pedido-painel-1",
      telefone: "(99) 99999-1234",
      total: 70,
      status: "entregue",
      origem: "painel",
      data: "05/10/2026",
      horario: "20:00",
    }], "default", agora + 1000);
    expect(eventos[0]?.canal).toBe("painel");
  });

  test("ignora cancelados e mantém pedidos entregues sem cliente ou com valor elegível zero", () => {
    const ms = new Date("2026-10-05T20:00:00-03:00").getTime();
    const eventos = eventosAnaliticosDePedidos([
      { id: String(ms), telefone: "99999999999", total: 70, status: "cancelado" },
      { id: String(ms + 1), total: 70, status: "entregue" },
      { id: String(ms + 2), telefone: "99999999999", total: 0, status: "entregue" },
    ], "default", ms + 1000);
    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toMatchObject({ pedidoId: String(ms + 1), valorElegivelCents: 7000, statusAnalitico: "entregue" });
    expect(eventos[0].clienteId).toBeUndefined();
    expect(eventos[1]).toMatchObject({ pedidoId: String(ms + 2), valorElegivelCents: 0, statusAnalitico: "entregue" });
  });

  test("7 dias e 30 dias divergem com pedido legado de 20 dias atrás", async () => {
    const agora = new Date("2026-10-07T20:00:00-03:00").getTime();
    mocks.redisGet.mockResolvedValue([
      { id: "legado-3d", telefone: "99999991234", total: 60, status: "entregue", data: "04/10/2026", horario: "20:00" },
      { id: "legado-20d", telefone: "99999995678", total: 80, status: "entregue", data: "17/09/2026", horario: "20:00" },
    ]);

    const sete = await consultarEventosAnaliticosComFallback(
      "default",
      agora - 7 * 24 * 60 * 60 * 1000,
      agora,
      agora,
    );
    const trinta = await consultarEventosAnaliticosComFallback(
      "default",
      agora - 30 * 24 * 60 * 60 * 1000,
      agora,
      agora,
    );

    expect(sete.eventos.map((e) => e.pedidoId)).toEqual(["legado-3d"]);
    expect(trinta.eventos.map((e) => e.pedidoId).sort()).toEqual(["legado-20d", "legado-3d"]);
  });

  test("usa pedidos como caminho rápido e não consulta o índice quando a fonte oficial está disponível", async () => {
    const ms = new Date("2026-10-05T20:00:00-03:00").getTime();
    mocks.redisGet.mockResolvedValue([
      { id: String(ms), telefone: "99999991234", total: 65, status: "entregue", origem: "whatsapp" },
      { id: String(ms + 1000), telefone: "99999995678", total: 80, status: "entregue" },
    ]);

    const leitura = await consultarEventosAnaliticosComFallback(
      "default",
      ms - 1000,
      ms + 5000,
      ms + 5000,
    );

    expect(leitura.eventos).toHaveLength(2);
    expect(leitura.fonte.origem).toBe("pedidos");
    expect(leitura.fonte.eventosIndice).toBe(0);
    expect(leitura.fonte.eventosFallbackAdicionados).toBe(2);
    expect(mocks.consultarEventosPorPeriodo).not.toHaveBeenCalled();
  });

  test("cai para o índice quando a chave de pedidos está vazia", async () => {
    const ms = new Date("2026-10-05T20:00:00-03:00").getTime();
    const indexado = {
      pedidoId: String(ms),
      clienteId: "cli_99999991234",
      tenantId: "default",
      criadoEmMs: ms,
      expedienteId: "2026-10-05",
      valorElegivelCents: 6500,
      statusAnalitico: "entregue" as const,
      canal: "whatsapp" as const,
      estrelasGeradas: 5,
      schemaVersao: 1 as const,
      regraVersao: "estrelas-faixas-v1",
    };
    mocks.redisGet.mockResolvedValue([]);
    mocks.consultarEventosPorPeriodo.mockResolvedValue([indexado]);

    const leitura = await consultarEventosAnaliticosComFallback("default", ms - 1000, ms + 1000, ms + 1000);
    expect(leitura.eventos).toEqual([indexado]);
    expect(leitura.fonte.origem).toBe("analytics");
    expect(leitura.fonte.indiceDisponivel).toBe(true);
  });

  test("cai para o índice quando a leitura de pedidos falha", async () => {
    const ms = new Date("2026-10-05T20:00:00-03:00").getTime();
    mocks.redisGet.mockRejectedValue(new Error("pedidos down"));
    mocks.consultarEventosPorPeriodo.mockResolvedValue([]);
    const leitura = await consultarEventosAnaliticosComFallback("default", ms - 1000, ms + 1000, ms + 1000);
    expect(leitura.fonte.origem).toBe("analytics");
    expect(leitura.fonte.fallbackPedidosDisponivel).toBe(false);
    expect(mocks.consultarEventosPorPeriodo).toHaveBeenCalledTimes(1);
  });
});
