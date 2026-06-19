import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));
import { processMessage, setEsgotados, detectaIntencaoSuco, type BotSession } from "./bot";

function makeSession(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "add_more",
    cart: [{ category: "pizza", name: "Calabresa", price: 50 }],
    deliveryFee: 0,
    ...overrides,
  };
}

beforeEach(() => {
  setEsgotados([]);
});

describe("detectaIntencaoSuco — função utilitária", () => {
  it('detecta "suco"', () => expect(detectaIntencaoSuco("suco")).toBe(true));
  it('detecta "sucos"', () => expect(detectaIntencaoSuco("sucos")).toBe(true));
  it('detecta "quero um suco"', () => expect(detectaIntencaoSuco("quero um suco")).toBe(true));
  it('detecta "manda um suco"', () => expect(detectaIntencaoSuco("manda um suco")).toBe(true));
  it('detecta "tem suco?"', () => expect(detectaIntencaoSuco("tem suco?")).toBe(true));
  it('detecta "quais sucos tem?"', () => expect(detectaIntencaoSuco("quais sucos tem?")).toBe(true));
  it('detecta "cardápio de sucos"', () => expect(detectaIntencaoSuco("cardápio de sucos")).toBe(true));
  it('detecta "ver sucos"', () => expect(detectaIntencaoSuco("ver sucos")).toBe(true));
  it('detecta "vitamina de banana"', () => expect(detectaIntencaoSuco("vitamina de banana")).toBe(true));
  it('NÃO detecta "refrigerante"', () => expect(detectaIntencaoSuco("refrigerante")).toBe(false));
  it('NÃO detecta "cerveja"', () => expect(detectaIntencaoSuco("cerveja")).toBe(false));
  it('NÃO detecta "guarana"', () => expect(detectaIntencaoSuco("guarana")).toBe(false));
  it('NÃO detecta "bebida"', () => expect(detectaIntencaoSuco("bebida")).toBe(false));
});

describe("add_more + intenção de suco → mostra somente sucos", () => {
  it('"quero um suco" → step vira suco_escolha', () => {
    const res = processMessage("quero um suco", makeSession());
    expect(res.session.step).toBe("suco_escolha");
  });

  it('"suco" → step vira suco_escolha', () => {
    const res = processMessage("suco", makeSession());
    expect(res.session.step).toBe("suco_escolha");
  });

  it('"tem suco?" → step vira suco_escolha', () => {
    const res = processMessage("tem suco?", makeSession());
    expect(res.session.step).toBe("suco_escolha");
  });

  it('"quero um suco" → resposta não contém "Refrigerante"', () => {
    const res = processMessage("quero um suco", makeSession());
    const texto = res.messages.join(" ");
    expect(texto).not.toMatch(/refrigerante/i);
  });

  it('"quero um suco" → resposta não contém "Cerveja"', () => {
    const res = processMessage("quero um suco", makeSession());
    const texto = res.messages.join(" ");
    expect(texto).not.toMatch(/cerveja/i);
  });

  it('"quero um suco" → resposta não contém "Guarana"', () => {
    const res = processMessage("quero um suco", makeSession());
    const texto = res.messages.join(" ");
    expect(texto).not.toMatch(/guarana/i);
  });
});

describe("category + intenção de suco → mostra somente sucos", () => {
  it('"quero um suco" em category → step vira suco_escolha', () => {
    const res = processMessage("quero um suco", makeSession({ step: "category" }));
    expect(res.session.step).toBe("suco_escolha");
  });
});

describe("bebida_escolha + intenção de suco → redireciona para sucos", () => {
  it('"quero um suco" em bebida_escolha → step vira suco_escolha', () => {
    const res = processMessage("quero um suco", makeSession({ step: "bebida_escolha", currentCategory: "bebida" }));
    expect(res.session.step).toBe("suco_escolha");
  });

  it('"quero um suco" em bebida_escolha → resposta não contém "Refrigerante"', () => {
    const res = processMessage("quero um suco", makeSession({ step: "bebida_escolha", currentCategory: "bebida" }));
    const texto = res.messages.join(" ");
    expect(texto).not.toMatch(/refrigerante/i);
  });
});

// ──────────────────────────────────────────────
// Adicional de leite: R$ 1,00 somado ao preço
// ──────────────────────────────────────────────
describe("suco_leite — adicional de R$ 1,00 com leite", () => {
  function sessionSucoLeite(suco: { name: string; price: number }): BotSession {
    return {
      step: "suco_leite",
      cart: [{ category: "pizza", name: "Calabresa", price: 50 }],
      deliveryFee: 0,
      pendingSucosLeite: [{ category: "suco", name: suco.name, price: suco.price }],
    };
  }

  it('Caja + "1" → "Caja com leite" e preço R$ 8,00', () => {
    const res = processMessage("1", sessionSucoLeite({ name: "Caja", price: 7 }));
    const item = res.session.cart.find(i => i.category === "suco");
    expect(item?.name).toBe("Caja com leite");
    expect(item?.price).toBe(8);
  });

  it('Caja + "com leite" → "Caja com leite" e preço R$ 8,00', () => {
    const res = processMessage("com leite", sessionSucoLeite({ name: "Caja", price: 7 }));
    const item = res.session.cart.find(i => i.category === "suco");
    expect(item?.name).toBe("Caja com leite");
    expect(item?.price).toBe(8);
  });

  it('Caja + "2" → "Caja sem leite" e preço R$ 7,00 (sem adicional)', () => {
    const res = processMessage("2", sessionSucoLeite({ name: "Caja", price: 7 }));
    const item = res.session.cart.find(i => i.category === "suco");
    expect(item?.name).toBe("Caja sem leite");
    expect(item?.price).toBe(7);
  });

  it('Caja + "sem leite" → preço original R$ 7,00', () => {
    const res = processMessage("sem leite", sessionSucoLeite({ name: "Caja", price: 7 }));
    const item = res.session.cart.find(i => i.category === "suco");
    expect(item?.price).toBe(7);
  });

  it('Bacuri + com leite → preço R$ 10,00 (base 9 + 1)', () => {
    const res = processMessage("1", sessionSucoLeite({ name: "Bacuri", price: 9 }));
    const item = res.session.cart.find(i => i.category === "suco");
    expect(item?.name).toBe("Bacuri com leite");
    expect(item?.price).toBe(10);
  });

  it('Cupuacu + com leite → preço R$ 9,00 (base 8 + 1)', () => {
    const res = processMessage("1", sessionSucoLeite({ name: "Cupuacu", price: 8 }));
    const item = res.session.cart.find(i => i.category === "suco");
    expect(item?.name).toBe("Cupuacu com leite");
    expect(item?.price).toBe(9);
  });

  it('subtotal soma o adicional de R$ 1,00', () => {
    const res = processMessage("1", sessionSucoLeite({ name: "Caja", price: 7 }));
    const total = res.session.cart.reduce((sum, i) => sum + i.price, 0);
    expect(total).toBe(58); // pizza R$ 50 + Caja com leite R$ 8
  });
});
