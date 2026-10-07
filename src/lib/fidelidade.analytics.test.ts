import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./redis", () => ({
  redis: {
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
  },
}));
vi.mock("./estrelas", () => ({ REGRA_ESTRELAS_V1: "estrelas-faixas-v1", META_ESTRELAS_V1: 50, calcularEstrelasPorValorElegivel: vi.fn() }));
vi.mock("./clientes", () => ({ sanitizeTelefoneCliente: vi.fn(), clienteIdDoTelefone: vi.fn() }));
vi.mock("./recompensaInteligente", () => ({ obterRecomendacaoPresente: vi.fn() }));
vi.mock("./temporadas", () => ({ obterTemporadaAtiva: vi.fn() }));
vi.mock("./rankingClientes", () => ({ calcularScoreDaTemporada: vi.fn() }));
vi.mock("./rankingScoreTemporada", () => ({ projetarScoreRankingComBonus: vi.fn() }));
vi.mock("./rankingGamificacaoLock", () => ({ comBloqueioGamificacao: vi.fn(), chaveLockScoreRanking: vi.fn() }));

import { consultarEstrelasCreditadasPorPedidos } from "./fidelidade";

beforeEach(() => store.clear());

describe("consultarEstrelasCreditadasPorPedidos", () => {
  it("conta somente créditos confirmados de Estrelas para os pedidos e período pedidos", async () => {
    const credito = {
      movimentoId: "m1", eventoId: "confirmado:p1", clienteId: "cli_1", pedidoId: "p1",
      tipo: "confirmado", pontos: 5, unidade: "estrelas", regraVersao: "estrelas-faixas-v1",
      motivo: "pedido entregue", createdAt: "2026-10-06T12:00:00.000Z",
    };
    const duplicado = { ...credito, movimentoId: "m1-legado" };
    const previsto = { ...credito, movimentoId: "m2", pedidoId: "p2", tipo: "previsto", pontos: 7 };
    const foraDaJanela = { ...credito, movimentoId: "m3", pedidoId: "p3", createdAt: "2026-09-01T12:00:00.000Z" };
    store.set("fidelidade:pontos:estado:cli_1", { extrato: [credito, previsto, foraDaJanela], recompensas: [], reservas: [] });
    store.set("fidelidade:pontos:extrato:cli_1", [duplicado]);

    const resultado = await consultarEstrelasCreditadasPorPedidos(
      [{ clienteId: "cli_1", pedidoId: "p1" }, { clienteId: "cli_1", pedidoId: "p2" }],
      Date.parse("2026-10-01T00:00:00.000Z"),
      Date.parse("2026-10-08T00:00:00.000Z"),
    );

    expect(resultado).toEqual({ estrelas: 5, pedidosComCredito: 1 });
  });
});
