import { describe, expect, test } from "vitest";
import {
  chaveOperacionalPedidoDashboard,
  filtrarPedidosPorPeriodoDashboard,
} from "./adminDashboardPedidos";

const AGORA_24_01_51_BRT = Date.parse("2026-08-24T04:51:00.000Z");

describe("Dashboard — histórico por expediente", () => {
  test("a virada continua às 03:00 de São Paulo", () => {
    const pedidos = [
      { id: String(Date.parse("2026-08-24T02:30:00-03:00")), horario: "02:30" },
      { id: String(Date.parse("2026-08-24T03:10:00-03:00")), horario: "03:10" },
    ];

    expect(filtrarPedidosPorPeriodoDashboard(pedidos, "hoje", "", "", Date.parse("2026-08-24T03:30:00-03:00")))
      .toEqual([pedidos[1]]);
    expect(filtrarPedidosPorPeriodoDashboard(pedidos, "ontem", "", "", Date.parse("2026-08-24T03:30:00-03:00")))
      .toEqual([pedidos[0]]);
  });

  test("antes das 03:00, Hoje ainda é o expediente iniciado no dia anterior", () => {
    const pedido23Noite = { id: String(Date.parse("2026-08-23T22:00:00-03:00")), horario: "22:00" };
    const pedido24Madrugada = { id: String(Date.parse("2026-08-24T01:20:00-03:00")), horario: "01:20" };

    expect(filtrarPedidosPorPeriodoDashboard(
      [pedido23Noite, pedido24Madrugada],
      "hoje",
      "",
      "",
      AGORA_24_01_51_BRT,
    )).toEqual([pedido23Noite, pedido24Madrugada]);
  });

  test("usa ID temporal antes do campo data legado, evitando erro de fuso", () => {
    const pedido = {
      id: String(Date.parse("2026-08-23T23:30:00-03:00")),
      horario: "23:30",
      data: "24/08/2026",
    };

    expect(chaveOperacionalPedidoDashboard(pedido, AGORA_24_01_51_BRT)).toBe("2026-08-23");
  });

  test("pedido legado sem ID temporal ainda usa data + horário com corte das 03h", () => {
    expect(chaveOperacionalPedidoDashboard({ id: "legado", data: "24/08/2026", horario: "01:10" }, AGORA_24_01_51_BRT))
      .toBe("2026-08-23");
    expect(chaveOperacionalPedidoDashboard({ id: "legado", data: "24/08/2026", horario: "18:10" }, AGORA_24_01_51_BRT))
      .toBe("2026-08-24");
  });

  test("Semana representa sete expedientes incluindo o atual", () => {
    const ids = [17, 18, 23, 24].map((dia) => ({
      id: String(Date.parse(`2026-08-${String(dia).padStart(2, "0")}T18:00:00-03:00`)),
      horario: "18:00",
    }));

    expect(filtrarPedidosPorPeriodoDashboard(ids, "semana", "", "", Date.parse("2026-08-24T18:00:00-03:00")))
      .toEqual([ids[1], ids[2], ids[3]]);
  });

  test("período personalizado compara pelas chaves operacionais", () => {
    const pedidos = [
      { id: String(Date.parse("2026-08-20T22:00:00-03:00")), horario: "22:00" },
      { id: String(Date.parse("2026-08-21T01:00:00-03:00")), horario: "01:00" },
      { id: String(Date.parse("2026-08-21T18:00:00-03:00")), horario: "18:00" },
    ];

    expect(filtrarPedidosPorPeriodoDashboard(pedidos, "personalizado", "2026-08-20", "2026-08-20", Date.parse("2026-08-24T18:00:00-03:00")))
      .toEqual([pedidos[0], pedidos[1]]);
  });
});
