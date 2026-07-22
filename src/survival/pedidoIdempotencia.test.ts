import { describe, expect, it } from "vitest";
import {
  CLAIM_TTL_SEGUNDOS,
  chaveClaimPedido,
  chaveResultadoPedido,
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
});
