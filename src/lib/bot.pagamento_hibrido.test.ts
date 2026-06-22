import { vi, describe, test, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import {
  processMessage,
  createInitialSession,
  BotSession,
  temPixNoPagamento,
  temDinheiroNoPagamento,
  valorPixEsperado,
  valorDinheiroEsperado,
} from "./bot";

// Sessão pronta no step de pagamento: retirada (sem bairro), nome já informado,
// carrinho de R$ 50,00 e sem taxa de entrega -> total = R$ 50,00.
function sessaoPayment(): BotSession {
  return {
    ...createInitialSession(),
    step: "payment",
    customerName: "Lucas",
    deliveryType: "pickup",
    deliveryFee: 0,
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
  };
}

const LABEL_HIBRIDO_DINHEIRO = "Pix (R$ 30,00) + Dinheiro (R$ 20,00)";
const LABEL_HIBRIDO_CARTAO = "Pix (R$ 30,00) + Cartão (R$ 20,00)";

// ===== Helpers centralizados de pagamento =====

describe("helpers de pagamento", () => {
  test("temPixNoPagamento reconhece Pix puro e híbrido, ignora os demais", () => {
    expect(temPixNoPagamento("Pix")).toBe(true);
    expect(temPixNoPagamento(LABEL_HIBRIDO_DINHEIRO)).toBe(true);
    expect(temPixNoPagamento(LABEL_HIBRIDO_CARTAO)).toBe(true);
    expect(temPixNoPagamento("Dinheiro")).toBe(false);
    expect(temPixNoPagamento("Cartão")).toBe(false);
    expect(temPixNoPagamento(undefined)).toBe(false);
  });

  test("temDinheiroNoPagamento reconhece dinheiro puro e híbrido", () => {
    expect(temDinheiroNoPagamento("Dinheiro")).toBe(true);
    expect(temDinheiroNoPagamento(LABEL_HIBRIDO_DINHEIRO)).toBe(true);
    expect(temDinheiroNoPagamento(LABEL_HIBRIDO_CARTAO)).toBe(false);
    expect(temDinheiroNoPagamento("Pix")).toBe(false);
    expect(temDinheiroNoPagamento(undefined)).toBe(false);
  });

  test("valorPixEsperado usa o total no Pix puro e a parte parcial no híbrido", () => {
    expect(valorPixEsperado("Pix", 50)).toBe(50);
    expect(valorPixEsperado(LABEL_HIBRIDO_DINHEIRO, 50)).toBe(30);
    expect(valorPixEsperado(LABEL_HIBRIDO_CARTAO, 50)).toBe(30);
    expect(valorPixEsperado("Dinheiro", 50)).toBe(0);
    expect(valorPixEsperado(undefined, 50)).toBe(0);
  });

  test("valorDinheiroEsperado usa o total no dinheiro puro e a parte parcial no híbrido", () => {
    expect(valorDinheiroEsperado("Dinheiro", 50)).toBe(50);
    expect(valorDinheiroEsperado(LABEL_HIBRIDO_DINHEIRO, 50)).toBe(20);
    expect(valorDinheiroEsperado("Pix", 50)).toBe(0);
    expect(valorDinheiroEsperado(LABEL_HIBRIDO_CARTAO, 50)).toBe(0);
  });
});

// ===== Pix puro =====

describe("Pix puro (comportamento preservado)", () => {
  test("retirada com pix vai direto para aguardando_pix (sem confirm intermediário)", () => {
    const r = processMessage("pix", sessaoPayment());
    // Pickup pula o confirm e vai direto a aguardando_pix
    expect(r.session.step).toBe("aguardando_pix");
    expect(r.session.paymentMethod).toBe("Pix");
  });
});

// ===== Dinheiro puro =====

describe("Dinheiro puro (comportamento preservado)", () => {
  test("pergunta troco sobre o total e fecha em done diretamente (pickup sem confirm)", () => {
    let r = processMessage("dinheiro", sessaoPayment());
    expect(r.session.step).toBe("troco");
    // valor menor que o total é rejeitado (baseline = total no dinheiro puro)
    const rejeitado = processMessage("40", r.session);
    expect(rejeitado.session.step).toBe("troco");
    // Pickup: após troco vai direto a done, sem confirm
    r = processMessage("não", r.session);
    expect(r.session.step).toBe("done");
  });
});

// ===== Híbrido Pix + Dinheiro =====

describe("Híbrido Pix + Dinheiro", () => {
  test("detecta o split e pergunta troco da PARTE em dinheiro (R$ 20), não do total", () => {
    const r = processMessage("vou pagar 30 no pix e 20 em dinheiro", sessaoPayment());
    expect(r.session.step).toBe("troco");
    expect(r.session.paymentMethod).toContain("Pix");
    expect(r.session.paymentMethod).toContain("Dinheiro");

    // R$ 30 é >= parte em dinheiro (R$ 20) -> válido, troco de R$ 10.
    // Se o baseline ainda fosse o total (R$ 50), isto seria rejeitado.
    // Pickup: após troco vai direto a aguardando_pix (tem Pix no pagamento, sem confirm).
    const comTroco = processMessage("30", r.session);
    expect(comTroco.session.step).toBe("aguardando_pix");
    expect(comTroco.session.troco).toContain("Troco de R$ 10,00");
  });

  test("após troco vai para aguardando_pix diretamente (pickup sem confirm)", () => {
    let r = processMessage("vou pagar 30 no pix e 20 em dinheiro", sessaoPayment());
    // sem troco -> pickup finaliza direto: tem Pix -> aguardando_pix
    r = processMessage("não", r.session);
    expect(r.session.step).toBe("aguardando_pix");
    expect(r.session.step).not.toBe("done");
  });

  test("não salva pedido antes do comprovante: o guard do webhook barra qualquer pagamento com Pix", () => {
    // O webhook só salva imediatamente quando NÃO há Pix (!temPixNoPagamento).
    // No híbrido com Pix o guard barra o salvamento até o comprovante chegar.
    expect(temPixNoPagamento(LABEL_HIBRIDO_DINHEIRO)).toBe(true);
  });

  test("comprovante é validado pela parte parcial do Pix (R$ 30), não pelo total (R$ 50)", () => {
    expect(valorPixEsperado(LABEL_HIBRIDO_DINHEIRO, 50)).toBe(30);
  });
});

// ===== Híbrido Pix + Cartão =====

describe("Híbrido Pix + Cartão", () => {
  test("sem dinheiro não pergunta troco e vai direto a aguardando_pix (pickup sem confirm)", () => {
    const r = processMessage("vou pagar 30 no pix e 20 no cartao", sessaoPayment());
    // pickup: sem dinheiro -> sem troco -> finalizarPedidoPickup -> tem Pix -> aguardando_pix diretamente
    expect(r.session.step).toBe("aguardando_pix");
    expect(r.session.paymentMethod).toContain("Pix");
    expect(r.session.paymentMethod).toContain("Cartão");
  });

  test("comprovante validado pela parte parcial do Pix", () => {
    expect(valorPixEsperado(LABEL_HIBRIDO_CARTAO, 50)).toBe(30);
  });
});
