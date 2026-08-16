import { describe, expect, test } from "vitest";
import {
  HORA_VIRADA_EXPEDIENTE,
  chaveExpedienteDoPedido,
  chaveExpedienteOperacional,
  dataBrExpedienteOperacional,
  pertenceAoExpedienteAtual,
  timestampCriacaoPedido,
} from "./expedienteOperacional";

describe("expediente operacional", () => {
  test("fixa a virada às 03:00", () => {
    expect(HORA_VIRADA_EXPEDIENTE).toBe(3);
  });

  test("02:59 de São Paulo ainda pertence ao expediente anterior", () => {
    expect(chaveExpedienteOperacional(Date.parse("2026-08-17T05:59:00.000Z"))).toBe("2026-08-16");
  });

  test("03:00 de São Paulo inicia o novo expediente", () => {
    expect(chaveExpedienteOperacional(Date.parse("2026-08-17T06:00:00.000Z"))).toBe("2026-08-17");
  });

  test("00:30 do dia seguinte continua no mesmo expediente da noite anterior", () => {
    expect(chaveExpedienteOperacional(Date.parse("2026-08-18T03:30:00.000Z"))).toBe("2026-08-17");
  });

  test("formata a data legada usando a mesma chave operacional", () => {
    expect(dataBrExpedienteOperacional(Date.parse("2026-08-18T03:30:00.000Z"))).toBe("17/08/2026");
  });
});

describe("pedido e expediente", () => {
  const agora = Date.parse("2026-08-17T22:00:00.000Z");

  test("prefere criadoEm explícito", () => {
    const pedido = {
      id: String(agora - 1000),
      criadoEm: "2026-08-17T05:30:00.000Z",
    };
    expect(timestampCriacaoPedido(pedido, agora)).toBe(Date.parse("2026-08-17T05:30:00.000Z"));
    expect(chaveExpedienteDoPedido(pedido, agora)).toBe("2026-08-16");
  });

  test("aceita ID oficial com dígito de desempate sem perder o timestamp", () => {
    const ts = Date.parse("2026-08-17T06:05:00.000Z");
    const pedido = { id: `${ts}7` };
    expect(timestampCriacaoPedido(pedido, agora)).toBe(ts);
    expect(chaveExpedienteDoPedido(pedido, agora)).toBe("2026-08-17");
  });

  test("chave persistida é a fonte preferida para pedidos novos", () => {
    expect(
      chaveExpedienteDoPedido(
        { id: "legado-sem-timestamp", expedienteOperacional: "2026-08-16" },
        agora
      )
    ).toBe("2026-08-16");
  });

  test("identifica pedido do expediente atual e carry-over do anterior", () => {
    const atual = { id: String(Date.parse("2026-08-17T20:00:00.000Z")) };
    const anterior = { id: String(Date.parse("2026-08-17T05:50:00.000Z")) };
    expect(pertenceAoExpedienteAtual(atual, agora)).toBe(true);
    expect(pertenceAoExpedienteAtual(anterior, agora)).toBe(false);
  });

  test("dado sem tempo determinável falha fechado", () => {
    expect(chaveExpedienteDoPedido({ id: "abc" }, agora)).toBeNull();
    expect(pertenceAoExpedienteAtual({ id: "abc" }, agora)).toBe(false);
  });
});
