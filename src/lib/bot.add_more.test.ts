import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, setEsgotados, type BotSession } from "./bot";

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

describe("add_more — upsell de bebidas (sem bebida no carrinho)", () => {
  it('1 → adiciona Refrigerante 1L', () => {
    const res = processMessage("1", makeSession());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart.some(i => i.name === "Refrigerante 1L")).toBe(true);
  });

  it('2 → adiciona Refrigerante 1,5L', () => {
    const res = processMessage("2", makeSession());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart.some(i => i.name === "Refrigerante 1,5L")).toBe(true);
  });

  it('3 → adiciona Refrigerante 2L', () => {
    const res = processMessage("3", makeSession());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart.some(i => i.name === "Refrigerante 2L")).toBe(true);
  });

  it('4 → abre lista completa de bebidas (bebida_escolha)', () => {
    const res = processMessage("4", makeSession());
    expect(res.session.step).toBe("bebida_escolha");
  });

  it('5 → segue para escolha de entrega (delivery_type)', () => {
    const res = processMessage("5", makeSession());
    expect(res.session.step).toBe("delivery_type");
  });
});

describe("add_more — texto livre de bebidas", () => {
  it('"ver mais bebidas" → abre lista completa de bebidas', () => {
    const res = processMessage("ver mais bebidas", makeSession());
    expect(res.session.step).toBe("bebida_escolha");
  });

  it('"refrigerante 2l" → adiciona Refrigerante 2L diretamente', () => {
    const res = processMessage("refrigerante 2l", makeSession());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart.some(i => i.name === "Refrigerante 2L")).toBe(true);
  });
});

describe("add_more — quando já há bebida no carrinho", () => {
  it('3 → vai para bebida (categoria), não adiciona Refrigerante 2L', () => {
    const sessionComBebida = makeSession({
      cart: [
        { category: "pizza", name: "Calabresa", price: 50 },
        { category: "bebida", name: "Refrigerante Lata", price: 6 },
      ],
    });
    const res = processMessage("3", sessionComBebida);
    expect(res.session.step).toBe("bebida_escolha");
    expect(res.session.cart.some(i => i.name === "Refrigerante 2L")).toBe(false);
  });
});
