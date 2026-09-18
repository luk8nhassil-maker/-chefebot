import { beforeEach, describe, expect, test, vi } from "vitest";

const registrar = vi.fn();
vi.mock("./fidelidade", () => ({
  obterConfigFidelidadePontos: vi.fn(async () => ({ ativo: true, regraVersao: "estrelas-faixas-v1" })),
  estrelasV1Ativa: vi.fn((config: { ativo?: boolean; regraVersao?: string }) => config.ativo === true && config.regraVersao === "estrelas-faixas-v1"),
  registrarMovimentoPontosIdempotente: (...args: unknown[]) => registrar(...args),
}));

import { creditarEstrelaApoioRecorrente, creditarEstrelasIndicacaoValida } from "./estrelasIndicacao";

beforeEach(() => registrar.mockReset().mockResolvedValue({ movimentoId: "mov_1" }));

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
