import { describe, expect, test } from "vitest";
import type { EventoAnalitico } from "./historicoAnalitico";
import { calcularRadarVendas } from "./radarVendas";

function ev(clienteId: string, iso: string, valor = 6000): EventoAnalitico {
  const ms = new Date(iso).getTime();
  return {
    pedidoId: String(ms),
    clienteId,
    tenantId: "default",
    criadoEmMs: ms,
    expedienteId: "exp",
    valorElegivelCents: valor,
    statusAnalitico: "entregue",
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
  };
}

describe("calcularRadarVendas", () => {
  test("não cria oportunidade com menos de 3 pedidos", () => {
    const r = calcularRadarVendas([
      ev("cli_5599991111", "2026-08-05T22:00:00-03:00"),
      ev("cli_5599991111", "2026-09-05T22:00:00-03:00"),
    ], new Date("2026-10-05T18:00:00-03:00").getTime());
    expect(r.oportunidades).toHaveLength(0);
    expect(r.resumo.clientesAnalisados).toBe(1);
  });

  test("cliente em janela forte recebe meta de ticket sem desconto direto", () => {
    const eventos = [
      ev("cli_5599991111", "2026-05-05T20:00:00-03:00", 6000),
      ev("cli_5599991111", "2026-06-05T20:00:00-03:00", 7000),
      ev("cli_5599991111", "2026-07-06T20:00:00-03:00", 6500),
      ev("cli_5599991111", "2026-08-05T20:00:00-03:00", 7000),
      ev("cli_5599991111", "2026-09-05T20:00:00-03:00", 6500),
      ev("cli_5599991111", "2026-10-04T20:00:00-03:00", 7000),
    ];
    const r = calcularRadarVendas(eventos, new Date("2026-11-05T18:00:00-03:00").getTime());
    expect(r.oportunidades[0]).toMatchObject({
      clienteRef: "•••• 1111",
      confianca: "alta",
      emJanelaAgora: true,
      acao: "meta_ticket",
    });
    expect(r.oportunidades[0]!.metaTicketCents).toBeGreaterThan(r.oportunidades[0]!.ticketMedioCents);
    expect(r.oportunidades[0]!.incrementoTicketPotencialCents).toBe(
      r.oportunidades[0]!.metaTicketCents - r.oportunidades[0]!.ticketMedioCents,
    );
    expect(r.resumo.altaConfianca).toBe(1);
    expect(r.resumo.oportunidadesMetaTicket).toBe(1);
    expect(r.resumo.potencialTicketAdicionalCents).toBe(
      r.oportunidades[0]!.incrementoTicketPotencialCents,
    );
  });

  test("não chama reativação de ganho adicional de ticket", () => {
    const eventos = [
      ev("cli_5599994444", "2026-01-05T20:00:00-03:00", 5500),
      ev("cli_5599994444", "2026-02-05T20:00:00-03:00", 6000),
      ev("cli_5599994444", "2026-03-05T20:00:00-03:00", 6500),
    ];
    const r = calcularRadarVendas(eventos, new Date("2026-06-20T18:00:00-03:00").getTime());
    expect(r.oportunidades[0]!.acao).toBe("reativar");
    expect(r.resumo.oportunidadesMetaTicket).toBe(0);
    expect(r.resumo.potencialTicketAdicionalCents).toBe(0);
  });

  test("cliente atrasado no ciclo vira reativação fora da janela", () => {
    const eventos = [
      ev("cli_5599992222", "2026-01-05T20:00:00-03:00"),
      ev("cli_5599992222", "2026-02-05T20:00:00-03:00"),
      ev("cli_5599992222", "2026-03-05T20:00:00-03:00"),
      ev("cli_5599992222", "2026-04-05T20:00:00-03:00"),
    ];
    const r = calcularRadarVendas(eventos, new Date("2026-06-20T18:00:00-03:00").getTime());
    expect(r.oportunidades[0]!.acao).toBe("reativar");
    expect(r.oportunidades[0]!.diasDesdeUltimaCompra).toBeGreaterThan(60);
  });

  test("nunca expõe clienteId completo na oportunidade", () => {
    const eventos = [
      ev("cli_5599993333", "2026-07-05T20:00:00-03:00"),
      ev("cli_5599993333", "2026-08-05T20:00:00-03:00"),
      ev("cli_5599993333", "2026-09-05T20:00:00-03:00"),
    ];
    const r = calcularRadarVendas(eventos, new Date("2026-10-05T18:00:00-03:00").getTime());
    const serializado = JSON.stringify(r.oportunidades);
    expect(serializado).not.toContain("cli_5599993333");
    expect(serializado).not.toContain("5599993333");
    expect(serializado).toContain("3333");
  });
});
