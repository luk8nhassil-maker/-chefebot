import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockRedisGet, mockObterExtratoPontos } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockObterExtratoPontos: vi.fn(),
}));

vi.mock("./redis", () => ({
  redis: {
    get: mockRedisGet,
  },
}));

vi.mock("./fidelidade", () => ({
  obterExtratoPontos: mockObterExtratoPontos,
}));

import { carregarEvidenciasHistoricasFidelidade } from "./pesquisaPreferenciaHistoricoRedis";

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue([]);
  mockObterExtratoPontos.mockResolvedValue([]);
});

describe("carregarEvidenciasHistoricasFidelidade", () => {
  test("lê apenas créditos legados e confirmações por pontos", async () => {
    mockRedisGet.mockResolvedValue([
      {
        movimentoId: "m1",
        clienteId: "cid_a",
        pedidoId: "old_legacy",
        tipo: "credito",
        quantidade: 1,
        motivo: "Pedido entregue",
        createdAt: "2026-07-10T12:00:00.000Z",
      },
      {
        movimentoId: "m2",
        clienteId: "cid_a",
        pedidoId: "resgate",
        tipo: "resgate",
        quantidade: -1,
        motivo: "Resgate",
        createdAt: "2026-07-11T12:00:00.000Z",
      },
    ]);

    mockObterExtratoPontos.mockResolvedValue([
      {
        movimentoId: "p1",
        clienteId: "cid_a",
        pedidoId: "old_points",
        tipo: "confirmado",
        pontos: 10,
        motivo: "Pedido entregue",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        movimentoId: "p2",
        clienteId: "cid_a",
        pedidoId: "previsto",
        tipo: "previsto",
        pontos: 10,
        motivo: "Previsto",
        createdAt: "2026-08-02T12:00:00.000Z",
      },
    ]);

    const evidencias = await carregarEvidenciasHistoricasFidelidade("cid_a");

    expect(mockRedisGet).toHaveBeenCalledWith("fidelidade:extrato:cid_a");
    expect(evidencias).toEqual([
      {
        pedidoId: "old_legacy",
        criadoEmMs: Date.parse("2026-07-10T12:00:00.000Z"),
        fonte: "fidelidade_legado",
      },
      {
        pedidoId: "old_points",
        criadoEmMs: Date.parse("2026-08-01T12:00:00.000Z"),
        fonte: "fidelidade_pontos",
      },
    ]);
  });

  test("ignora timestamps inválidos e movimentos sem pedido", async () => {
    mockRedisGet.mockResolvedValue([
      {
        movimentoId: "m1",
        clienteId: "cid_a",
        pedidoId: "old",
        tipo: "credito",
        quantidade: 1,
        motivo: "Pedido entregue",
        createdAt: "invalido",
      },
    ]);
    mockObterExtratoPontos.mockResolvedValue([
      {
        movimentoId: "p1",
        clienteId: "cid_a",
        tipo: "confirmado",
        pontos: 10,
        motivo: "Pedido entregue",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ]);

    expect(await carregarEvidenciasHistoricasFidelidade("cid_a")).toEqual([]);
  });

  test("ausência de ledger retorna vazio sem inferir que cliente é novo", async () => {
    expect(await carregarEvidenciasHistoricasFidelidade("cid_a")).toEqual([]);
  });
});
