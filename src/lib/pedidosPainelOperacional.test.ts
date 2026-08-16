import { describe, expect, test } from "vitest";
import { pedidosVisiveisNoPainel } from "./pedidosPainelOperacional";

const AGORA = Date.parse("2026-08-17T22:00:00.000Z"); // 19:00 BRT, expediente 17/08

describe("pedidosVisiveisNoPainel", () => {
  test("mantém terminal do expediente atual", () => {
    const atual = {
      id: String(Date.parse("2026-08-17T18:00:00.000Z")),
      status: "entregue",
    };
    expect(pedidosVisiveisNoPainel([atual], AGORA)).toEqual([atual]);
  });

  test("remove da área operacional terminal de expediente anterior", () => {
    const anterior = {
      id: String(Date.parse("2026-08-17T05:30:00.000Z")), // 02:30 BRT -> expediente 16/08
      status: "entregue",
    };
    expect(pedidosVisiveisNoPainel([anterior], AGORA)).toEqual([]);
  });

  test("mantém carry-over não resolvido do expediente anterior", () => {
    const anterior = {
      id: String(Date.parse("2026-08-17T05:30:00.000Z")),
      status: "em_preparo",
    };
    expect(pedidosVisiveisNoPainel([anterior], AGORA)).toEqual([anterior]);
  });

  test("pedido criado 00:30 pertence ao expediente da noite anterior", () => {
    const depoisDaMeiaNoite = {
      id: String(Date.parse("2026-08-18T03:30:00.000Z")), // 00:30 BRT
      status: "cancelado",
    };
    const agoraAposMeiaNoite = Date.parse("2026-08-18T04:00:00.000Z"); // 01:00 BRT
    expect(pedidosVisiveisNoPainel([depoisDaMeiaNoite], agoraAposMeiaNoite)).toEqual([
      depoisDaMeiaNoite,
    ]);
  });

  test("legado terminal sem tempo confiável não some silenciosamente", () => {
    const legado = { id: "pedido-legado", status: "entregue" };
    expect(pedidosVisiveisNoPainel([legado], AGORA)).toEqual([legado]);
  });
});
