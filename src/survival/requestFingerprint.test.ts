import { describe, expect, it } from "vitest";
import { calcularRequestFingerprint, normalizarEmailParaFingerprint, type PedidoFingerprintInput } from "./requestFingerprint";

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

  it("observação diferente produz fingerprint diferente", () => {
    expect(calcularRequestFingerprint({ ...base(), observacao: "Sem cebola" })).not.toBe(
      calcularRequestFingerprint({ ...base(), observacao: "Capricha no queijo" })
    );
  });

  it("e-mail diferente produz fingerprint diferente", () => {
    expect(calcularRequestFingerprint({ ...base(), email: "a@teste.com" })).not.toBe(
      calcularRequestFingerprint({ ...base(), email: "b@teste.com" })
    );
  });

  it("sabor/escolha da recompensa da Jornada do Chef diferente produz fingerprint diferente", () => {
    expect(
      calcularRequestFingerprint({ ...base(), recompensaJornadaId: "rcp_1", recompensaEscolhaSabor: "Calabresa" })
    ).not.toBe(calcularRequestFingerprint({ ...base(), recompensaJornadaId: "rcp_1", recompensaEscolhaSabor: "Portuguesa" }));
  });

  it("campos ausentes (undefined) são tratados de forma consistente (nunca colidem por acaso)", () => {
    const semBairro = calcularRequestFingerprint({ ...base(), bairro: undefined });
    const comBairroNull = calcularRequestFingerprint({ ...base(), bairro: undefined });
    expect(semBairro).toBe(comBairroNull);
  });

  it("[canônico] ordem das CHAVES de um item do carrinho não muda o fingerprint (mesmo conteúdo lógico)", () => {
    const itemOrdemA = { kind: "simple", name: "Calabresa", qty: 1, price: 10 };
    const itemOrdemB = { price: 10, qty: 1, name: "Calabresa", kind: "simple" };
    expect(calcularRequestFingerprint({ ...base(), itens: [itemOrdemA] })).toBe(
      calcularRequestFingerprint({ ...base(), itens: [itemOrdemB] })
    );
  });

  it("[canônico] ordem dos ITENS no carrinho é preservada — trocar a ordem produz fingerprint diferente", () => {
    const pizza = { kind: "simple", name: "Calabresa", qty: 1 };
    const bebida = { kind: "simple", name: "Refrigerante", qty: 1 };
    expect(calcularRequestFingerprint({ ...base(), itens: [pizza, bebida] })).not.toBe(
      calcularRequestFingerprint({ ...base(), itens: [bebida, pizza] })
    );
  });

  it("[canônico] espaços nas bordas de strings não mudam o fingerprint (trim)", () => {
    expect(calcularRequestFingerprint({ ...base(), observacao: "  sem cebola  " })).toBe(
      calcularRequestFingerprint({ ...base(), observacao: "sem cebola" })
    );
  });

  it("[canônico] e-mail com caixa diferente (maiúsculas/minúsculas) não muda o fingerprint", () => {
    expect(calcularRequestFingerprint({ ...base(), email: "Cliente@Teste.COM" })).toBe(
      calcularRequestFingerprint({ ...base(), email: "cliente@teste.com" })
    );
  });

  it("mesmos dados normalizados (mesmo conteúdo lógico, formatação diferente) continuam sendo retry legítimo", () => {
    const tentativaA: PedidoFingerprintInput = { ...base(), observacao: "Capricha!  ", email: "Fulano@Teste.com" };
    const tentativaB: PedidoFingerprintInput = { ...base(), observacao: "Capricha!", email: "fulano@teste.com" };
    expect(calcularRequestFingerprint(tentativaA)).toBe(calcularRequestFingerprint(tentativaB));
  });
});

describe("normalizarEmailParaFingerprint", () => {
  it("normaliza trim + lowercase", () => {
    expect(normalizarEmailParaFingerprint("  Fulano@Teste.COM  ")).toBe("fulano@teste.com");
  });

  it("string vazia/ausente vira undefined (nunca string vazia)", () => {
    expect(normalizarEmailParaFingerprint("")).toBeUndefined();
    expect(normalizarEmailParaFingerprint("   ")).toBeUndefined();
    expect(normalizarEmailParaFingerprint(undefined)).toBeUndefined();
  });
});
