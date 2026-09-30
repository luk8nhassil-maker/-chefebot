import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, setEsgotados, type BotSession } from "./bot";

function sessaoCategory(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "category",
    cart: [],
    deliveryFee: 0,
    customerName: "Teste",
    ...overrides,
  };
}

function sessaoAddMore(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "add_more",
    cart: [{ category: "pizza", name: "Portuguesa", size: "G", price: 50 }],
    deliveryFee: 0,
    customerName: "Teste",
    ...overrides,
  };
}

beforeEach(() => {
  setEsgotados([]);
});

describe("regressão: baiana nunca vira banana", () => {
  it('category: "quero uma pizza tamanho familia de calabresa e baiana" → NÃO adiciona Vitamina de Banana', () => {
    const res = processMessage("quero uma pizza tamanho familia de calabresa e baiana", sessaoCategory());
    const vitaminaNoCarrinho = res.session.cart.some(i => i.name.toLowerCase().includes("banana"));
    expect(vitaminaNoCarrinho).toBe(false);
    const textoVitamina = res.messages.some(m => m.toLowerCase().includes("vitamina de banana"));
    expect(textoVitamina).toBe(false);
  });

  it('category: "quero uma pizza familia de calabresa e baiana" → avança fluxo de pizza (não suco)', () => {
    const res = processMessage("quero uma pizza familia de calabresa e baiana", sessaoCategory());
    // Deve ir para border_escolha (tamanho F + dois sabores detectados) ou perguntar borda
    const stepsPizza = ["border_escolha", "size", "flavor"];
    expect(stepsPizza).toContain(res.session.step);
  });

  it('add_more: "quero uma pizza tamanho familia de calabresa e baiana" → NÃO adiciona Vitamina de Banana', () => {
    const res = processMessage("quero uma pizza tamanho familia de calabresa e baiana", sessaoAddMore());
    const vitaminaNoCarrinho = res.session.cart.some(i => i.name.toLowerCase().includes("banana"));
    expect(vitaminaNoCarrinho).toBe(false);
    const textoVitamina = res.messages.some(m => m.toLowerCase().includes("vitamina de banana"));
    expect(textoVitamina).toBe(false);
  });

  it('category: "quero uma pizza familia sabor portuguesa e calabresa" → NÃO adiciona Vitamina de Banana', () => {
    const res = processMessage("quero uma pizza familia sabor portuguesa e calabresa", sessaoCategory());
    const vitaminaNoCarrinho = res.session.cart.some(i => i.name.toLowerCase().includes("banana"));
    expect(vitaminaNoCarrinho).toBe(false);
  });

  it('category: "quero uma pizza familia sabor portuguesa e calabresa" → avança fluxo de pizza', () => {
    const res = processMessage("quero uma pizza familia sabor portuguesa e calabresa", sessaoCategory());
    const stepsPizza = ["border_escolha", "size", "flavor"];
    expect(stepsPizza).toContain(res.session.step);
  });
});

// Redação EXATA reportada em produção (com acento em "família" e a palavra "sabor"),
// cobrindo o caminho real em cada step de entrada possível do simulador/WhatsApp.
describe("regressão: redação exata de produção (pizza família sabor calabresa e baiana)", () => {
  const MSG = "quero uma pizza família sabor calabresa e baiana";

  function semBanana(messages: string[], cart: { name: string }[]) {
    const noCart = cart.some(i => i.name.toLowerCase().includes("banana"));
    const noTexto = messages.some(m => m.toLowerCase().includes("vitamina de banana"));
    return !noCart && !noTexto;
  }

  it('category → monta Pizza F Calabresa/Baiana, nunca Vitamina de Banana', () => {
    const res = processMessage(MSG, sessaoCategory());
    expect(semBanana(res.messages, res.session.cart)).toBe(true);
    expect(res.messages[0]).toContain("Calabresa/Baiana");
    expect(res.session.step).toBe("border_escolha");
  });

  it('add_more → monta Pizza F Calabresa/Baiana, nunca Vitamina de Banana', () => {
    const res = processMessage(MSG, sessaoAddMore());
    expect(semBanana(res.messages, res.session.cart)).toBe(true);
    expect(res.messages[0]).toContain("Calabresa/Baiana");
    expect(res.session.step).toBe("border_escolha");
  });

  it('name → monta Pizza F Calabresa/Baiana, nunca Vitamina de Banana', () => {
    const sess: BotSession = { step: "name", cart: [], deliveryFee: 0 };
    const res = processMessage(MSG, sess);
    expect(semBanana(res.messages, res.session.cart)).toBe(true);
    expect(res.session.step).toBe("border_escolha");
  });

  it('returning → monta Pizza F Calabresa/Baiana, nunca Vitamina de Banana', () => {
    const sess = { step: "returning", cart: [], deliveryFee: 0, historico: { nome: "Joao", totalPedidos: 3, ultimoCart: [] } } as unknown as BotSession;
    const res = processMessage(MSG, sess);
    expect(semBanana(res.messages, res.session.cart)).toBe(true);
    expect(res.session.step).toBe("border_escolha");
  });
});

describe("regressão: vitamina de banana continua funcionando", () => {
  it('category: "quero uma vitamina de banana" → adiciona Vitamina de Banana', () => {
    const res = processMessage("quero uma vitamina de banana", sessaoCategory());
    // Deve ir para suco_leite (pergunta com leite ou sem) ou adicionar diretamente
    const adicionouVitamina = res.session.cart.some(i => i.name.toLowerCase().includes("banana"))
      || res.session.step === "suco_leite";
    expect(adicionouVitamina).toBe(true);
  });

  it('add_more: "quero uma vitamina de banana" → NÃO confunde com pizza', () => {
    const res = processMessage("quero uma vitamina de banana", sessaoAddMore());
    const stepsPizza = ["size", "flavor", "border_escolha"];
    expect(stepsPizza).not.toContain(res.session.step);
  });
});
