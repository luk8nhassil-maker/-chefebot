// Mock redis before any module import
jest.mock("./redis", () => ({ redis: { get: jest.fn().mockResolvedValue(null) } }));

import { processMessage, detectarLancheEspecifico, detectarFamiliaProduto, createInitialSession, BotSession } from "./bot";

function sessaoCategoria(): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Teste" };
}

function sessaoAddMore(): BotSession {
  return {
    ...createInitialSession(),
    step: "add_more",
    customerName: "Teste",
    cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 }],
  };
}

// ===== detectarFamiliaProduto() =====

describe("detectarFamiliaProduto", () => {
  test("detecta 'macarronada' como família", () => {
    const res = detectarFamiliaProduto("quero uma macarronada");
    expect(res).not.toBeNull();
    expect(res!.label).toBe("macarronada");
    expect(res!.itens.some(i => i.name === "Macarronada de Carne")).toBe(true);
  });

  test("detecta 'macaronada' (erro ortográfico)", () => {
    const res = detectarFamiliaProduto("macaronada");
    expect(res).not.toBeNull();
    expect(res!.label).toBe("macarronada");
  });

  test("detecta 'tem macarrão?'", () => {
    const res = detectarFamiliaProduto("tem macarrão?");
    expect(res).not.toBeNull();
    expect(res!.label).toBe("macarronada");
  });

  test("detecta 'massa' via alias", () => {
    const res = detectarFamiliaProduto("quero massa");
    expect(res).not.toBeNull();
    expect(res!.label).toBe("macarronada");
  });

  test("NÃO detecta família para 'lanche' genérico", () => {
    expect(detectarFamiliaProduto("lanche")).toBeNull();
    expect(detectarFamiliaProduto("quero lanche")).toBeNull();
  });

  test("NÃO detecta família para 'pizza'", () => {
    expect(detectarFamiliaProduto("quero pizza")).toBeNull();
  });

  test("NÃO detecta família para '2' (opção de menu)", () => {
    expect(detectarFamiliaProduto("2")).toBeNull();
  });

  test("família só contém itens de macarronada", () => {
    const res = detectarFamiliaProduto("macarronada");
    expect(res).not.toBeNull();
    const nomes = res!.itens.map(i => i.name);
    expect(nomes).not.toContain("Calzone");
    expect(nomes).not.toContain("X-Burguer");
    expect(nomes).not.toContain("X-Bacon");
    expect(nomes).not.toContain("X-Tudo");
    expect(nomes).not.toContain("Porcao de Batatas");
    expect(nomes).toContain("Macarronada de Carne");
  });
});

// ===== processMessage() — step category =====

describe("category step — produto específico", () => {
  test("'quero uma macarronada' vai para product_family_choice", () => {
    const res = processMessage("quero uma macarronada", sessaoCategoria());
    expect(res.session.step).toBe("product_family_choice");
  });

  test("resposta NÃO contém outros lanches", () => {
    const res = processMessage("quero uma macarronada", sessaoCategoria());
    const msg = res.messages.join("\n");
    expect(msg).not.toContain("Calzone");
    expect(msg).not.toContain("X-Burguer");
    expect(msg).not.toContain("X-Bacon");
    expect(msg).not.toContain("X-Tudo");
    expect(msg).not.toContain("Porção de Batatas");
    expect(msg).not.toContain("Porcao de Batatas");
  });

  test("resposta contém título correto (sem 'Nossos lanches')", () => {
    const res = processMessage("quero uma macarronada", sessaoCategoria());
    const msg = res.messages.join("\n");
    expect(msg.toLowerCase()).not.toContain("nossos lanches");
    expect(msg.toLowerCase()).toContain("macarronada");
  });

  test("'macaronada' (erro ortográfico) vai para product_family_choice", () => {
    const res = processMessage("macaronada", sessaoCategoria());
    expect(res.session.step).toBe("product_family_choice");
  });

  test("'tem macarrão?' vai para product_family_choice", () => {
    const res = processMessage("tem macarrão?", sessaoCategoria());
    expect(res.session.step).toBe("product_family_choice");
  });

  test("'quero lanche' continua abrindo categoria de lanches completa", () => {
    const res = processMessage("quero lanche", sessaoCategoria());
    expect(res.session.step).toBe("lanche_escolha");
    const msg = res.messages.join("\n");
    expect(msg).toContain("Calzone");
  });

  test("'quero pizza' continua no fluxo de pizza", () => {
    const res = processMessage("quero pizza", sessaoCategoria());
    expect(res.session.step).toBe("size");
  });
});

// ===== add_more step — produto específico =====

describe("add_more step — produto específico", () => {
  test("'quero uma macarronada' no add_more vai para product_family_choice", () => {
    const res = processMessage("quero uma macarronada", sessaoAddMore());
    expect(res.session.step).toBe("product_family_choice");
  });

  test("resposta no add_more não contém outros lanches", () => {
    const res = processMessage("quero uma macarronada", sessaoAddMore());
    const msg = res.messages.join("\n");
    expect(msg).not.toContain("Calzone");
    expect(msg).not.toContain("X-Burguer");
    expect(msg).toContain("Macarronada de Carne");
  });

  test("'lanche' no add_more continua abrindo cardápio completo", () => {
    const res = processMessage("lanche", sessaoAddMore());
    expect(res.session.step).toBe("lanche_escolha");
    const msg = res.messages.join("\n");
    expect(msg).toContain("Calzone");
  });
});

// ===== Fluxo completo após escolher macarronada =====

describe("fluxo completo após product_family_choice", () => {
  function sessaoFamilyChoice(): BotSession {
    return {
      ...createInitialSession(),
      step: "product_family_choice",
      customerName: "Teste",
      currentCategory: "lanche",
      familiaLabel: "macarronada",
      candidatosFamilia: [{ name: "Macarronada de Carne", price: 0, hasFlavors: false, flavorsKey: "", sizes: [{ code: "P", price: 28 }, { code: "M", price: 40 }, { code: "G", price: 50 }] }],
    };
  }

  test("digitar '1' vai para lanche_macarronada_size", () => {
    const res = processMessage("1", sessaoFamilyChoice());
    expect(res.session.step).toBe("lanche_macarronada_size");
    expect(res.session.currentLanche).toBe("Macarronada de Carne");
  });

  test("digitar tamanho 'P' adiciona ao carrinho", () => {
    const res = processMessage("P", sessaoFamilyChoice());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart).toHaveLength(1);
    expect(res.session.cart[0].name).toBe("Macarronada de Carne");
    expect(res.session.cart[0].size).toBe("P");
    expect(res.session.cart[0].price).toBe(28);
  });

  test("digitar tamanho 'G' adiciona ao carrinho com preço correto", () => {
    const res = processMessage("G", sessaoFamilyChoice());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart[0].price).toBe(50);
  });

  test("após lanche_macarronada_size escolher tamanho vai para add_more", () => {
    const sessSize: BotSession = {
      ...createInitialSession(),
      step: "lanche_macarronada_size",
      customerName: "Teste",
      currentLanche: "Macarronada de Carne",
    };
    const res = processMessage("M", sessSize);
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart[0].size).toBe("M");
    expect(res.session.cart[0].price).toBe(40);
  });

  test("após add_more fechar pedido vai para delivery_type", () => {
    const sessAddMore: BotSession = {
      ...createInitialSession(),
      step: "add_more",
      customerName: "Teste",
      cart: [{ category: "lanche", name: "Macarronada de Carne", size: "P", price: 28 }],
    };
    const res = processMessage("fechar pedido", sessAddMore);
    expect(res.session.step).toBe("delivery_type");
  });
});
