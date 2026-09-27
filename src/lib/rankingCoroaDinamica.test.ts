import { describe, expect, test } from "vitest";
import type { EventoAnalitico } from "./historicoAnalitico";
import {
  calcularJanelaSemanaAnteriorOperacional,
  calcularReferenciaCoroaDosEventos,
} from "./rankingCoroaDinamica";

function evento(
  overrides: Partial<EventoAnalitico> = {},
): EventoAnalitico {
  return {
    pedidoId: overrides.pedidoId ?? "p1",
    clienteId: overrides.clienteId ?? "c1",
    tenantId: overrides.tenantId ?? "default",
    criadoEmMs: overrides.criadoEmMs ?? Date.parse("2026-09-16T22:00:00.000Z"),
    expedienteId: overrides.expedienteId ?? "2026-09-16",
    valorElegivelCents: overrides.valorElegivelCents ?? 5000,
    statusAnalitico: overrides.statusAnalitico ?? "entregue",
    canal: overrides.canal ?? "app",
    estrelasGeradas: overrides.estrelasGeradas ?? 5,
    schemaVersao: 1,
    regraVersao: overrides.regraVersao ?? "estrelas-faixas-v1",
    ...(overrides.estornadoEmMs !== undefined
      ? { estornadoEmMs: overrides.estornadoEmMs }
      : {}),
  };
}

describe("Coroa dinâmica — semana operacional anterior", () => {
  test("domingo usa a semana anterior completa de segunda a domingo", () => {
    const agora = Date.parse("2026-09-27T19:00:00.000Z"); // domingo 16h BRT
    const janela = calcularJanelaSemanaAnteriorOperacional(agora);
    expect(janela.inicioExpedienteId).toBe("2026-09-14");
    expect(janela.fimExpedienteId).toBe("2026-09-20");
  });

  test("segunda antes das 03h ainda pertence ao domingo operacional", () => {
    const agora = Date.parse("2026-09-28T05:00:00.000Z"); // segunda 02h BRT
    const janela = calcularJanelaSemanaAnteriorOperacional(agora);
    expect(janela.inicioExpedienteId).toBe("2026-09-14");
    expect(janela.fimExpedienteId).toBe("2026-09-20");
  });

  test("segunda depois das 03h vira a referência para a semana imediatamente anterior", () => {
    const agora = Date.parse("2026-09-28T07:00:00.000Z"); // segunda 04h BRT
    const janela = calcularJanelaSemanaAnteriorOperacional(agora);
    expect(janela.inicioExpedienteId).toBe("2026-09-21");
    expect(janela.fimExpedienteId).toBe("2026-09-27");
  });
});

describe("Coroa dinâmica — ticket elegível e Estrelas", () => {
  const janela = {
    inicioExpedienteId: "2026-09-14",
    fimExpedienteId: "2026-09-20",
  };

  test("usa somente entregues elegíveis dentro da semana e converte o ticket médio pela regra oficial", () => {
    const referencia = calcularReferenciaCoroaDosEventos([
      evento({ pedidoId: "inclui-1", expedienteId: "2026-09-14", valorElegivelCents: 3000 }),
      evento({ pedidoId: "inclui-2", expedienteId: "2026-09-20", valorElegivelCents: 5000 }),
      evento({ pedidoId: "fora-antes", expedienteId: "2026-09-13", valorElegivelCents: 15000 }),
      evento({ pedidoId: "fora-depois", expedienteId: "2026-09-21", valorElegivelCents: 15000 }),
      evento({ pedidoId: "estornado", expedienteId: "2026-09-18", valorElegivelCents: 15000, statusAnalitico: "estornado" }),
      evento({ pedidoId: "zero", expedienteId: "2026-09-18", valorElegivelCents: 0 }),
    ], janela);

    expect(referencia).toEqual({
      inicioExpedienteId: "2026-09-14",
      fimExpedienteId: "2026-09-20",
      pedidosValidos: 2,
      ticketMedioElegivelCents: 4000,
      maxGapEstrelas: 5,
    });
  });

  test("acompanha automaticamente a faixa do ticket médio, sem limiar fixo", () => {
    const cinco = calcularReferenciaCoroaDosEventos([
      evento({ valorElegivelCents: 6999 }),
    ], janela);
    const sete = calcularReferenciaCoroaDosEventos([
      evento({ valorElegivelCents: 7000 }),
    ], janela);
    const nove = calcularReferenciaCoroaDosEventos([
      evento({ valorElegivelCents: 10000 }),
    ], janela);

    expect(cinco?.maxGapEstrelas).toBe(5);
    expect(sete?.maxGapEstrelas).toBe(7);
    expect(nove?.maxGapEstrelas).toBe(9);
  });

  test("sem pedido entregue elegível na semana anterior fica fail-closed", () => {
    expect(calcularReferenciaCoroaDosEventos([
      evento({ statusAnalitico: "estornado" }),
      evento({ valorElegivelCents: 0 }),
      evento({ expedienteId: "2026-09-21" }),
    ], janela)).toBeNull();
  });
});
