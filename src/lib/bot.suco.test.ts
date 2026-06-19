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
