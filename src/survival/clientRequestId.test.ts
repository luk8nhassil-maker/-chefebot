import { describe, expect, it } from "vitest";
import { gerarClientRequestId, sanitizeClientRequestId } from "./clientRequestId";

describe("gerarClientRequestId", () => {
  it("gera valores diferentes a cada chamada", () => {
    const a = gerarClientRequestId();
    const b = gerarClientRequestId();
    expect(a).not.toBe(b);
  });

  it("o valor gerado sempre passa pelo próprio sanitizador", () => {
    const id = gerarClientRequestId();
    expect(sanitizeClientRequestId(id)).toBe(id);
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

  it("rejeita string vazia ou curta demais", () => {
    expect(sanitizeClientRequestId("")).toBeNull();
    expect(sanitizeClientRequestId("abc")).toBeNull();
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
    expect(sanitizeClientRequestId("  abcdef1234  ")).toBe("abcdef1234");
  });
});
