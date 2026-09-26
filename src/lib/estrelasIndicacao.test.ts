import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      store.delete(keys[0]);
      return 1;
    }),
  },
}));

const registrar = vi.fn();
const obterExtrato = vi.fn(async (_clienteId: string) => [] as Array<{ eventoId?: string; pontos: number }>);
vi.mock("./fidelidade", () => ({
  obterConfigFidelidadePontos: vi.fn(async () => ({ ativo: true, regraVersao: "estrelas-faixas-v1" })),
  estrelasV1Ativa: vi.fn((config: { ativo?: boolean; regraVersao?: string }) => config.ativo === true && config.regraVersao === "estrelas-faixas-v1"),
  registrarMovimentoPontosIdempotente: (clienteId: string, evento: unknown) => registrar(clienteId, evento),
  obterExtratoPontos: (clienteId: string) => obterExtrato(clienteId),
}));

import { creditarEstrelaApoioRecorrente, creditarEstrelasIndicacaoValida, estornarEstrelasIndicacaoValida, estornarEstrelaApoioRecorrente } from "./estrelasIndicacao";

beforeEach(() => {
  store.clear();
  registrar.mockReset().mockResolvedValue({ movimentoId: "mov_1" });
  obterExtrato.mockReset().mockResolvedValue([]);
});

