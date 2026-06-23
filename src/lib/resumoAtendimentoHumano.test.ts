import { describe, it, expect } from "vitest";
import { calcularResumoAtendimentoHumano } from "./resumoAtendimentoHumano";
import { createInitialSession, type BotSession } from "./bot";

function sessaoBase(over: Partial<BotSession> = {}): BotSession {
  return { ...createInitialSession(), ...over };
}

function sessaoCompleta(): BotSession {
  return sessaoBase({
    customerName: "João",
    cart: [
      { category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 },
      { category: "bebida", name: "Refrigerante 1L", price: 8 },
    ],
    deliveryType: "delivery",
    neighborhood: "Centro",
    bairroConfirmado: true,
    address: "Rua das Flores, 10",
    deliveryFee: 5,
    paymentMethod: "Pix",
  });
}

// ─── 1. Delivery sem bairro gera pendência ────────────────────────────────────

describe("1. delivery sem bairro gera pendência", () => {
  it("pendência 'Confirmar bairro' aparece quando neighborhood está vazio", () => {
    const s = sessaoCompleta();
    s.neighborhood = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar bairro");
  });

  it("pendência 'Confirmar bairro' aparece quando neighborhood é undefined", () => {
    const s = sessaoCompleta();
    s.neighborhood = undefined;
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar bairro");
  });
});

// ─── 2. Delivery sem endereço gera pendência ──────────────────────────────────

describe("2. delivery sem endereço gera pendência", () => {
  it("pendência 'Confirmar endereço' quando address está vazio", () => {
    const s = sessaoCompleta();
    s.address = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar endereço");
  });

  it("pendência 'Confirmar endereço' quando address é undefined", () => {
    const s = sessaoCompleta();
    s.address = undefined;
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar endereço");
  });
});

// ─── 3. Sem pagamento gera pendência ──────────────────────────────────────────

describe("3. sem pagamento gera pendência", () => {
  it("pendência 'Confirmar forma de pagamento' quando paymentMethod está vazio", () => {
    const s = sessaoCompleta();
    s.paymentMethod = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar forma de pagamento");
  });

  it("sem pendência de pagamento quando paymentMethod está preenchido", () => {
    const s = sessaoCompleta(); // paymentMethod: "Pix"
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).not.toContain("Confirmar forma de pagamento");
  });
});

// ─── 4. Sem itens gera pendência ──────────────────────────────────────────────

describe("4. sem itens gera pendência", () => {
  it("pendência 'Confirmar itens do pedido' quando carrinho está vazio", () => {
    const s = sessaoCompleta();
    s.cart = [];
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar itens do pedido");
  });

  it("sem pendência de itens quando carrinho tem pelo menos um item", () => {
    const s = sessaoCompleta();
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).not.toContain("Confirmar itens do pedido");
  });
});

// ─── 5. Retirada não exige bairro nem endereço ───────────────────────────────

describe("5. retirada não exige bairro nem endereço", () => {
  it("retirada sem bairro não gera pendência de bairro", () => {
    const s = sessaoCompleta();
    s.deliveryType = "pickup";
    s.neighborhood = "";
    s.address = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).not.toContain("Confirmar bairro");
    expect(r.pendencias).not.toContain("Confirmar endereço");
  });

  it("tipo de entrega da retirada é mapeado corretamente", () => {
    const s = sessaoCompleta();
    s.deliveryType = "pickup";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.tipoEntrega).toBe("retirada");
    expect(r.tipoEntregaLabel).toBe("Retirada na loja");
  });
});

// ─── 6. Consumo no local não exige bairro nem endereço ───────────────────────

describe("6. consumo no local não exige bairro nem endereço", () => {
  it("dine_in sem bairro nem endereço não gera pendências de endereço", () => {
    const s = sessaoCompleta();
    s.deliveryType = "dine_in";
    s.neighborhood = "";
    s.address = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).not.toContain("Confirmar bairro");
    expect(r.pendencias).not.toContain("Confirmar endereço");
  });

  it("tipo de entrega dine_in é mapeado corretamente", () => {
    const s = sessaoCompleta();
    s.deliveryType = "dine_in";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.tipoEntrega).toBe("dine_in");
    expect(r.tipoEntregaLabel).toBe("Consumo no local");
  });
});

// ─── 7. Quando tudo está preenchido, pendências fica vazio ───────────────────

