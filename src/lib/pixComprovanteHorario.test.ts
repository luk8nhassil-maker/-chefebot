import { describe, expect, test } from "vitest";

import {
  avaliarHorarioComprovantePix,
  extrairDataHoraComprovantePix,
} from "./pixComprovanteHorario";

const pedido = {
  dataPedido: "04/07/2026",
  horarioPedido: "19:30",
};

describe("horario do comprovante Pix", () => {
  test("comprovante depois do pedido deve passar", () => {
    const resultado = avaliarHorarioComprovantePix({
      ...pedido,
      textoComprovante: "Pagamento em 04/07/2026 19:42",
    });

    expect(resultado.bloquear).toBe(false);
    expect(resultado.motivo).toBe("ok");
    expect(resultado.diferencaMinutos).toBe(12);
  });

  test("comprovante ate 10 minutos antes do pedido passa por tolerancia", () => {
    const resultado = avaliarHorarioComprovantePix({
      ...pedido,
      textoComprovante: "Pagamento em 04/07/2026 as 19:20",
    });

    expect(resultado.bloquear).toBe(false);
    expect(resultado.motivo).toBe("ok");
    expect(resultado.diferencaMinutos).toBe(-10);
  });

  test("comprovante 30 minutos antes do pedido deve bloquear", () => {
    const resultado = avaliarHorarioComprovantePix({
      ...pedido,
      textoComprovante: "Pagamento em 04/07/2026 19:00",
    });

    expect(resultado.bloquear).toBe(true);
    expect(resultado.motivo).toBe("pagamento_anterior");
  });

  test("comprovante com apenas data e sem hora nao bloqueia nesta etapa", () => {
    const resultado = avaliarHorarioComprovantePix({
      ...pedido,
      textoComprovante: "Data do pagamento: 04/07/2026",
    });

    expect(resultado.bloquear).toBe(false);
    expect(resultado.motivo).toBe("sem_horario");
  });

  test("horario ilegivel ou inexistente nao bloqueia nesta etapa", () => {
    const resultado = avaliarHorarioComprovantePix({
      ...pedido,
      textoComprovante: "Comprovante Pix aprovado agora pouco",
    });

    expect(resultado.bloquear).toBe(false);
    expect(resultado.motivo).toBe("sem_horario");
  });

  test("data claramente diferente invalida", () => {
    const resultado = avaliarHorarioComprovantePix({
      ...pedido,
      textoComprovante: "Pagamento em 03/07/2026 19:42",
    });

    expect(resultado.bloquear).toBe(true);
    expect(resultado.motivo).toBe("data_diferente");
  });

  test("aceita formatos brasileiros comuns", () => {
    expect(extrairDataHoraComprovantePix("04/07/2026 19:42")).toMatchObject({
      data: "2026-07-04",
      hora: "19:42",
    });
    expect(extrairDataHoraComprovantePix("04/07/2026 as 19:42")).toMatchObject({
      data: "2026-07-04",
      hora: "19:42",
    });
    expect(extrairDataHoraComprovantePix("19:42", "04/07/2026")).toMatchObject({
      data: "2026-07-04",
      hora: "19:42",
    });
    expect(extrairDataHoraComprovantePix("2026-07-04T19:42:00")).toMatchObject({
      data: "2026-07-04",
      hora: "19:42",
    });
  });

  test("combina data e horario em linhas separadas", () => {
    expect(extrairDataHoraComprovantePix("Data: 04/07/2026\nHora: 19:42")).toMatchObject({
      data: "2026-07-04",
      hora: "19:42",
    });
  });
});
