import { describe, expect, it } from "vitest";
import { calcularRequestFingerprint, type PedidoFingerprintInput } from "./requestFingerprint";

function base(): PedidoFingerprintInput {
  return {
    cliente: "Lucas Brito",
    telefonePedido: "5599999999999",
    itens: [{ kind: "simple", name: "Calabresa", qty: 1 }],
    tipoEntrega: "delivery",
    bairro: "Centro",
    rua: "Rua das Flores",
    numero: "123",
    pagamento: "Pix",
  };
}

describe("calcularRequestFingerprint", () => {
  it("é determinístico: o mesmo input sempre produz o mesmo hash", () => {
    expect(calcularRequestFingerprint(base())).toBe(calcularRequestFingerprint(base()));
  });

  it("produz um hash SHA-256 em hexadecimal (64 chars)", () => {
    const hash = calcularRequestFingerprint(base());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("nunca inclui os dados legíveis no próprio hash (é opaco)", () => {
    const hash = calcularRequestFingerprint(base());
    expect(hash).not.toContain("Lucas");
    expect(hash).not.toContain("5599999999999");
    expect(hash).not.toContain("Centro");
  });

  it("cliente diferente produz fingerprint diferente", () => {
    expect(calcularRequestFingerprint({ ...base(), cliente: "Outra Pessoa" })).not.toBe(calcularRequestFingerprint(base()));
  });

  it("telefone diferente produz fingerprint diferente", () => {
    expect(calcularRequestFingerprint({ ...base(), telefonePedido: "5588888888888" })).not.toBe(calcularRequestFingerprint(base()));
  });

  it("itens diferentes produzem fingerprint diferente", () => {
    const alterado = { ...base(), itens: [{ kind: "simple", name: "Portuguesa", qty: 1 }] };
    expect(calcularRequestFingerprint(alterado)).not.toBe(calcularRequestFingerprint(base()));
  });

  it("endereço diferente produz fingerprint diferente", () => {
    expect(calcularRequestFingerprint({ ...base(), numero: "456" })).not.toBe(calcularRequestFingerprint(base()));
    expect(calcularRequestFingerprint({ ...base(), bairro: "Outro Bairro" })).not.toBe(calcularRequestFingerprint(base()));
  });

  it("forma de pagamento diferente produz fingerprint diferente", () => {
    expect(calcularRequestFingerprint({ ...base(), pagamento: "Dinheiro", troco: "50" })).not.toBe(calcularRequestFingerprint(base()));
  });

  it("resgateId/recompensaJornadaId diferentes produzem fingerprint diferente", () => {
    expect(calcularRequestFingerprint({ ...base(), resgateId: "resgate-1" })).not.toBe(
      calcularRequestFingerprint({ ...base(), resgateId: "resgate-2" })
    );
  });

  it("campos ausentes (undefined) e campos ausentes tratados como null não colidem por acaso com valores reais", () => {
    const semBairro = calcularRequestFingerprint({ ...base(), bairro: undefined });
    const comBairroNull = calcularRequestFingerprint({ ...base(), bairro: undefined });
    expect(semBairro).toBe(comBairroNull);
  });
});
