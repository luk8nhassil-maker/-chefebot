import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, setEsgotados, type BotSession } from "./bot";

function sessaoAddMore(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "add_more",
    cart: [{ category: "pizza", name: "Calabresa", size: "G", price: 50 }],
    deliveryFee: 0,
    customerName: "Teste",
    ...overrides,
  };
}

beforeEach(() => {
  setEsgotados([]);
});

// ──────────────────────────────────────────────────────────────────────────────
// Regressão: "refrigerante de 2l tambem" não pode ativar faixa de preço
// ──────────────────────────────────────────────────────────────────────────────
describe("regressão: refrigerante de 2l com vitamina de banana no carrinho", () => {
  it('NÃO responde "Tenho esses nessa faixa de preço"', () => {
    const sessComVitamina = sessaoAddMore({
      cart: [
        { category: "suco", name: "Vitamina de Banana com leite", price: 9 },
      ],
    });
    const res = processMessage("quero um refrigerante de 2l tambem", sessComVitamina);
    const faixaDePreco = res.messages.some(m => m.includes("nessa faixa de preço"));
    expect(faixaDePreco).toBe(false);
  });

  it('adiciona Refrigerante 2L ao carrinho (match claro)', () => {
    const sessComVitamina = sessaoAddMore({
      cart: [
        { category: "suco", name: "Vitamina de Banana com leite", price: 9 },
      ],
    });
    const res = processMessage("quero um refrigerante de 2l tambem", sessComVitamina);
    const adicionou = res.session.cart.some(i => i.name === "Refrigerante 2L");
    expect(adicionou).toBe(true);
  });
});

describe("regressão: refrigerante de 2l com pizza no carrinho", () => {
  it("adiciona Refrigerante 2L diretamente", () => {
    const res = processMessage("refrigerante de 2l", sessaoAddMore());
    expect(res.session.cart.some(i => i.name === "Refrigerante 2L")).toBe(true);
  });

  it("NÃO responde faixa de preço", () => {
    const res = processMessage("refrigerante de 2l", sessaoAddMore());
    expect(res.messages.some(m => m.includes("nessa faixa de preço"))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Faixa de preço só dispara com intenção clara de preço + categoria explícita
// ──────────────────────────────────────────────────────────────────────────────
describe("faixa de preço: só dispara com intenção clara de categoria + valor", () => {
  it('"tem bebida de 5 reais?" → pode mostrar lista por faixa (não deve adicionar produto aleatório)', () => {
    const res = processMessage("tem bebida de 5 reais?", sessaoAddMore());
    // Não deve adicionar produto ao carrinho sem confirmação
    expect(res.session.cart.length).toBe(1); // só a pizza original
    // Pode mostrar faixa de preço ou perguntar qual prefere — o que não pode é adicionar silenciosamente
  });

  it('"o que tem ate 5 reais?" (sem categoria) → chama Guardião, não responde com produto', () => {
    const res = processMessage("o que tem ate 5 reais?", sessaoAddMore());
    // Sem categoria explícita, não pode responder com produto específico
    expect(res.session.cart.length).toBe(1); // carrinho inalterado
    expect(res.messages.some(m => m.includes("nessa faixa de preço"))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Mensagem ambígua no add_more → não chuta produto aleatório
// ──────────────────────────────────────────────────────────────────────────────
describe("regressão: mensagem ambígua não adiciona produto aleatório", () => {
  it('"algo diferente" → não adiciona produto ao carrinho', () => {
    const res = processMessage("algo diferente", sessaoAddMore());
    expect(res.session.cart.length).toBe(1); // carrinho inalterado
  });

  it('"quero alguma coisa" → não adiciona produto ao carrinho', () => {
    const res = processMessage("quero alguma coisa", sessaoAddMore());
    expect(res.session.cart.length).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Regressão: comportamentos que DEVEM continuar funcionando
// ──────────────────────────────────────────────────────────────────────────────
describe("regressão: vitamina de banana continua funcionando", () => {
  it('"quero uma vitamina de banana" → adiciona Vitamina de Banana ou vai para suco_leite', () => {
    const res = processMessage("quero uma vitamina de banana", sessaoAddMore());
    const ok = res.session.cart.some(i => i.name.toLowerCase().includes("banana"))
      || res.session.step === "suco_leite";
    expect(ok).toBe(true);
  });
});

describe("regressão: pizza família sabor calabresa e baiana continua funcionando", () => {
  it('"quero uma pizza família sabor calabresa e baiana" → nunca Vitamina de Banana', () => {
    const res = processMessage("quero uma pizza família sabor calabresa e baiana", sessaoAddMore());
    expect(res.session.cart.some(i => i.name.toLowerCase().includes("banana"))).toBe(false);
    expect(res.messages.some(m => m.toLowerCase().includes("vitamina de banana"))).toBe(false);
  });

  it('"quero uma pizza família sabor calabresa e baiana" → vai para border_escolha', () => {
    const res = processMessage("quero uma pizza família sabor calabresa e baiana", sessaoAddMore());
    expect(res.session.step).toBe("border_escolha");
  });
});

describe("regressão: upsell numerado de bebidas continua funcionando", () => {
  it('opção 1 → adiciona Refrigerante 1L', () => {
    const res = processMessage("1", sessaoAddMore());
    expect(res.session.cart.some(i => i.name === "Refrigerante 1L")).toBe(true);
  });

  it('opção 2 → adiciona Refrigerante 1,5L', () => {
    const res = processMessage("2", sessaoAddMore());
    expect(res.session.cart.some(i => i.name === "Refrigerante 1,5L")).toBe(true);
  });

  it('opção 3 → adiciona Refrigerante 2L', () => {
    const res = processMessage("3", sessaoAddMore());
    expect(res.session.cart.some(i => i.name === "Refrigerante 2L")).toBe(true);
  });
});
