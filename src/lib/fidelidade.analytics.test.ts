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
import { redis } from "./redis";

beforeEach(() => {
  store.clear();
  vi.mocked(redis.mget).mockClear();
});

describe("consultarEstrelasCreditadasPorPedidos", () => {
  it("conta créditos confirmados dos pedidos selecionados mesmo quando o lançamento atrasa", async () => {
    const credito = {
      movimentoId: "m1", eventoId: "confirmado:p1", clienteId: "cli_1", pedidoId: "p1",
      tipo: "confirmado", pontos: 5, unidade: "estrelas", regraVersao: "estrelas-faixas-v1",
      motivo: "pedido entregue", createdAt: "2026-10-06T12:00:00.000Z",
    };
    const duplicado = { ...credito, movimentoId: "m1-legado" };
    const previsto = { ...credito, movimentoId: "m2", pedidoId: "p2", tipo: "previsto", pontos: 7 };
    const creditoAtrasado = { ...credito, movimentoId: "m3", eventoId: "confirmado:p2", pedidoId: "p2", createdAt: "2026-10-09T12:00:00.000Z", pontos: 7 };
    const outroPedido = { ...credito, movimentoId: "m4", eventoId: "confirmado:p3", pedidoId: "p3", createdAt: "2026-09-01T12:00:00.000Z" };
    store.set("fidelidade:pontos:estado:cli_1", { extrato: [credito, previsto, creditoAtrasado, outroPedido], recompensas: [], reservas: [] });
    store.set("fidelidade:pontos:extrato:cli_1", [duplicado]);

    const resultado = await consultarEstrelasCreditadasPorPedidos(
      [{ clienteId: "cli_1", pedidoId: "p1" }, { clienteId: "cli_1", pedidoId: "p2" }],
    );

    expect(resultado).toEqual({ estrelas: 12, pedidosComCredito: 2 });
    expect(redis.mget).toHaveBeenCalledExactlyOnceWith(
      "fidelidade:pontos:estado:cli_1",
      "fidelidade:pontos:extrato:cli_1",
    );
  });
});
