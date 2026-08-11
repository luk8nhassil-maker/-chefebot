import { describe, expect, test } from "vitest";
import { detectarPedidosParaAutoPrint, pixConfirmadoNoPedido } from "./PainelAutoPrintWatcher";

describe("PainelAutoPrintWatcher", () => {
  test("considera Pix confirmado pelos dois campos aceitos pelo backend", () => {
    expect(pixConfirmadoNoPedido({ pixConfirmado: true })).toBe(true);
    expect(pixConfirmadoNoPedido({ pix: { status: "confirmado" } })).toBe(true);
    expect(pixConfirmadoNoPedido({ pixConfirmado: false, pix: { status: "pendente" } })).toBe(false);
  });

  test("novo pedido do painel vira candidato", () => {
    expect(detectarPedidosParaAutoPrint(new Map(), [{ id: "p1", origem: "painel" }])).toEqual(["p1"]);
  });

  test("pedido de outro canal nunca vira candidato", () => {
    expect(detectarPedidosParaAutoPrint(new Map(), [{ id: "p1", origem: "site" }])).toEqual([]);
  });

  test("Pix do painel vira candidato quando muda de pendente para confirmado", () => {
    const anteriores = new Map([["p1", false]]);
    expect(detectarPedidosParaAutoPrint(anteriores, [{ id: "p1", origem: "painel", pixConfirmado: true }])).toEqual(["p1"]);
  });

  test("pedido ja observado sem transicao nao repete tentativa", () => {
    const anteriores = new Map([["p1", true]]);
    expect(detectarPedidosParaAutoPrint(anteriores, [{ id: "p1", origem: "painel", pixConfirmado: true }])).toEqual([]);
  });
});
