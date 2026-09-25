import { beforeEach, describe, expect, test, vi } from "vitest";

const registrar = vi.fn();
const obterExtrato = vi.fn(async (_clienteId: string) => [] as Array<{ eventoId?: string; pontos: number }>);
vi.mock("./fidelidade", () => ({
  obterConfigFidelidadePontos: vi.fn(async () => ({ ativo: true, regraVersao: "estrelas-faixas-v1" })),
  estrelasV1Ativa: vi.fn((config: { ativo?: boolean; regraVersao?: string }) => config.ativo === true && config.regraVersao === "estrelas-faixas-v1"),
  registrarMovimentoPontosIdempotente: (clienteId: string, evento: unknown) => registrar(clienteId, evento),
  obterExtratoPontos: (clienteId: string) => obterExtrato(clienteId),
}));

import { creditarEstrelaApoioRecorrente, creditarEstrelasIndicacaoValida, estornarEstrelasIndicacaoValida } from "./estrelasIndicacao";

beforeEach(() => {
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
