import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, setEsgotados, setHorarioFuncionamento, type BotSession } from "./bot";

beforeEach(() => {
  setEsgotados([]);
  setHorarioFuncionamento("22h");
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function sessaoDeliveryType(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "delivery_type",
    cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 }],
    deliveryFee: 0,
    customerName: "Teste",
    ...overrides,
  };
}

function sessaoPaymentPickup(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "payment",
    cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 }],
    deliveryFee: 0,
    deliveryType: "pickup",
    customerName: "Teste",
    ...overrides,
  };
}

function sessaoPaymentDelivery(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "payment",
    cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 }],
    // "Centro" existe no menu com fee=3 — necessário para bairroConfirmadoValido() retornar true
    deliveryFee: 3,
    deliveryType: "delivery",
    neighborhood: "Centro",
    address: "Rua das Flores, 10",
    bairroConfirmado: true,
    customerName: "Teste",
    ...overrides,
  };
}

// ─── 1. Retirada não pede bairro ────────────────────────────────────────────

describe("retirada — não pede bairro nem endereço", () => {
  it("ao escolher retirada, NÃO menciona bairro", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    const msg = res.messages.join("\n").toLowerCase();
    expect(msg).not.toContain("bairro");
  });

  it("ao escolher retirada, NÃO menciona endereço", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    const msg = res.messages.join("\n").toLowerCase();
    expect(msg).not.toContain("endereço");
    expect(msg).not.toContain("rua");
  });

  it("ao escolher retirada (opção 2), step vai para payment (não neighborhood)", () => {
    const res = processMessage("2", sessaoDeliveryType());
    expect(res.session.step).toBe("payment");
    expect(res.session.deliveryType).toBe("pickup");
  });

  it("ao escolher retirada, NÃO cobra taxa de entrega (deliveryFee = 0 e sem valor de taxa)", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    // A mensagem pode mencionar "Sem taxa de entrega" (informativo) mas NÃO deve cobrar taxa
    expect(res.session.deliveryFee).toBe(0);
    // Não deve aparecer valor de taxa (ex: R$ 5,00)
    const msg = res.messages.join("\n");
    expect(msg).not.toMatch(/taxa.*R\$\s*\d/i);
  });

  it("ao escolher retirada, NÃO menciona motoboy", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    const msg = res.messages.join("\n").toLowerCase();
    expect(msg).not.toContain("motoboy");
    expect(msg).not.toContain("🛵");
  });

  it("ao escolher retirada, deliveryFee fica 0", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    expect(res.session.deliveryFee).toBe(0);
  });

  it("mensagem de retirada contém 'retirada no balcão'", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    const msg = res.messages.join("\n");
    expect(msg).toContain("retirada no balcão");
  });

  it("mensagem de retirada contém 'Sem taxa de entrega'", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Sem taxa de entrega");
  });

  it("mensagem de retirada pergunta forma de pagamento", () => {
    const res = processMessage("retirada", sessaoDeliveryType());
    const msg = res.messages.join("\n");
    expect(msg.toLowerCase()).toContain("pagamento");
  });
});

// ─── 2. Retirada não pergunta "Pode confirmar?" ──────────────────────────────

describe("retirada — sem tela de confirmação final", () => {
  it("pix na retirada NÃO vai ao step confirm", () => {
    const res = processMessage("pix", sessaoPaymentPickup());
    expect(res.session.step).not.toBe("confirm");
  });

  it("cartão na retirada NÃO vai ao step confirm", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    expect(res.session.step).not.toBe("confirm");
  });

  it("cartão na retirada NÃO menciona 'Tá certinho?'", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).not.toContain("Tá certinho?");
  });

  it("cartão na retirada NÃO menciona 'Pode confirmar'", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).not.toContain("Pode confirmar");
    expect(msg).not.toContain("pode confirmar");
  });

  it("cartão na retirada NÃO menciona 'Confirmar' como opção", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).not.toContain("✅ *1.* Confirmar");
  });

  it("cartão na retirada vai ao step done", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    expect(res.session.step).toBe("done");
  });
});

// ─── 3. Retirada finaliza com mensagem correta ───────────────────────────────

describe("retirada — mensagem de pedido confirmado", () => {
  it("cartão na retirada: mensagem contém 'retirada no balcão'", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).toContain("retirada no balcão");
  });

  it("cartão na retirada: mensagem contém 'Fechado ✅'", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Fechado ✅");
  });

  it("cartão na retirada: mensagem contém 'Quando chegar'", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Quando chegar");
  });

  it("cartão na retirada: mensagem NÃO menciona entrega nem motoboy", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n").toLowerCase();
    expect(msg).not.toContain("entrega");
    expect(msg).not.toContain("motoboy");
    expect(msg).not.toContain("🛵");
  });

  it("cartão na retirada: mensagem contém o total", () => {
    const res = processMessage("cartão", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).toContain("R$ 40,00");
  });
});

// ─── 4. Pix na retirada vai para aguardando_pix ──────────────────────────────

