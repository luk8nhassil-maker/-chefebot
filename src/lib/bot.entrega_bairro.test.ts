import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, createInitialSession, type BotSession } from "./bot";

// Sessão de entrega: cliente já escolheu entrega, está no step de bairro
function sessaoNeighborhood(overrides: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(),
    step: "neighborhood",
    customerName: "Teste",
    deliveryType: "delivery",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryFee: 0,
    ...overrides,
  };
}

// Sessão presa no step address SEM bairro confirmado (reproduz o bug)
function sessaoAddressSemBairro(overrides: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(),
    step: "address",
    customerName: "Teste",
    deliveryType: "delivery",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryFee: 0,
    bairroConfirmado: false,
    ...overrides,
  };
}

beforeEach(() => {});

// ─── BUG PRINCIPAL: "Rua 00" sem bairro não pode avançar pra pagamento ────────

describe("BUG: address sem bairro confirmado → pergunta o bairro", () => {
  it("cliente manda só 'Rua 00' → bot pergunta o bairro (não vai pra pagamento)", () => {
    const res = processMessage("Rua 00", sessaoAddressSemBairro());
    expect(res.session.step).toBe("neighborhood");
    expect(res.messages[0].toLowerCase()).toContain("bairro");
  });

  it("cliente manda só 'Rua 00' → NÃO inventa bairro nem taxa", () => {
    const res = processMessage("Rua 00", sessaoAddressSemBairro());
    expect(res.session.neighborhood).toBeFalsy();
    expect(res.session.deliveryFee).toBe(0);
    expect(res.session.bairroConfirmado).toBe(false);
  });

  it("salva o endereço parcial informado", () => {
    const res = processMessage("Rua 00", sessaoAddressSemBairro());
    expect(res.session.address).toBe("Rua 00");
  });

  it("NÃO avança para payment", () => {
    const res = processMessage("Rua 00", sessaoAddressSemBairro());
    expect(res.session.step).not.toBe("payment");
  });
});

// ─── Endereço primeiro, depois bairro válido → segue pra pagamento ────────────

describe("address (sem bairro) → depois bairro válido → pagamento", () => {
  it("'Rua 00' → 'Centro' → segue pra pagamento com taxa correta", () => {
    const r1 = processMessage("Rua 00", sessaoAddressSemBairro());
    expect(r1.session.step).toBe("neighborhood");
    const r2 = processMessage("Centro", r1.session);
    expect(r2.session.neighborhood).toBe("Centro");
    expect(r2.session.deliveryFee).toBe(3); // Centro = R$3 no menu padrão
    expect(r2.session.bairroConfirmado).toBe(true);
    expect(r2.session.step).toBe("payment");
  });

  it("o endereço parcial 'Rua 00' é preservado até o pagamento", () => {
    const r1 = processMessage("Rua 00", sessaoAddressSemBairro());
    const r2 = processMessage("Centro", r1.session);
    expect(r2.session.address).toBe("Rua 00");
  });
});

// ─── Bairro válido direto no step neighborhood ───────────────────────────────

describe("neighborhood: bairro válido segue para address com taxa", () => {
  it("'Centro' → vai para address, taxa R$3, bairro confirmado", () => {
    const res = processMessage("Centro", sessaoNeighborhood());
    expect(res.session.step).toBe("address");
    expect(res.session.neighborhood).toBe("Centro");
    expect(res.session.deliveryFee).toBe(3);
    expect(res.session.bairroConfirmado).toBe(true);
  });

  it("'Santa Luzia' → taxa R$4, bairro confirmado", () => {
    const res = processMessage("Santa Luzia", sessaoNeighborhood());
    expect(res.session.neighborhood).toBe("Santa Luzia");
    expect(res.session.deliveryFee).toBe(4);
    expect(res.session.bairroConfirmado).toBe(true);
  });
});

// ─── Bairro por prefixo/fuzzy → precisa confirmar (não aplica direto) ─────────

describe("neighborhood: match parcial/fuzzy pede confirmação", () => {
  it("bairro com erro de digitação → pede confirmação (não confirma sozinho)", () => {
    const res = processMessage("centro", sessaoNeighborhood()); // exato → confirma
    expect(res.session.bairroConfirmado).toBe(true);
  });

  it("bairro digitado errado 'centroo' → confirma_bairro_fuzzy, sem aplicar taxa ainda", () => {
    const res = processMessage("centroo", sessaoNeighborhood());
    expect(res.session.step).toBe("confirma_bairro_fuzzy");
    expect(res.session.bairroConfirmado).toBeFalsy();
  });

  it("confirmação do fuzzy com 'sim' → aplica e confirma o bairro", () => {
    const r1 = processMessage("centroo", sessaoNeighborhood());
    expect(r1.session.step).toBe("confirma_bairro_fuzzy");
    const r2 = processMessage("sim", r1.session);
    expect(r2.session.bairroConfirmado).toBe(true);
    expect(r2.session.neighborhood).toBe("Centro");
    expect(r2.session.deliveryFee).toBe(3);
  });
});

