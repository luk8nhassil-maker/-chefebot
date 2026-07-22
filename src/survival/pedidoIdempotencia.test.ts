import { describe, expect, it } from "vitest";
import {
  CLAIM_TTL_SEGUNDOS,
  chaveAttemptPedido,
  chaveClaimPedido,
  chaveResultadoPedido,
  chaveResultadoTokenPedido,
  ehAttemptValido,
  ehResultadoIdempotenciaValido,
  extrairFingerprintDoClaim,
  montarValorClaim,
} from "./pedidoIdempotencia";

describe("chaves isoladas por clientRequestId", () => {
  it("claim e result usam chaves distintas para o mesmo clientRequestId", () => {
    const id = "abc123";
    expect(chaveClaimPedido(id)).not.toBe(chaveResultadoPedido(id));
    expect(chaveClaimPedido(id)).toContain(id);
    expect(chaveResultadoPedido(id)).toContain(id);
  });

  it("CLAIM_TTL_SEGUNDOS é maior que o maxDuration=20s da rota (com margem)", () => {
    expect(CLAIM_TTL_SEGUNDOS).toBeGreaterThan(20);
  });
});

describe("montarValorClaim / extrairFingerprintDoClaim", () => {
  it("extrai de volta o fingerprint exatamente como foi montado", () => {
    const valor = montarValorClaim("owner-token-abc", "deadbeef".repeat(8));
    expect(extrairFingerprintDoClaim(valor)).toBe("deadbeef".repeat(8));
  });

  it("retorna null para valores sem o separador esperado (nunca lança)", () => {
    expect(extrairFingerprintDoClaim("valor-sem-separador")).toBeNull();
    expect(extrairFingerprintDoClaim(123)).toBeNull();
    expect(extrairFingerprintDoClaim(null)).toBeNull();
    expect(extrairFingerprintDoClaim(undefined)).toBeNull();
  });

  it("retorna null se o fingerprint depois do separador estiver vazio", () => {
    expect(extrairFingerprintDoClaim("owner-token::")).toBeNull();
  });
});

describe("ehResultadoIdempotenciaValido", () => {
  const registroValido = {
    state: "completed" as const,
    requestFingerprint: "a".repeat(64),
    pedidoId: "123",
    numero: 1,
    statusToken: "tok",
    createdAt: Date.now(),
    resultToken: "b".repeat(32),
  };

  it("aceita um registro bem formado", () => {
    expect(ehResultadoIdempotenciaValido(registroValido)).toBe(true);
  });

  it("rejeita valores nulos/indefinidos/não-objeto", () => {
    expect(ehResultadoIdempotenciaValido(null)).toBe(false);
    expect(ehResultadoIdempotenciaValido(undefined)).toBe(false);
    expect(ehResultadoIdempotenciaValido("string")).toBe(false);
    expect(ehResultadoIdempotenciaValido(42)).toBe(false);
  });

  it("rejeita registro com campo faltando ou tipo errado", () => {
    expect(ehResultadoIdempotenciaValido({ ...registroValido, numero: "1" })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, pedidoId: undefined })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, state: "processing" })).toBe(false);
  });

  // [4ª revisão — ponto 2] validação rigorosa: createdAt/numero finitos,
  // requestFingerprint em formato SHA-256 hex, pedidoId/statusToken/resultToken
  // não vazios — nenhum campo malformado passa despercebido.
  it("rejeita createdAt/numero não finitos (NaN, Infinity)", () => {
    expect(ehResultadoIdempotenciaValido({ ...registroValido, createdAt: NaN })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, createdAt: Infinity })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, numero: NaN })).toBe(false);
  });

  it("rejeita requestFingerprint fora do formato SHA-256 hex", () => {
    expect(ehResultadoIdempotenciaValido({ ...registroValido, requestFingerprint: "abc" })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, requestFingerprint: "A".repeat(64) })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, requestFingerprint: "g".repeat(64) })).toBe(false);
  });

  it("rejeita pedidoId/statusToken vazios", () => {
    expect(ehResultadoIdempotenciaValido({ ...registroValido, pedidoId: "" })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, statusToken: "" })).toBe(false);
  });

  it("rejeita resultToken ausente ou curto demais (< 32 chars)", () => {
    expect(ehResultadoIdempotenciaValido({ ...registroValido, resultToken: undefined })).toBe(false);
    expect(ehResultadoIdempotenciaValido({ ...registroValido, resultToken: "curto-demais" })).toBe(false);
  });
});

describe("chaveResultadoTokenPedido / chaveAttemptPedido", () => {
  it("chave-token e chave-attempt são distintas entre si e das demais para o mesmo clientRequestId", () => {
    const id = "abc123";
    const todas = [chaveClaimPedido(id), chaveResultadoPedido(id), chaveResultadoTokenPedido(id), chaveAttemptPedido(id)];
    expect(new Set(todas).size).toBe(todas.length);
    todas.forEach((chave) => expect(chave).toContain(id));
  });
});

describe("ehAttemptValido", () => {
  const attemptValido = {
    state: "in_progress" as const,
    requestFingerprint: "a".repeat(64),
    pedidoId: "123",
    txid: "chefebot_123",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("aceita um attempt bem formado nos dois estados válidos", () => {
    expect(ehAttemptValido(attemptValido)).toBe(true);
    expect(ehAttemptValido({ ...attemptValido, state: "completed" })).toBe(true);
  });

  it("rejeita valores nulos/indefinidos/não-objeto", () => {
    expect(ehAttemptValido(null)).toBe(false);
    expect(ehAttemptValido(undefined)).toBe(false);
    expect(ehAttemptValido("string")).toBe(false);
  });

  it("rejeita state fora do enum, ou pedidoId/txid/requestFingerprint vazios/ausentes", () => {
    expect(ehAttemptValido({ ...attemptValido, state: "completo" })).toBe(false);
    expect(ehAttemptValido({ ...attemptValido, pedidoId: "" })).toBe(false);
    expect(ehAttemptValido({ ...attemptValido, txid: undefined })).toBe(false);
    expect(ehAttemptValido({ ...attemptValido, requestFingerprint: "" })).toBe(false);
  });

  it("rejeita createdAt não finito", () => {
    expect(ehAttemptValido({ ...attemptValido, createdAt: NaN })).toBe(false);
  });
});
