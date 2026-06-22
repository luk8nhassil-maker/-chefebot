import { vi, describe, it, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, createInitialSession, type BotSession } from "./bot";

function sessaoCategory(tentativas = 0): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Ana", cart: [], deliveryFee: 0, tentativasInvalidas: tentativas };
}
function sessaoAddMore(tentativas = 0): BotSession {
  return {
    ...createInitialSession(), step: "add_more", customerName: "Ana",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryFee: 0, tentativasInvalidas: tentativas,
  };
}
function sessaoName(tentativas = 0): BotSession {
  return { ...createInitialSession(), step: "name", customerName: "", cart: [], deliveryFee: 0, tentativasInvalidas: tentativas };
}

// ─── category: saudação com tentativas acumuladas não escalona ────────────────

describe("category: saudação não escalona nem acumula tentativas", () => {
  it.each(["boa noite", "boa tarde", "bom dia", "oi", "ola", "hey"])(
    '"%s" com tentativasInvalidas:2 → não escalar', (msg) => {
      const r = processMessage(msg, sessaoCategory(2));
      expect(r.escalar).toBeFalsy();
    },
  );

  it("boa noite com tentativas:2 → zera o contador (tentativasInvalidas = 0)", () => {
    const r = processMessage("boa noite", sessaoCategory(2));
    expect(r.session.tentativasInvalidas).toBe(0);
  });

  it("boa noite mantém step category", () => {
    const r = processMessage("boa noite", sessaoCategory(2));
    expect(r.session.step).toBe("category");
  });

  it("boa noite não altera carrinho", () => {
    const session = sessaoCategory(2);
    const r = processMessage("boa noite", session);
    expect(r.session.cart).toEqual([]);
  });

  it("mensagem inválida real ainda escalona ao atingir limite", () => {
    const r = processMessage("xyzabc123", sessaoCategory(2));
    expect(r.escalar).toBe(true);
  });

  it("pedido válido (pizza) na category ainda funciona normalmente", () => {
    const r = processMessage("pizza", sessaoCategory(0));
    expect(r.escalar).toBeFalsy();
    expect(r.session.step).not.toBe("category");
  });
});

// ─── add_more: saudação com tentativas acumuladas não escalona ────────────────

describe("add_more: saudação não escalona nem acumula tentativas", () => {
  it('boa noite com tentativasInvalidas:2 → não escalar', () => {
    const r = processMessage("boa noite", sessaoAddMore(2));
    expect(r.escalar).toBeFalsy();
  });

  it("boa noite no add_more → zera o contador", () => {
    const r = processMessage("boa noite", sessaoAddMore(2));
    expect(r.session.tentativasInvalidas).toBe(0);
  });

  it("boa noite no add_more mantém step add_more e carrinho intacto", () => {
    const session = sessaoAddMore(2);
    const r = processMessage("boa noite", session);
    expect(r.session.step).toBe("add_more");
    expect(r.session.cart).toEqual(session.cart);
  });

  it("mensagem inválida real ainda escalona no add_more ao atingir limite", () => {
    const r = processMessage("xyzabc123", sessaoAddMore(2));
    expect(r.escalar).toBe(true);
  });
});

// ─── name: saudação com tentativas acumuladas não escalona ───────────────────

describe("name: saudação não escalona nem acumula tentativas", () => {
  it('boa noite com tentativasInvalidas:2 → não escalar', () => {
    const r = processMessage("boa noite", sessaoName(2));
    expect(r.escalar).toBeFalsy();
  });

  it("boa noite no name → zera o contador", () => {
    const r = processMessage("boa noite", sessaoName(2));
    expect(r.session.tentativasInvalidas).toBe(0);
  });

  it("mensagem inválida real ainda escalona no name ao atingir limite", () => {
    const r = processMessage("xyzabc123", sessaoName(2));
    expect(r.escalar).toBe(true);
  });
});