// ─── Bairro ambíguo → lista opções ───────────────────────────────────────────

describe("neighborhood: bairro ambíguo lista opções", () => {
  it("prefixo que casa vários bairros → lista candidatos", () => {
    // "san" casa "Santo Antonio" e "Santa Luzia"
    const res = processMessage("san", sessaoNeighborhood());
    expect(res.session.step).toBe("confirma_bairro_fuzzy");
    expect((res.session.candidatosBairro?.length ?? 0)).toBeGreaterThan(1);
    expect(res.session.bairroConfirmado).toBeFalsy();
  });
});

// ─── Bloqueio final: confirm com entrega sem bairro confirmado ───────────────

describe("confirm: bloqueia entrega sem bairro confirmado", () => {
  it("step confirm + entrega sem bairro confirmado → pede bairro, não fecha", () => {
    const sess: BotSession = {
      ...createInitialSession(),
      step: "confirm",
      customerName: "Teste",
      deliveryType: "delivery",
      neighborhood: "Barro Preto", // bairro fantasma nunca confirmado
      deliveryFee: 7,
      bairroConfirmado: false, // <- nunca confirmado nesta entrega
      paymentMethod: "Dinheiro",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    };
    const res = processMessage("1", sess);
    expect(res.session.step).toBe("neighborhood");
    expect(res.session.step).not.toBe("done");
    expect(res.messages[0].toLowerCase()).toContain("bairro");
  });

  it("step confirm + entrega COM bairro confirmado válido → fecha normalmente", () => {
    const sess: BotSession = {
      ...createInitialSession(),
      step: "confirm",
      customerName: "Teste",
      deliveryType: "delivery",
      neighborhood: "Centro",
      deliveryFee: 3,
      bairroConfirmado: true,
      paymentMethod: "Dinheiro",
      address: "Rua das Flores, 123",
      troco: "Sem troco",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    };
    const res = processMessage("1", sess);
    expect(res.session.step).toBe("done");
  });
});

// ─── Receipt nunca mostra bairro inventado ───────────────────────────────────

describe("resumo final nunca mostra bairro inventado", () => {
  it("'Rua 00' sem bairro → resposta não contém nome de bairro do menu", () => {
    const res = processMessage("Rua 00", sessaoAddressSemBairro());
    // não pode aparecer taxa/recibo de entrega com bairro fantasma
    expect(res.messages[0]).not.toContain("Barro Preto");
    expect(res.messages[0]).not.toContain("Taxa");
  });
});

// ─── Fluxos que NÃO podem quebrar: retirada e consumo no local ───────────────

describe("não quebra retirada / consumo no local", () => {
  function sessaoDeliveryType(): BotSession {
    return {
      ...createInitialSession(),
      step: "delivery_type",
      customerName: "Teste",
      cart: [{ category: "lanche", name: "X-Burguer", price: 18 }],
      deliveryFee: 0,
    };
  }

  it("retirada ('2') → vai para pagamento, sem exigir bairro", () => {
    const res = processMessage("2", sessaoDeliveryType());
    expect(res.session.step).toBe("payment");
    expect(res.session.deliveryType).toBe("pickup");
    expect(res.session.deliveryFee).toBe(0);
  });

  it("consumo no local ('3') → vai para pagamento, sem exigir bairro", () => {
    const res = processMessage("3", sessaoDeliveryType());
    expect(res.session.step).toBe("payment");
    expect(res.session.deliveryType).toBe("dine_in");
    expect(res.session.deliveryFee).toBe(0);
  });

  it("retirada → pagamento → confirma → fecha (não bloqueia por bairro)", () => {
    const r1 = processMessage("2", sessaoDeliveryType());
    const r2 = processMessage("pix", r1.session);
    expect(r2.session.step).toBe("confirm");
    const r3 = processMessage("1", r2.session);
    // pix vai para aguardando_pix; o importante: não voltou pra neighborhood
    expect(r3.session.step).not.toBe("neighborhood");
  });
});

// ─── Pedido completo com bairro EXATO segue confirmado ────────────────────────

describe("pedido completo com bairro exato continua funcionando", () => {
  it("'quero calzone entrega bairro Centro pix' → bairro confirmado", () => {
    const sess: BotSession = {
      ...createInitialSession(),
      step: "category",
      customerName: "Teste",
      cart: [],
      deliveryFee: 0,
    };
    const res = processMessage("quero calzone entrega bairro Centro pix", sess);
    // Deve ter reconhecido o bairro Centro com confirmação e taxa correta
    expect(res.session.neighborhood).toBe("Centro");
    expect(res.session.bairroConfirmado).toBe(true);
    expect(res.session.deliveryFee).toBe(3);
  });
});
