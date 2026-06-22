import { describe, test, expect } from "vitest";
import { vi } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { normalizarMensagemCliente, ehMensagemSomenteEmoji } from "./normalizarMensagem";
import { processMessage, createInitialSession, type BotSession } from "./bot";

// ── normalizarMensagemCliente() ──────────────────────────────────────────────

describe("normalizarMensagemCliente", () => {
  test("remove emoji do final do texto preservando o conteúdo", () => {
    expect(normalizarMensagemCliente("frango com catupiry e 3 queijo 😋")).toBe(
      "frango com catupiry e 3 queijo"
    );
  });

  test("remove múltiplos emoji consecutivos", () => {
    expect(normalizarMensagemCliente("3 queijo 🍕🔥")).toBe("3 queijo");
  });

  test("remove emoji de verificação (✅)", () => {
    expect(normalizarMensagemCliente("pix ✅")).toBe("pix");
  });

  test("remove emoji de polegar (👍)", () => {
    expect(normalizarMensagemCliente("sem troco 👍")).toBe("sem troco");
  });

  test("retorna string vazia se mensagem era apenas emoji", () => {
    expect(normalizarMensagemCliente("😋")).toBe("");
  });

  test("retorna string vazia para múltiplos emoji sem texto", () => {
    expect(normalizarMensagemCliente("🍕🔥")).toBe("");
  });

  test("preserva letras com acento", () => {
    expect(normalizarMensagemCliente("frango com catupiry 😋")).toBe(
      "frango com catupiry"
    );
    expect(normalizarMensagemCliente("à vontade 😊")).toBe("à vontade");
  });

  test("preserva números", () => {
    expect(normalizarMensagemCliente("3 queijo 🍕")).toBe("3 queijo");
    expect(normalizarMensagemCliente("R$ 50,00 💰")).toBe("R$ 50,00");
  });

  test("normaliza espaços duplicados gerados pela remoção de emoji inline", () => {
    // emoji no meio gera espaço duplo
    const resultado = normalizarMensagemCliente("frango 😋 com catupiry");
    expect(resultado).toBe("frango com catupiry");
  });

  test("string vazia retorna string vazia", () => {
    expect(normalizarMensagemCliente("")).toBe("");
  });

  test("texto sem emoji permanece inalterado", () => {
    expect(normalizarMensagemCliente("quero uma pizza grande calabresa")).toBe(
      "quero uma pizza grande calabresa"
    );
  });
});

// ── ehMensagemSomenteEmoji() ─────────────────────────────────────────────────

describe("ehMensagemSomenteEmoji", () => {
  test("retorna true para mensagem só com emoji", () => {
    expect(ehMensagemSomenteEmoji("😋")).toBe(true);
    expect(ehMensagemSomenteEmoji("🍕🔥")).toBe(true);
  });

  test("retorna false para texto com emoji", () => {
    expect(ehMensagemSomenteEmoji("pix ✅")).toBe(false);
    expect(ehMensagemSomenteEmoji("3 queijo 🍕")).toBe(false);
  });

  test("retorna false para texto sem emoji", () => {
    expect(ehMensagemSomenteEmoji("quero pizza")).toBe(false);
  });

  test("retorna false para string vazia", () => {
    expect(ehMensagemSomenteEmoji("")).toBe(false);
  });
});

// ── Testes de integração: processMessage com emoji ───────────────────────────

function sessaoFlavor(): BotSession {
  return {
    ...createInitialSession(),
    step: "flavor",
    customerName: "Teste",
    currentCategory: "pizza",
    currentSize: "M",
  };
}

function sessaoPayment(): BotSession {
  return {
    ...createInitialSession(),
    step: "payment",
    customerName: "Teste",
    cart: [
      {
        category: "pizza",
        name: "Pizza",
        size: "M",
        flavor: "Calabresa",
        border: "Sem borda",
        price: 40,
      },
    ],
    deliveryFee: 5,
  };
}

describe("processMessage com emoji — dois sabores", () => {
  test('reconhece Frango com Catupiry E Três Queijos em "frango com catupiry e 3 queijo 😋"', () => {
    const result = processMessage(
      "frango com catupiry e 3 queijo 😋",
      sessaoFlavor()
    );
    const msgs = result.messages.join(" ");
    // Deve ter reconhecido dois sabores sem cair em "opção inválida"
    expect(msgs.toLowerCase()).not.toMatch(/invalida|nao entendi|opção/i);
    expect(msgs).toMatch(/[Ff]rango|[Cc]atupiry/);
    expect(msgs).toMatch(/[Qq]ueijo/);
  });

  test('reconhece Três Queijos em "3 queijo 🍕🔥"', () => {
    const result = processMessage("3 queijo 🍕🔥", sessaoFlavor());
    const msgs = result.messages.join(" ");
    expect(msgs.toLowerCase()).not.toMatch(/invalida|nao entendi/i);
    expect(msgs).toMatch(/[Qq]ueijo/);
  });
});

describe("processMessage com emoji — pagamento", () => {
  test('"pix ✅" continua reconhecendo Pix', () => {
    const result = processMessage("pix ✅", sessaoPayment());
    const msgs = result.messages.join(" ").toLowerCase();
    expect(msgs).not.toMatch(/invalida|nao entendi/i);
    expect(msgs).toMatch(/pix/);
  });
});

describe("processMessage com emoji — mensagem só com emoji", () => {
  test("mensagem só com emoji não avança o step", () => {
    const sessao = sessaoFlavor();
    const result = processMessage("😋", sessao);
    // Step deve permanecer o mesmo
    expect(result.session.step).toBe(sessao.step);
  });

  test("mensagem só com emoji não cai em opção inválida", () => {
    const result = processMessage("😋", sessaoFlavor());
    const msgs = result.messages.join(" ");
    expect(msgs.toLowerCase()).not.toMatch(/invalida|nao entendi|opção/i);
  });

  test("mensagem só com emoji não altera o carrinho", () => {
    const sessao = sessaoPayment();
    const result = processMessage("🍕🔥", sessao);
    expect(result.session.cart).toEqual(sessao.cart);
  });

  test("mensagem só com emoji retorna sem mensagens de bot", () => {
    const result = processMessage("😋", sessaoFlavor());
    expect(result.messages).toHaveLength(0);
  });
});

describe("processMessage — fluxo normal sem emoji não é afetado", () => {
  test("pedido de pizza sem emoji funciona normalmente", () => {
    const result = processMessage("calabresa", sessaoFlavor());
    const msgs = result.messages.join(" ");
    expect(msgs.toLowerCase()).not.toMatch(/invalida|nao entendi/i);
    expect(msgs).toMatch(/[Cc]alabresa/);
  });

  test('"sem troco 👍" mantém reconhecimento de troco', () => {
    const sessaoTroco: BotSession = {
      ...createInitialSession(),
      step: "troco",
      customerName: "Teste",
      cart: [
        {
          category: "pizza",
          name: "Pizza",
          size: "M",
          flavor: "Calabresa",
          border: "Sem borda",
          price: 40,
        },
      ],
      paymentMethod: "Dinheiro",
      deliveryFee: 5,
    };
    const result = processMessage("sem troco 👍", sessaoTroco);
    const msgs = result.messages.join(" ").toLowerCase();
    expect(msgs).not.toMatch(/invalida|nao entendi/i);
  });
});
