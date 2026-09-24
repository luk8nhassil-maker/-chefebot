import { describe, expect, test } from "vitest";
import type { EventoAnalitico } from "./historicoAnalitico";
import {
  auditarHistoricoAnteriorPreferencia,
  type EvidenciaCompraHistorica,
} from "./pesquisaPreferenciaHistorico";

const DIA = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 8, 19, 12, 0, 0);

function evento(
  clienteId: string,
  pedidoId: string,
  dia: number,
  expedienteId: string
): EventoAnalitico {
  return {
    pedidoId,
    clienteId,
    tenantId: "default",
    criadoEmMs: BASE + dia * DIA,
    expedienteId,
    valorElegivelCents: 5000,
    statusAnalitico: "entregue",
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
  };
}

describe("auditarHistoricoAnteriorPreferencia", () => {
  test("marca M1 observado como recorrente conhecido quando ledger prova compra anterior", async () => {
    const evidencias = new Map<string, EvidenciaCompraHistorica[]>([
      [
        "cid_a",
        [
          {
            pedidoId: "old_a",
            criadoEmMs: BASE - 20 * DIA,
            fonte: "fidelidade_pontos",
          },
        ],
      ],
    ]);

    const resumo = await auditarHistoricoAnteriorPreferencia({
      eventos: [
        evento("cid_a", "a1", 0, "exp-a1"),
        evento("cid_b", "b1", 0, "exp-b1"),
      ],
      janelaInicioMs: BASE,
      carregarEvidencias: async (clienteId) => evidencias.get(clienteId) ?? [],
    });

    expect(resumo.m1Observado).toBe(2);
    expect(resumo.m1ComCompraAnteriorComprovada).toBe(1);
    expect(resumo.m1SemEvidenciaAnteriorComprovada).toBe(1);
    expect(resumo.evidenciaMaisAntigaIso).toBe(
      new Date(BASE - 20 * DIA).toISOString()
    );
  });

  test("identifica M2 observado que já era pelo menos terceira compra conhecida", async () => {
    const resumo = await auditarHistoricoAnteriorPreferencia({
      eventos: [
        evento("cid_a", "a1", 0, "exp-a1"),
        evento("cid_a", "a2", 2, "exp-a2"),
        evento("cid_b", "b1", 0, "exp-b1"),
        evento("cid_b", "b2", 3, "exp-b2"),
      ],
      janelaInicioMs: BASE,
      carregarEvidencias: async (clienteId) =>
        clienteId === "cid_a"
          ? [
              {
                pedidoId: "old_a",
                criadoEmMs: BASE - 5 * DIA,
                fonte: "fidelidade_legado",
              },
            ]
          : [],
    });

    expect(resumo.m2Observado).toBe(2);
    expect(resumo.m2ComCompraAnteriorAntesDaPrimeiraObservada).toBe(1);
    expect(resumo.m2SemEvidenciaAnteriorComprovada).toBe(1);
  });

  test("não trata movimento do mesmo pedido analítico como histórico anterior", async () => {
    const resumo = await auditarHistoricoAnteriorPreferencia({
      eventos: [evento("cid_a", "pedido_mesmo", 0, "exp-a1")],
      janelaInicioMs: BASE,
      carregarEvidencias: async () => [
        {
          pedidoId: "pedido_mesmo",
          criadoEmMs: BASE - 1000,
          fonte: "fidelidade_pontos",
        },
      ],
    });

    expect(resumo.m1ComCompraAnteriorComprovada).toBe(0);
  });

  test("colapsa pedidos do mesmo expediente antes de decidir M2", async () => {
    const resumo = await auditarHistoricoAnteriorPreferencia({
      eventos: [
        evento("cid_a", "a1", 0, "exp-1"),
        evento("cid_a", "a2", 0.01, "exp-1"),
        evento("cid_a", "a3", 2, "exp-2"),
      ],
      janelaInicioMs: BASE,
      carregarEvidencias: async () => [],
    });

    expect(resumo.m1Observado).toBe(1);
    expect(resumo.m2Observado).toBe(1);
  });

  test("ausência de ledger continua explicitamente inconclusiva", async () => {
    const resumo = await auditarHistoricoAnteriorPreferencia({
      eventos: [evento("cid_a", "a1", 0, "exp-a1")],
      janelaInicioMs: BASE,
      carregarEvidencias: async () => [],
    });

    expect(resumo.m1SemEvidenciaAnteriorComprovada).toBe(1);
    expect(resumo.aviso).toMatch(/não prova primeira compra vitalícia/i);
  });

  test("ignora evidência sem pedido ou timestamp válido", async () => {
    const resumo = await auditarHistoricoAnteriorPreferencia({
      eventos: [evento("cid_a", "a1", 0, "exp-a1")],
      janelaInicioMs: BASE,
      carregarEvidencias: async () =>
        [
          {
            pedidoId: "",
            criadoEmMs: BASE - DIA,
            fonte: "fidelidade_pontos",
          },
          {
            pedidoId: "old",
            criadoEmMs: Number.NaN,
            fonte: "fidelidade_legado",
          },
        ] as EvidenciaCompraHistorica[],
    });

    expect(resumo.m1ComCompraAnteriorComprovada).toBe(0);
    expect(resumo.evidenciaMaisAntigaIso).toBeNull();
  });
});