describe("Estrelas V1 — indicação e apoio", () => {
  test("share, clique e cadastro não geram crédito; primeira compra válida gera +6", async () => {
    await expect(creditarEstrelasIndicacaoValida({ indicadorId: "a", indicadoId: "b", pedidoId: "p", primeiraCompraComercialValida: false })).resolves.toBe("nao_elegivel");
    expect(registrar).not.toHaveBeenCalled();
    await expect(creditarEstrelasIndicacaoValida({ indicadorId: "a", indicadoId: "b", pedidoId: "p", primeiraCompraComercialValida: true })).resolves.toBe("creditado");
    expect(registrar).toHaveBeenCalledWith("a", expect.objectContaining({ pontos: 6, regraVersao: "estrelas-faixas-v1" }));
  });

  test("self-referral é bloqueado e retry usa o mesmo evento idempotente", async () => {
    await expect(creditarEstrelasIndicacaoValida({ indicadorId: "a", indicadoId: "a", pedidoId: "p", primeiraCompraComercialValida: true })).resolves.toBe("nao_elegivel");
    registrar.mockResolvedValueOnce(null);
    await expect(creditarEstrelasIndicacaoValida({ indicadorId: "a", indicadoId: "b", pedidoId: "p", primeiraCompraComercialValida: true })).resolves.toBe("ja_creditado");
    expect(registrar).toHaveBeenCalledWith("a", expect.objectContaining({ eventoId: "indicacao:b:primeira-compra:p" }));
  });

  test("apoio é no máximo um por relação e expediente, e presente gratuito não conta", async () => {
    await expect(creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p1", expedienteId: "2026-09-18", pedidoComercialValido: true, pedidoTemPartePaga: true })).resolves.toBe("creditado");
    expect(registrar).toHaveBeenCalledWith("a", expect.objectContaining({ pontos: 1, eventoId: "apoio:b:expediente:2026-09-18" }));
    await expect(creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p2", expedienteId: "2026-09-18", pedidoComercialValido: true, pedidoTemPartePaga: false })).resolves.toBe("nao_elegivel");
  });
});

describe("estornarEstrelaApoioRecorrente (cancelamento tardio, blocker 5)", () => {
  test("único pedido qualificado do expediente cancelado: estorna a Estrela", async () => {
    await creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p1", expedienteId: "exp-1", pedidoComercialValido: true, pedidoTemPartePaga: true });
    obterExtrato.mockResolvedValue([{ eventoId: "apoio:b:expediente:exp-1", pontos: 1 }]);

    const resultado = await estornarEstrelaApoioRecorrente({ pedidoId: "p1", motivo: "pedido cancelado" });
    expect(resultado).toBe("estornado");
    expect(registrar).toHaveBeenCalledWith("a", expect.objectContaining({
      eventoId: "estorno:apoio:b:expediente:exp-1", tipo: "estornado", pontos: 1,
    }));
  });

  test("dois pedidos válidos no mesmo expediente, só um cancelado: NUNCA remove a Estrela (o outro ainda sustenta)", async () => {
    await creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p1", expedienteId: "exp-1", pedidoComercialValido: true, pedidoTemPartePaga: true });
    // p2 é "ja_creditado" no ledger (mesmo expediente), mas ainda assim
    // qualifica e passa a sustentar o crédito.
    registrar.mockResolvedValueOnce(null);
    await creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p2", expedienteId: "exp-1", pedidoComercialValido: true, pedidoTemPartePaga: true });

    const resultado = await estornarEstrelaApoioRecorrente({ pedidoId: "p1", motivo: "p1 cancelado" });
    expect(resultado).toBe("mantido_outro_pedido_sustenta");
    expect(registrar).not.toHaveBeenCalledWith("a", expect.objectContaining({ tipo: "estornado" }));
  });

  test("todos os pedidos qualificadores do expediente cancelados: estorna", async () => {
    await creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p1", expedienteId: "exp-1", pedidoComercialValido: true, pedidoTemPartePaga: true });
    registrar.mockResolvedValueOnce(null);
    await creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p2", expedienteId: "exp-1", pedidoComercialValido: true, pedidoTemPartePaga: true });

    const primeiro = await estornarEstrelaApoioRecorrente({ pedidoId: "p1", motivo: "p1 cancelado" });
    expect(primeiro).toBe("mantido_outro_pedido_sustenta");

    obterExtrato.mockResolvedValue([{ eventoId: "apoio:b:expediente:exp-1", pontos: 1 }]);
    const segundo = await estornarEstrelaApoioRecorrente({ pedidoId: "p2", motivo: "p2 também cancelado" });
    expect(segundo).toBe("estornado");
  });

  test("retry do mesmo cancelamento é idempotente (nunca reavalia nem estorna duas vezes)", async () => {
    await creditarEstrelaApoioRecorrente({ indicadorId: "a", indicadoId: "b", pedidoId: "p1", expedienteId: "exp-1", pedidoComercialValido: true, pedidoTemPartePaga: true });
    obterExtrato.mockResolvedValue([{ eventoId: "apoio:b:expediente:exp-1", pontos: 1 }]);

    const primeiro = await estornarEstrelaApoioRecorrente({ pedidoId: "p1", motivo: "cancelado" });
    expect(primeiro).toBe("estornado");
    registrar.mockClear();

    const retry = await estornarEstrelaApoioRecorrente({ pedidoId: "p1", motivo: "retry do cancelamento" });
    expect(retry).toBe("ja_estornado");
    expect(registrar).not.toHaveBeenCalled();
  });

  test("pedido que nunca qualificou para apoio nenhum: no-op (nunca estorna à toa)", async () => {
    const resultado = await estornarEstrelaApoioRecorrente({ pedidoId: "pedido-nunca-teve-apoio", motivo: "x" });
    expect(resultado).toBe("nao_encontrado");
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe("estornarEstrelasIndicacaoValida (cancelamento tardio)", () => {
  test("estorna um crédito real existente", async () => {
    obterExtrato.mockResolvedValue([{ eventoId: "indicacao:b:primeira-compra:p", pontos: 6 }]);
    const resultado = await estornarEstrelasIndicacaoValida({ indicadorId: "a", indicadoId: "b", pedidoId: "p", motivo: "cancelado" });
    expect(resultado).toBe("estornado");
    expect(registrar).toHaveBeenCalledWith("a", expect.objectContaining({
      eventoId: "estorno:indicacao:b:primeira-compra:p",
      tipo: "estornado",
      pontos: 6,
    }));
  });

  test("nunca estorna um crédito que não existe (protege contra estorno fantasma)", async () => {
    obterExtrato.mockResolvedValue([]);
    const resultado = await estornarEstrelasIndicacaoValida({ indicadorId: "a", indicadoId: "b", pedidoId: "p", motivo: "cancelado" });
    expect(resultado).toBe("credito_nao_encontrado");
    expect(registrar).not.toHaveBeenCalled();
  });

  test("idempotente: já estornado não estorna de novo", async () => {
    obterExtrato.mockResolvedValue([
      { eventoId: "indicacao:b:primeira-compra:p", pontos: 6 },
      { eventoId: "estorno:indicacao:b:primeira-compra:p", pontos: 6 },
    ]);
    const resultado = await estornarEstrelasIndicacaoValida({ indicadorId: "a", indicadoId: "b", pedidoId: "p", motivo: "cancelado" });
    expect(resultado).toBe("ja_estornado");
    expect(registrar).not.toHaveBeenCalled();
  });
});