describe("7. pedido completo — sem pendências", () => {
  it("pendências vazia quando tudo está informado (delivery)", () => {
    const r = calcularResumoAtendimentoHumano(sessaoCompleta());
    expect(r.pendencias).toHaveLength(0);
  });

  it("pendências vazia para retirada com nome, itens e pagamento", () => {
    const s = sessaoBase({
      customerName: "Maria",
      cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Mussarela", border: "Sem borda", price: 40 }],
      deliveryType: "pickup",
      deliveryFee: 0,
      paymentMethod: "Cartão",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toHaveLength(0);
  });
});

// ─── 8. Helper não altera a sessão original ───────────────────────────────────

describe("8. helper não altera a sessão original", () => {
  it("sessão original é preservada após cálculo do resumo", () => {
    const s = sessaoCompleta();
    const stepAntes = s.step;
    const cartAntes = JSON.stringify(s.cart);
    const nomeAntes = s.customerName;

    calcularResumoAtendimentoHumano(s);

    expect(s.step).toBe(stepAntes);
    expect(JSON.stringify(s.cart)).toBe(cartAntes);
    expect(s.customerName).toBe(nomeAntes);
  });

  it("alteração no objeto retornado não afeta a sessão", () => {
    const s = sessaoCompleta();
    const r = calcularResumoAtendimentoHumano(s);
    r.itens.push("Item fantasma");
    // carrinho original não muda
    expect(s.cart.length).toBe(2);
  });
});

// ─── 9. Carrinho com itens gera resumo legível ───────────────────────────────

describe("9. resumo legível do carrinho", () => {
  it("pizza com tamanho, sabor e borda aparece formatada", () => {
    const s = sessaoBase({
      customerName: "Ana",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Catupiry", price: 55 }],
      deliveryType: "pickup",
      deliveryFee: 0,
      paymentMethod: "Pix",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.itens[0]).toBe("Pizza G Calabresa + Catupiry");
  });

  it("item sem borda 'Sem borda' não exibe borda", () => {
    const s = sessaoBase({
      customerName: "Pedro",
      cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Frango", border: "Sem borda", price: 40 }],
      deliveryType: "pickup",
      deliveryFee: 0,
      paymentMethod: "Dinheiro",
      troco: "Para 50",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.itens[0]).toBe("Pizza M Frango");
    expect(r.itens[0]).not.toContain("Sem borda");
  });

  it("item sem sabor (bebida) aparece apenas com o nome", () => {
    const s = sessaoBase({
      customerName: "Carlos",
      cart: [{ category: "bebida", name: "Coca-Cola 600ml", price: 6 }],
      deliveryType: "pickup",
      deliveryFee: 0,
      paymentMethod: "Pix",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.itens[0]).toBe("Coca-Cola 600ml");
  });
});

// ─── 10. Total soma itens + taxa de entrega ───────────────────────────────────

describe("10. total = itens + taxa de entrega", () => {
  it("total inclui deliveryFee quando é delivery", () => {
    const s = sessaoCompleta(); // cart: 50+8=58, deliveryFee: 5 → total: 63
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.total).toBe(63);
  });

  it("total sem taxa quando deliveryFee é zero (retirada)", () => {
    const s = sessaoBase({
      customerName: "Ana",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "pickup",
      deliveryFee: 0,
      paymentMethod: "Pix",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.total).toBe(50);
  });

  it("total é zero quando carrinho está vazio", () => {
    const s = sessaoBase({ cart: [], deliveryFee: 0 });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.total).toBe(0);
  });
});

// ─── 11a. statusFechamento ────────────────────────────────────────────────────

describe("11a. statusFechamento", () => {
  it("sem pedido → incompleto", () => {
    const s = sessaoBase();
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.statusFechamento.nivel).toBe("incompleto");
  });

  it("pedido com várias pendências → incompleto", () => {
    const s = sessaoBase({
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "delivery",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias.length).toBeGreaterThan(1);
    expect(r.statusFechamento.nivel).toBe("incompleto");
  });

  it("pedido com apenas uma pendência e já tem item → quase_pronto", () => {
    const s = sessaoBase({
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "pickup",
      paymentMethod: "Pix",
      // falta apenas nome
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toEqual(["Confirmar nome do cliente"]);
    expect(r.statusFechamento.nivel).toBe("quase_pronto");
    expect(r.statusFechamento.titulo).toBe("Quase pronto");
  });

  it("pedido completo sem pendências → pronto", () => {
    const r = calcularResumoAtendimentoHumano(sessaoCompleta());
    expect(r.pendencias).toHaveLength(0);
    expect(r.statusFechamento.nivel).toBe("pronto");
    expect(r.statusFechamento.titulo).toBe("Pronto para finalizar");
  });

  it("delivery sem bairro/endereço → não pode ser pronto", () => {
    const s = sessaoCompleta();
    s.neighborhood = "";
    s.address = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.statusFechamento.nivel).not.toBe("pronto");
  });

  it("retirada com cliente, pedido e pagamento → pronto", () => {
    const s = sessaoBase({
      customerName: "Maria",
      cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Mussarela", border: "Sem borda", price: 40 }],
      deliveryType: "pickup",
      deliveryFee: 0,
      paymentMethod: "Cartão",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.statusFechamento.nivel).toBe("pronto");
  });

  it("dinheiro sem troco quando precisa → quase_pronto se só falta troco", () => {
    const s = sessaoBase({
      customerName: "Ana",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "pickup",
      paymentMethod: "Dinheiro",
      troco: "",
    });
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar troco");
    expect(r.pendencias).toHaveLength(1);
    expect(r.statusFechamento.nivel).toBe("quase_pronto");
  });

  it("statusFechamento não altera as pendências existentes", () => {
    const s = sessaoCompleta();
    s.paymentMethod = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar forma de pagamento");
    expect(r.statusFechamento).toBeDefined();
    expect(r.pendencias).toContain("Confirmar forma de pagamento");
  });
});

// ─── 11. Troco — pendência apenas com pagamento em dinheiro ──────────────────

describe("11. troco — pendência somente quando pagamento em dinheiro", () => {
  it("dinheiro sem troco gera pendência de troco", () => {
    const s = sessaoCompleta();
    s.paymentMethod = "Dinheiro";
    s.troco = "";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).toContain("Confirmar troco");
  });

  it("Pix sem troco não gera pendência de troco", () => {
    const s = sessaoCompleta(); // paymentMethod: "Pix"
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).not.toContain("Confirmar troco");
  });

  it("dinheiro com troco definido não gera pendência", () => {
    const s = sessaoCompleta();
    s.paymentMethod = "Dinheiro";
    s.troco = "Para R$ 100";
    const r = calcularResumoAtendimentoHumano(s);
    expect(r.pendencias).not.toContain("Confirmar troco");
  });
});
