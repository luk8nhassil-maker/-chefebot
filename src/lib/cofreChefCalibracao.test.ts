import { describe, expect, test } from "vitest";
import { calibrarComportamentoCofre } from "./cofreChefCalibracao";
import type { EventoAnalitico } from "./historicoAnalitico";

const DIA = 24 * 60 * 60 * 1000;
const FIM = Date.parse("2026-09-27T21:00:00.000Z");
const INICIO = FIM - 90 * DIA;

function ev(clienteId: string, diasAtras: number, ticket: number, statusAnalitico: "entregue" | "estornado" = "entregue"): EventoAnalitico {
  return {
    pedidoId: clienteId + "_" + diasAtras + "_" + ticket,
    clienteId,
    tenantId: "default",
    criadoEmMs: FIM - diasAtras * DIA,
    expedienteId: "fixture",
    valorElegivelCents: ticket,
    statusAnalitico,
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
  };
}

describe("calibrarComportamentoCofre", () => {
  test("agrega somente participantes e nunca expõe clienteId no resultado", () => {
    const resultado = calibrarComportamentoCofre({
      eventos: [
        ev("cli_a", 21, 5000),
        ev("cli_a", 14, 6000),
        ev("cli_a", 7, 7000),
        ev("cli_b", 10, 4000),
        ev("cli_fora", 5, 9999),
      ],
      participantes: new Set(["cli_a", "cli_b"]),
      inicioMs: INICIO,
      fimMs: FIM,
      agoraMs: FIM,
    });

    expect(resultado.clientesParticipantesObservados).toBe(2);
    expect(resultado.ticket.pedidosValidos).toBe(4);
    expect(JSON.stringify(resultado)).not.toContain("cli_a");
    expect(JSON.stringify(resultado)).not.toContain("cli_b");
    expect(JSON.stringify(resultado)).not.toContain("cli_fora");
  });

  test("ignora estornos, ticket zero e eventos fora da janela", () => {
    const foraJanela = ev("cli_a", 100, 5000);
    const zero = { ...ev("cli_a", 8, 5000), valorElegivelCents: 0 };

    const resultado = calibrarComportamentoCofre({
      eventos: [
        ev("cli_a", 20, 5000),
        ev("cli_a", 10, 5000),
        ev("cli_a", 5, 5000, "estornado"),
        foraJanela,
        zero,
      ],
      participantes: new Set(["cli_a"]),
      inicioMs: INICIO,
      fimMs: FIM,
      agoraMs: FIM,
    });

    expect(resultado.ticket.pedidosValidos).toBe(2);
    expect(resultado.recorrencia.intervalosObservados).toBe(1);
  });

  test("cadência individual exige pelo menos 3 compras e usa 2 intervalos", () => {
    const resultado = calibrarComportamentoCofre({
      eventos: [
        ev("cli_a", 21, 5000),
        ev("cli_a", 14, 5000),
        ev("cli_a", 7, 5000),
        ev("cli_b", 14, 5000),
        ev("cli_b", 7, 5000),
      ],
      participantes: new Set(["cli_a", "cli_b"]),
      inicioMs: INICIO,
      fimMs: FIM,
      agoraMs: FIM,
    });

    expect(resultado.recorrencia.clientesComCadenciaIndividual).toBe(1);
    expect(resultado.recorrencia.clientesCom3OuMaisPedidos).toBe(1);
    expect(resultado.recorrencia.clientesCom2OuMaisPedidos).toBe(2);
    expect(resultado.recorrencia.razaoGapAtualSobreMedianaIndividual.p50).toBe(1);
  });

  test("ticket recente é comparado contra a mediana dos pedidos anteriores, sem contaminar a referência", () => {
    const resultado = calibrarComportamentoCofre({
      eventos: [
        ev("cli_a", 21, 8000),
        ev("cli_a", 14, 8000),
        ev("cli_a", 7, 4000),
      ],
      participantes: new Set(["cli_a"]),
      inicioMs: INICIO,
      fimMs: FIM,
      agoraMs: FIM,
    });

    expect(resultado.ticket.clientesComBaseParaCompararUltimoTicket).toBe(1);
    expect(resultado.ticket.razaoUltimoTicketSobreMedianaAnterior.p50).toBe(0.5);
  });

  test("não ativa regra automática nem transforma quantil em threshold", () => {
    const resultado = calibrarComportamentoCofre({
      eventos: [ev("cli_a", 21, 5000), ev("cli_a", 14, 5000), ev("cli_a", 7, 5000)],
      participantes: new Set(["cli_a"]),
      inicioMs: INICIO,
      fimMs: FIM,
      agoraMs: FIM,
    });

    expect(resultado.ativacaoAutomatica).toEqual({
      permitida: false,
      motivo: "calibracao_nao_define_regra_comercial",
    });
  });

  test("sem dados retorna quantis nulos sem inventar números", () => {
    const resultado = calibrarComportamentoCofre({
      eventos: [],
      participantes: new Set(),
      inicioMs: INICIO,
      fimMs: FIM,
      agoraMs: FIM,
    });

    expect(resultado.clientesParticipantesObservados).toBe(0);
    expect(resultado.cobertura.diasObservados).toBeNull();
    expect(resultado.recorrencia.intervaloEntrePedidosDias).toEqual({
      p25: null,
      p50: null,
      p75: null,
      p90: null,
    });
    expect(resultado.ticket.ticketElegivelCents.p50).toBeNull();
  });
});
