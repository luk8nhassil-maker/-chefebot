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

// ─── category: contexto humano com tentativas acumuladas não escalona ─────────

describe("category: contexto humano leve não escalona nem acumula tentativas", () => {
  // Nota: "você é humano?" contém "humano" que está em PALAVRAS_ESCALONAMENTO,
  // então escalona pelo guard global — não pelo nosso patch. Testamos só mensagens
  // que chegam ao step-specific handler.
  it.each(["me conta uma piada", "kkk", "hoje foi um dia cansativo", "tô sem ideia", "me surpreende", "bora", "me salva"])(
    '"%s" com tentativasInvalidas:2 → não escalar', (msg) => {
      const r = processMessage(msg, sessaoCategory(2));
      expect(r.escalar).toBeFalsy();
    },
  );

  it('"me conta uma piada" com tentativas:2 → zera contador', () => {
    const r = processMessage("me conta uma piada", sessaoCategory(2));
    expect(r.session.tentativasInvalidas).toBe(0);
  });

  it('"kkk" com tentativas:2 → mantém step category', () => {
    const r = processMessage("kkk", sessaoCategory(2));
    expect(r.session.step).toBe("category");
  });

  it('"bora" com tentativas:2 → não altera carrinho', () => {
    const session = sessaoCategory(2);
    const r = processMessage("bora", session);
    expect(r.session.cart).toEqual([]);
  });

  it("mensagem de reclamação 'demorou' com tentativas:2 → escalona (fluxo atual mantido)", () => {
    const r = processMessage("demorou demais", sessaoCategory(2));
    expect(r.escalar).toBe(true);
  });

  it("mensagem sensível 'tenho alergia' com tentativas:2 → escalona (não tratada como venda)", () => {
    const r = processMessage("tenho alergia", sessaoCategory(2));
    expect(r.escalar).toBe(true);
  });
});

// ─── add_more: contexto humano com tentativas acumuladas não escalona ─────────

describe("add_more: contexto humano leve não escalona nem acumula tentativas", () => {
  it.each(["me conta uma piada", "kkk", "bora", "tô sem ideia"])(
    '"%s" com tentativasInvalidas:2 → não escalar', (msg) => {
      const r = processMessage(msg, sessaoAddMore(2));
      expect(r.escalar).toBeFalsy();
    },
  );

  it('"me conta uma piada" no add_more → zera contador', () => {
    const r = processMessage("me conta uma piada", sessaoAddMore(2));
    expect(r.session.tentativasInvalidas).toBe(0);
  });

  it('"bora" no add_more → mantém step add_more e carrinho intacto', () => {
    const session = sessaoAddMore(2);
    const r = processMessage("bora", session);
    expect(r.session.step).toBe("add_more");
    expect(r.session.cart).toEqual(session.cart);
  });

  it("'demorou' com tentativas:2 no add_more → escalona", () => {
    const r = processMessage("demorou demais", sessaoAddMore(2));
    expect(r.escalar).toBe(true);
  });
});

// ─── name: contexto humano com tentativas acumuladas não escalona ─────────────

describe("name: contexto humano leve não escalona nem acumula tentativas", () => {
  it.each(["me conta uma piada", "kkk", "bora", "tô sem ideia"])(
    '"%s" com tentativasInvalidas:2 no name → não escalar', (msg) => {
      const r = processMessage(msg, sessaoName(2));
      expect(r.escalar).toBeFalsy();
    },
  );

  it('"me conta uma piada" no name → zera contador', () => {
    const r = processMessage("me conta uma piada", sessaoName(2));
    expect(r.session.tentativasInvalidas).toBe(0);
  });

  // No step name, "demorou demais" é aceito como nome (pareceNomeHumano=true)
  // e não escalona — é o comportamento esperado do step name.
  // Reclamações explícitas com palavras em PALAVRAS_ESCALONAMENTO escalona globalmente.
  it("'reclamação' com tentativas:2 no name → escalona (via PALAVRAS_ESCALONAMENTO global)", () => {
    const r = processMessage("quero fazer uma reclamação", sessaoName(2));
    expect(r.escalar).toBe(true);
  });
});
