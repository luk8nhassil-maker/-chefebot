import { beforeEach, describe, expect, test, vi } from "vitest";

const { existeHistoricoMock, consultarEventosMock } = vi.hoisted(() => ({
  existeHistoricoMock: vi.fn(),
  consultarEventosMock: vi.fn(),
}));

vi.mock("./historicoAnalitico", () => ({
  existeHistoricoAnaliticoAntesDe: existeHistoricoMock,
  consultarEventosPorPeriodo: consultarEventosMock,
}));

vi.mock("./expedienteOperacional", () => ({
  chaveExpedienteOperacional: vi.fn(() => "2026-09-28"),
}));

vi.mock("./estrelas", () => ({
  calcularEstrelasPorValorElegivel: vi.fn((cents: number) => {
    if (cents <= 0) return 0;
    if (cents < 4000) return 3;
    if (cents < 7000) return 5;
    if (cents < 10000) return 7;
    if (cents < 15000) return 9;
    return 12;
  }),
}));

import { obterReferenciaCoroaDinamica } from "./rankingCoroaDinamica";

beforeEach(() => {
  existeHistoricoMock.mockReset().mockResolvedValue(false);
  consultarEventosMock.mockReset().mockResolvedValue([]);
});

describe("obterReferenciaCoroaDinamica — cobertura completa", () => {
  test("sem prova de coleta anterior, fica neutra e nem consulta a semana parcial", async () => {
    const referencia = await obterReferenciaCoroaDinamica(
      "default",
      Date.parse("2026-09-28T07:00:00.000Z"),
    );

    expect(referencia).toBeNull();
    expect(existeHistoricoMock).toHaveBeenCalledTimes(1);
    expect(consultarEventosMock).not.toHaveBeenCalled();
  });

  test("com coleta anterior comprovada, calcula a referência da semana completa", async () => {
    existeHistoricoMock.mockResolvedValue(true);
    consultarEventosMock.mockResolvedValue([
      {
        pedidoId: "p1",
        clienteId: "c1",
        tenantId: "default",
        criadoEmMs: Date.parse("2026-09-24T22:00:00.000Z"),
        expedienteId: "2026-09-24",
        valorElegivelCents: 4300,
        statusAnalitico: "entregue",
        canal: "app",
        estrelasGeradas: 5,
        schemaVersao: 1,
        regraVersao: "estrelas-faixas-v1",
      },
    ]);

    const referencia = await obterReferenciaCoroaDinamica(
      "default",
      Date.parse("2026-09-28T07:00:00.000Z"),
    );

    expect(referencia).toMatchObject({
      inicioExpedienteId: "2026-09-21",
      fimExpedienteId: "2026-09-27",
      pedidosValidos: 1,
      ticketMedioElegivelCents: 4300,
      maxGapEstrelas: 5,
    });
    expect(consultarEventosMock).toHaveBeenCalledTimes(1);
  });
});
