// Mock redis before any module import
jest.mock("./redis", () => ({ redis: { get: jest.fn().mockResolvedValue(null) } }));

import { processMessage, detectarLancheEspecifico, createInitialSession, BotSession } from "./bot";

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

// ===== detectarLancheEspecifico() =====

describe("detectarLancheEspecifico", () => {
  const sess = sessaoCategoria();

  test("detecta 'macarronada' e vai para lanche_macarronada_size", () => {
    const res = detectarLancheEspecifico("quero uma macarronada", sess);
    expect(res).not.toBeNull();
    expect(res!.session.step).toBe("lanche_macarronada_size");
    expect(res!.session.currentLanche).toBe("Macarronada de Carne");
    expect(res!.messages[0]).toContain("Macarronada de Carne");
  });

  test("detecta 'macaronada' (erro ortográfico)", () => {
    const res = detectarLancheEspecifico("macaronada", sess);
    expect(res).not.toBeNull();
    expect(res!.session.step).toBe("lanche_macarronada_size");
  });

  test("detecta 'tem macarrão?' via alias", () => {
    const res = detectarLancheEspecifico("tem macarrão?", sess);
    expect(res).not.toBeNull();
    expect(res!.session.step).toBe("lanche_macarronada_size");
  });

  test("detecta 'massa' via alias", () => {
    const res = detectarLancheEspecifico("quero massa", sess);
    expect(res).not.toBeNull();
    expect(res!.session.step).toBe("lanche_macarronada_size");
  });

  test("NÃO ativa para texto genérico 'lanche'", () => {
    const res = detectarLancheEspecifico("lanche", sess);
    expect(res).toBeNull();
  });

  test("NÃO ativa para '2' (categoria lanche)", () => {
    const res = detectarLancheEspecifico("2", sess);
    expect(res).toBeNull();
  });

  test("detecta 'calzone' e vai para lanche_flavor", () => {
    const res = detectarLancheEspecifico("quero calzone", sess);
    expect(res).not.toBeNull();
    expect(res!.session.step).toBe("lanche_flavor");
    expect(res!.session.currentLanche).toBe("Calzone");
  });
});

// ===== processMessage() — step category =====

describe("category step — produto específico", () => {
  test("'quero uma macarronada' NÃO abre lista de lanches, vai para tamanho", () => {
    const res = processMessage("quero uma macarronada", sessaoCategoria());
    expect(res.session.step).toBe("lanche_macarronada_size");
    expect(res.messages[0]).toContain("Macarronada de Carne");
    expect(res.messages[0]).not.toContain("Calzone");
  });

  test("'macaronada' (sem segundo r) detecta macarronada", () => {
    const res = processMessage("macaronada", sessaoCategoria());
    expect(res.session.step).toBe("lanche_macarronada_size");
  });

  test("'tem macarrão?' detecta macarronada", () => {
    const res = processMessage("tem macarrão?", sessaoCategoria());
    expect(res.session.step).toBe("lanche_macarronada_size");
  });

  test("'quero lanche' continua abrindo categoria de lanches", () => {
    const res = processMessage("quero lanche", sessaoCategoria());
    expect(res.session.step).toBe("lanche_escolha");
    expect(res.messages[0]).toContain("Calzone");
  });

  test("'quero pizza' continua no fluxo de pizza", () => {
    const res = processMessage("quero pizza", sessaoCategoria());
    expect(res.session.step).toBe("size");
  });
});

// ===== add_more step — produto específico =====

describe("add_more step — produto específico", () => {
  test("'quero uma macarronada' no add_more vai para tamanho, não lista tudo", () => {
    const res = processMessage("quero uma macarronada", sessaoAddMore());
    expect(res.session.step).toBe("lanche_macarronada_size");
    expect(res.messages[0]).toContain("Macarronada de Carne");
    expect(res.messages[0]).not.toContain("Calzone");
  });

  test("'lanche' no add_more continua abrindo cardápio completo", () => {
    const res = processMessage("lanche", sessaoAddMore());
    expect(res.session.step).toBe("lanche_escolha");
  });
});

// ===== Fluxo completo após escolher macarronada =====

describe("fluxo completo após macarronada", () => {
  test("após macarronada_size escolher tamanho vai para add_more", () => {
    const sessSize: BotSession = {
      ...createInitialSession(),
      step: "lanche_macarronada_size",
      customerName: "Teste",
      currentLanche: "Macarronada de Carne",
    };
    const res = processMessage("P", sessSize);
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart).toHaveLength(1);
    expect(res.session.cart[0].name).toBe("Macarronada de Carne");
    expect(res.session.cart[0].size).toBe("P");
    expect(res.session.cart[0].price).toBe(28);
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
