import { describe, expect, test } from "vitest";
import { acaoPrincipal, classificarPendencia, modalidadePedidoOperacional, type PedidoLimpeza } from "./limpezaOperacionalPedidos";

const AGORA = Date.parse("2026-07-30T20:00:00.000Z");
const MIN = 60_000;

describe("compatibilidade operacional histórica do Chefe", () => {
  test("pedido legado sem tipoEntrega continua sendo Delivery, nunca retirada", () => {
    const pedido: PedidoLimpeza = {
      id: String(AGORA - 180 * MIN),
      cliente: "Cliente legado",
      status: "saiu_entrega",
      endereco: "Rua Exemplo, 123",
      statusAtualizadoEm: new Date(AGORA - 20 * MIN).toISOString(),
    };

    expect(modalidadePedidoOperacional(pedido)).toBe("delivery");
    const pendencia = classificarPendencia(pedido, AGORA);
    expect(pendencia).toMatchObject({
      motivo: "entrega_longa",
      modalidade: "delivery",
      titulo: "Essa entrega precisa de uma confirmação",
    });
    expect(acaoPrincipal(pendencia!)).toMatchObject({ label: "JÁ FOI ENTREGUE", status: "entregue" });
  });
});
