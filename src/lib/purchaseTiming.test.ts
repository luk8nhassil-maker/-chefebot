import { describe, expect, test } from "vitest";
import type { EventoAnalitico } from "./historicoAnalitico";
import { calcularRitmoCompraCliente } from "./purchaseTiming";

function evento(dataIso: string, overrides: Partial<EventoAnalitico> = {}): EventoAnalitico {
  return {
    pedidoId: Math.random().toString(36),
    clienteId: "cli_1",
    tenantId: "default",
    criadoEmMs: new Date(dataIso).getTime(),
    expedienteId: "exp",
    valorElegivelCents: 6000,
    statusAnalitico: "entregue",
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
    ...overrides,
  };
}

describe("calcularRitmoCompraCliente", () => {
  test("não inventa padrão com menos de 3 pedidos", () => {
    const perfil = calcularRitmoCompraCliente([
      evento("2026-08-05T22:00:00Z"),
      evento("2026-09-06T22:00:00Z"),
    ]);
    expect(perfil.faseMes).toBe("insuficiente");
    expect(perfil.confianca).toBe("insuficiente");
    expect(perfil.janelaProvavel).toBeNull();
  });

  test("identifica concentração no começo do mês e janela provável", () => {
    const perfil = calcularRitmoCompraCliente([
      evento("2026-04-04T22:00:00Z"),
      evento("2026-05-05T22:00:00Z"),
      evento("2026-06-06T22:00:00Z"),
      evento("2026-07-05T22:00:00Z"),
      evento("2026-08-07T22:00:00Z"),
      evento("2026-09-05T22:00:00Z"),
    ]);
    expect(perfil.faseMes).toBe("inicio");
    expect(perfil.concentracaoPercentual).toBe(100);
    expect(perfil.confianca).toBe("alta");
    expect(perfil.diaCentralProvavel).toBe(5);
    expect(perfil.janelaProvavel).toEqual({ inicioDia: 3, fimDia: 7 });
  });

  test("identifica padrão no fim do mês", () => {
    const perfil = calcularRitmoCompraCliente([
      evento("2026-04-24T22:00:00Z"),
      evento("2026-05-25T22:00:00Z"),
      evento("2026-06-27T22:00:00Z"),
      evento("2026-07-25T22:00:00Z"),
    ]);
    expect(perfil.faseMes).toBe("fim");
    expect(perfil.confianca).toBe("media");
    expect(perfil.janelaProvavel).toEqual({ inicioDia: 23, fimDia: 27 });
  });

  test("marca como distribuído quando não existe fase dominante", () => {
    const perfil = calcularRitmoCompraCliente([
      evento("2026-04-05T22:00:00Z"),
      evento("2026-05-15T22:00:00Z"),
      evento("2026-06-25T22:00:00Z"),
      evento("2026-07-06T22:00:00Z"),
      evento("2026-08-16T22:00:00Z"),
      evento("2026-09-26T22:00:00Z"),
    ]);
    expect(perfil.faseMes).toBe("distribuido");
    expect(perfil.confianca).toBe("baixa");
  });

  test("ignora evento estornado", () => {
    const perfil = calcularRitmoCompraCliente([
      evento("2026-04-05T22:00:00Z"),
      evento("2026-05-06T22:00:00Z"),
      evento("2026-06-07T22:00:00Z"),
      evento("2026-07-25T22:00:00Z", { statusAnalitico: "estornado" }),
    ]);
    expect(perfil.pedidosAnalisados).toBe(3);
    expect(perfil.faseMes).toBe("inicio");
  });
});
