import { describe, expect, it } from "vitest";
import { enriquecerPedidosComComanda } from "./pedidoComandaPainel.server";

describe("painel — vínculo estável entre pedidos e comanda", () => {
  it("liga todas as rodadas pelo pedidoId oficial, sem depender de nome ou observação", () => {
    const pedidos = [
      { id: "ped-1", cliente: "TESTE" },
      { id: "ped-2", cliente: "TESTE" },
      { id: "delivery-1", cliente: "TESTE" },
    ];
    const comandas = [{
      id: "comanda-abc",
      numero: 7,
      mesa: "12",
      complemento: "Varanda",
      rodadas: [
        { numero: 1, pedidoId: "ped-1" },
        { numero: 2, pedidoId: "ped-2" },
      ],
    }];

    const resultado = enriquecerPedidosComComanda(pedidos, comandas);

    expect(resultado[0]).toMatchObject({
      id: "ped-1",
      comandaId: "comanda-abc",
      comandaNumero: 7,
      rodadaNumero: 1,
      comandaMesa: "12",
      comandaComplemento: "Varanda",
    });
    expect(resultado[1]).toMatchObject({
      id: "ped-2",
      comandaId: "comanda-abc",
      comandaNumero: 7,
      rodadaNumero: 2,
    });
    expect(resultado[2]).toEqual(pedidos[2]);
  });

  it("mantém compatibilidade com comanda antiga sem array de rodadas", () => {
    const [pedido] = enriquecerPedidosComComanda(
      [{ id: "pedido-legado" }],
      [{ id: "comanda-legada", numero: 3, pedidoId: "pedido-legado" }],
    );

    expect(pedido).toMatchObject({
      comandaId: "comanda-legada",
      comandaNumero: 3,
      rodadaNumero: 1,
    });
  });

  it("não cria família por coincidência de cliente quando a comanda não aponta para o pedido", () => {
    const [pedido] = enriquecerPedidosComComanda(
      [{ id: "outro-pedido", cliente: "Maria" }],
      [{ id: "c1", numero: 1, rodadas: [{ numero: 1, pedidoId: "pedido-da-comanda" }] }],
    );

    expect(pedido).toEqual({ id: "outro-pedido", cliente: "Maria" });
  });
});