describe("retirada com Pix", () => {
  it("pix na retirada vai ao step aguardando_pix", () => {
    const res = processMessage("pix", sessaoPaymentPickup());
    expect(res.session.step).toBe("aguardando_pix");
  });

  it("pix na retirada: mensagem contém 'retirada no balcão'", () => {
    const res = processMessage("pix", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).toContain("retirada no balcão");
  });

  it("pix na retirada: mensagem contém 'Pix'", () => {
    const res = processMessage("pix", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Pix");
  });

  it("pix na retirada NÃO menciona 'Tá certinho?' ou 'Pode confirmar'", () => {
    const res = processMessage("pix", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).not.toContain("Tá certinho?");
    expect(msg).not.toContain("Pode confirmar");
  });

  it("pix na retirada: mensagem contém 'Fechado ✅'", () => {
    const res = processMessage("pix", sessaoPaymentPickup());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Fechado ✅");
  });
});

// ─── 5. Delivery continua pedindo bairro e com confirmação final ─────────────

describe("delivery — fluxo não alterado", () => {
  it("ao escolher delivery (opção 1), step vai para neighborhood", () => {
    const res = processMessage("1", sessaoDeliveryType());
    expect(res.session.step).toBe("neighborhood");
  });

  it("ao escolher delivery, NÃO menciona 'balcão'", () => {
    const res = processMessage("entrega", sessaoDeliveryType());
    const msg = res.messages.join("\n").toLowerCase();
    expect(msg).not.toContain("balcão");
  });

  it("pix no delivery vai ao step confirm (não done)", () => {
    const res = processMessage("pix", sessaoPaymentDelivery());
    expect(res.session.step).toBe("confirm");
  });

  it("cartão no delivery vai ao step confirm com 'Tá certinho?'", () => {
    const res = processMessage("cartão", sessaoPaymentDelivery());
    expect(res.session.step).toBe("confirm");
    expect(res.messages.join("\n")).toContain("Tá certinho?");
  });
});

// ─── 6. Consumo no local não quebrou ─────────────────────────────────────────

describe("dine_in — não alterado", () => {
  it("ao escolher consumo no local (opção 3), step vai para payment", () => {
    const res = processMessage("3", sessaoDeliveryType());
    expect(res.session.step).toBe("payment");
    expect(res.session.deliveryType).toBe("dine_in");
  });

  it("consumo no local NÃO menciona 'balcão'", () => {
    const res = processMessage("consumo no local", sessaoDeliveryType());
    const msg = res.messages.join("\n").toLowerCase();
    expect(msg).not.toContain("balcão");
  });

  it("cartão no dine_in vai ao step confirm", () => {
    const res = processMessage("cartão", {
      step: "payment",
      cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 }],
      deliveryFee: 0,
      deliveryType: "dine_in",
      customerName: "Teste",
    });
    expect(res.session.step).toBe("confirm");
  });
});

// ─── 7. Fluxo completo de retirada end-to-end ────────────────────────────────

describe("retirada — fluxo end-to-end", () => {
  it("fluxo completo: escolhe retirada → pix → aguardando_pix sem confirm", () => {
    let sess = sessaoDeliveryType();
    // Escolhe retirada
    const r1 = processMessage("retirada", sess);
    expect(r1.session.step).toBe("payment");
    expect(r1.session.deliveryType).toBe("pickup");
    expect(r1.session.deliveryFee).toBe(0);
    expect(r1.messages.join("\n")).toContain("retirada no balcão");
    // Informa pagamento pix
    const r2 = processMessage("pix", r1.session);
    expect(r2.session.step).toBe("aguardando_pix");
    expect(r2.messages.join("\n")).not.toContain("Tá certinho?");
    expect(r2.messages.join("\n")).toContain("retirada no balcão");
  });

  it("fluxo completo: escolhe retirada → cartão → done com resumo", () => {
    let sess = sessaoDeliveryType();
    const r1 = processMessage("retirada", sess);
    const r2 = processMessage("cartão", r1.session);
    expect(r2.session.step).toBe("done");
    const msg = r2.messages.join("\n");
    expect(msg).toContain("Fechado ✅");
    expect(msg).toContain("retirada no balcão");
    expect(msg).toContain("Quando chegar");
    expect(msg).not.toContain("Tá certinho?");
  });

  it("fluxo completo: retirada → dinheiro → sem troco → done com resumo", () => {
    let sess = sessaoDeliveryType();
    const r1 = processMessage("retirada", sess);
    const r2 = processMessage("dinheiro", r1.session);
    // Deve perguntar troco
    expect(r2.session.step).toBe("troco");
    expect(r2.messages.join("\n").toLowerCase()).toContain("troco");
    // Responde sem troco
    const r3 = processMessage("não", r2.session);
    expect(r3.session.step).toBe("done");
    const msg = r3.messages.join("\n");
    expect(msg).toContain("Fechado ✅");
    expect(msg).toContain("retirada no balcão");
    expect(msg).not.toContain("Tá certinho?");
  });
});
