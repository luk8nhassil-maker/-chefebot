import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  eventosPeriodoMock,
  eventosAntesMock,
  validarMock,
  gateMock,
  customerKeyMock,
} = vi.hoisted(() => ({
  eventosPeriodoMock: vi.fn(),
  eventosAntesMock: vi.fn(),
  validarMock: vi.fn(),
  gateMock: vi.fn(),
  customerKeyMock: vi.fn(),
}));

vi.mock("./historicoAnalitico", async (importOriginal) => {
  const original = await importOriginal<typeof import("./historicoAnalitico")>();
  return {
    ...original,
    consultarEventosPorPeriodo: eventosPeriodoMock,
    consultarEventosAntesDe: eventosAntesMock,
  };
});

vi.mock("./pesquisaPreferenciaCandidato", () => ({
  validarCandidatoMomentoControlado: validarMock,
}));

vi.mock("./pesquisaPreferenciaElegibilidadeCompleta.server", () => ({
  avaliarElegibilidadeContatoPesquisaCompleta: gateMock,
}));

vi.mock("./pesquisaPreferenciaContatosRedis", () => ({
  derivarResearchCustomerKey: customerKeyMock,
}));

import {
  resolverCandidatoPrimeiroEnvioM5,
  resumirPrimeiroEnvioM5,
} from "./pesquisaPreferenciaPrimeiroEnvio.server";

const AGORA = Date.UTC(2026, 9, 20, 12, 0, 0);

function ev(clienteId: string, pedidoId: string, criadoEmMs: number) {
  return {
    pedidoId,
    clienteId,
    tenantId: "default",
    criadoEmMs,
    expedienteId: `exp-${pedidoId}`,
    valorElegivelCents: 5000,
    statusAnalitico: "entregue" as const,
    canal: "app" as const,
    estrelasGeradas: 5,
    schemaVersao: 1 as const,
    regraVersao: "estrelas-faixas-v1" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  eventosAntesMock.mockResolvedValue([]);
  eventosPeriodoMock.mockResolvedValue([
    ev("cli_5599999990001", "p1", AGORA - 10_000),
    ev("cli_5599999990002", "p2", AGORA - 20_000),
  ]);
  validarMock.mockImplementation(({ clienteId }: { clienteId: string }) => ({
    valido: clienteId.endsWith("0002"),
    motivo: clienteId.endsWith("0002") ? "ok" : "cliente_nao_esta_em_queda_m5",
  }));
  customerKeyMock.mockImplementation((telefone: string) =>
    telefone ? "a".repeat(64) : null
  );
  gateMock.mockResolvedValue({
    elegibilidade: {
      status: "suprimido",
      motivos: ["fontes_operacionais_incompletas"],
      contatosUltimos14Dias: 0,
      contatosUltimos90Dias: 0,
    },
    diagnostico: {},
  });
});

describe("resumirPrimeiroEnvioM5", () => {
  test("retorna somente agregado + referência opaca do primeiro candidato", async () => {
    const resumo = await resumirPrimeiroEnvioM5({ agoraMs: AGORA });

    expect(resumo.candidatosComportamentais).toBe(1);
    expect(resumo.candidatosSemBloqueioAutomatico).toBe(1);
    expect(resumo.prontoParaConfirmacaoManual).toBe(true);
    expect(resumo.primeiroCandidato?.candidateRef).toMatch(/^[a-f0-9]{64}$/);
    expect(resumo.primeiroCandidato?.telefoneMascarado).toBe("…0002");
    expect(JSON.stringify(resumo.primeiroCandidato)).not.toContain(
      "5599999990002"
    );
  });

  test("qualquer bloqueio automático além das fontes manuais retira candidato", async () => {
    gateMock.mockResolvedValue({
      elegibilidade: {
        status: "suprimido",
        motivos: ["fontes_operacionais_incompletas", "cooldown_14_dias"],
        contatosUltimos14Dias: 1,
        contatosUltimos90Dias: 1,
      },
      diagnostico: {},
    });

    const resumo = await resumirPrimeiroEnvioM5({ agoraMs: AGORA });

    expect(resumo.candidatosComportamentais).toBe(1);
    expect(resumo.candidatosSemBloqueioAutomatico).toBe(0);
    expect(resumo.primeiroCandidato).toBeNull();
  });

  test("sem M5 real não inventa candidato", async () => {
    validarMock.mockReturnValue({
      valido: false,
      motivo: "cliente_nao_esta_em_queda_m5",
    });

    const resumo = await resumirPrimeiroEnvioM5({ agoraMs: AGORA });

    expect(resumo).toMatchObject({
      candidatosComportamentais: 0,
      candidatosSemBloqueioAutomatico: 0,
      prontoParaConfirmacaoManual: false,
      primeiroCandidato: null,
    });
  });
});

describe("resolverCandidatoPrimeiroEnvioM5", () => {
  test("rejeita referência arbitrária", async () => {
    await expect(
      resolverCandidatoPrimeiroEnvioM5({
        candidateRef: "telefone-do-cliente",
        agoraMs: AGORA,
      })
    ).resolves.toBeNull();
  });

  test("resolve apenas a referência opaca do candidato atual", async () => {
    const resumo = await resumirPrimeiroEnvioM5({ agoraMs: AGORA });
    const ref = resumo.primeiroCandidato!.candidateRef;

    const resolvido = await resolverCandidatoPrimeiroEnvioM5({
      candidateRef: ref,
      agoraMs: AGORA,
    });

    expect(resolvido).toEqual({
      telefone: "5599999990002",
      triggerEventId: "p2",
    });
  });
});
