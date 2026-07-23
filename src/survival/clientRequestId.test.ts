import { afterEach, describe, expect, it, vi } from "vitest";
import { gerarClientRequestId, hashClientRequestId, sanitizeClientRequestId } from "./clientRequestId";

describe("gerarClientRequestId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gera valores diferentes a cada chamada", () => {
    const a = gerarClientRequestId();
    const b = gerarClientRequestId();
    expect(a).not.toBe(b);
  });

  it("o valor gerado sempre passa pelo próprio sanitizador", () => {
    const id = gerarClientRequestId();
    expect(sanitizeClientRequestId(id)).toBe(id);
  });

  it("usa crypto.getRandomValues quando randomUUID não está disponível", () => {
    vi.stubGlobal("crypto", { getRandomValues: (arr: Uint8Array) => { arr.fill(7); return arr; } });
    const id = gerarClientRequestId();
    expect(sanitizeClientRequestId(id)).toBe(id);
    expect(id).toBe("07".repeat(16));
  });

  it("nunca usa Date.now()/Math.random() como fallback — falha de forma controlada sem nenhuma fonte de aleatoriedade criptográfica", () => {
    vi.stubGlobal("crypto", {});
    expect(() => gerarClientRequestId()).toThrow(/aleatoriedade criptográfica/);
  });
});

describe("sanitizeClientRequestId", () => {
  it("aceita um UUID v4 típico", () => {
    const uuid = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    expect(sanitizeClientRequestId(uuid)).toBe(uuid);
  });

  it("rejeita valores não-string", () => {
    expect(sanitizeClientRequestId(123)).toBeNull();
    expect(sanitizeClientRequestId(null)).toBeNull();
    expect(sanitizeClientRequestId(undefined)).toBeNull();
    expect(sanitizeClientRequestId({})).toBeNull();
  });

  it("rejeita string vazia ou curta demais (< 16 chars — proteção contra força bruta)", () => {
    expect(sanitizeClientRequestId("")).toBeNull();
    expect(sanitizeClientRequestId("abc")).toBeNull();
    expect(sanitizeClientRequestId("a".repeat(15))).toBeNull();
  });

  it("aceita a partir de 16 caracteres", () => {
    expect(sanitizeClientRequestId("a".repeat(16))).toBe("a".repeat(16));
  });

  it("rejeita string longa demais (proteção contra abuso)", () => {
    expect(sanitizeClientRequestId("a".repeat(101))).toBeNull();
  });

  it("rejeita caracteres fora de [a-zA-Z0-9_-] (nunca aceita telefone/PII com símbolos)", () => {
    expect(sanitizeClientRequestId("(99) 99999-9999")).toBeNull();
    expect(sanitizeClientRequestId("id com espaço")).toBeNull();
    expect(sanitizeClientRequestId("<script>alert(1)</script>")).toBeNull();
  });

  it("aceita e mantém espaços nas bordas removidos (trim)", () => {
    expect(sanitizeClientRequestId("  abcdef0123456789  ")).toBe("abcdef0123456789");
  });
});

describe("hashClientRequestId", () => {
  it("é determinístico e produz um SHA-256 em hex (64 chars)", () => {
    const hash = hashClientRequestId("abcdef0123456789");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashClientRequestId("abcdef0123456789")).toBe(hash);
  });

  it("nunca contém o clientRequestId original (é opaco)", () => {
    const id = "abcdef0123456789";
    expect(hashClientRequestId(id)).not.toContain(id);
  });

  it("IDs diferentes produzem hashes diferentes", () => {
    expect(hashClientRequestId("abcdef0123456789")).not.toBe(hashClientRequestId("0123456789abcdef"));
  });
});
