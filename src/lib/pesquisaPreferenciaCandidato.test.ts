import { describe, expect, test } from "vitest";
import type { EventoAnalitico } from "./historicoAnalitico";
import { validarCandidatoMomentoControlado } from "./pesquisaPreferenciaCandidato";

const DIA = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 8, 1, 12, 0, 0);

function ev(
  clienteId: string,
  pedidoId: string,
  dia: number,
  expedienteId = `exp-${pedidoId}`
): EventoAnalitico {
  return {
    pedidoId,
    clienteId,
    tenantId: "default",
    criadoEmMs: BASE + dia * DIA,
    expedienteId,
    valorElegivelCents: 5000,
    statusAnalitico: "entregue",
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
  };
}

describe("validarCandidatoMomentoControlado", () => {
  test("M1 exige pedido da primeira ocasião observada", () => {
    const eventos = [
      ev("cli_a", "a1", 0),
      ev("cli_a", "a2", 3),
    ];

    expect(
      validarCandidatoMomentoControlado({
        eventos,
        clienteId: "cli_a",
        momentId: "M1",
        triggerEventId: "a1",
        agoraMs: BASE + 5 * DIA,
      })
    ).toEqual({ valido: true, motivo: "ok" });

    expect(
      validarCandidatoMomentoControlado({
        eventos,
        clienteId: "cli_a",
        momentId: "M1",
        triggerEventId: "a2",
        agoraMs: BASE + 5 * DIA,
      }).valido
    ).toBe(false);
  });

  test("M2 exige pedido da segunda ocasião, colapsando mesmo expediente", () => {
    const eventos = [
      ev("cli_a", "a1", 0, "exp-1"),
      ev("cli_a", "a1b", 0.01, "exp-1"),
      ev("cli_a", "a2", 3, "exp-2"),
    ];

    expect(
      validarCandidatoMomentoControlado({
        eventos,
        clienteId: "cli_a",
        momentId: "M2",
        triggerEventId: "a2",
        agoraMs: BASE + 5 * DIA,
      })
    ).toEqual({ valido: true, motivo: "ok" });
  });

  test("M5 exige ao menos três ocasiões", () => {
    const eventos = [ev("cli_a", "a1", 0), ev("cli_a", "a2", 2)];

    expect(
      validarCandidatoMomentoControlado({
        eventos,
        clienteId: "cli_a",
        momentId: "M5",
        triggerEventId: "a2",
        agoraMs: BASE + 20 * DIA,
      })
    ).toEqual({
      valido: false,
      motivo: "historico_insuficiente_para_m5",
    });
  });

  test("M5 replica a faixa S5 e não captura S6", () => {
    const eventos = [
      ev("cli_a", "a1", 0),
      ev("cli_a", "a2", 2),
      ev("cli_a", "a3", 4),
      ev("cli_b", "b1", 0),
      ev("cli_b", "b2", 2),
      ev("cli_b", "b3", 4),
      ev("cli_c", "c1", -8),
      ev("cli_c", "c2", -6),
      ev("cli_c", "c3", 4),
    ];

    const s5 = validarCandidatoMomentoControlado({
      eventos,
      clienteId: "cli_a",
      momentId: "M5",
      triggerEventId: "a3",
      agoraMs: BASE + 7 * DIA,
    });
    expect(s5).toEqual({ valido: true, motivo: "ok" });

    const s6 = validarCandidatoMomentoControlado({
      eventos,
      clienteId: "cli_a",
      momentId: "M5",
      triggerEventId: "a3",
      agoraMs: BASE + 20 * DIA,
    });
    expect(s6).toEqual({
      valido: false,
      motivo: "cliente_nao_esta_em_queda_m5",
    });
  });

  test("momento fora do piloto não é aceito", () => {
    expect(
      validarCandidatoMomentoControlado({
        eventos: [ev("cli_a", "a1", 0)],
        clienteId: "cli_a",
        momentId: "M3",
        triggerEventId: "a1",
        agoraMs: BASE + DIA,
      })
    ).toEqual({ valido: false, motivo: "momento_nao_permitido" });
  });
});
