import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, setEsgotados, type BotSession } from "./bot";

function sessaoConfirm(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "confirm",
    cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 }],
    deliveryFee: 0,
    deliveryType: "dine_in",
    customerName: "Teste",
    ...overrides,
  };
}

beforeEach(() => {
  setEsgotados([]);
});

describe("isEsgotado — normalização por acento (Fase 8)", () => {
  it("marcar 'Açaí' como esgotado bloqueia mesmo se o item no carrinho está sem acento", () => {
    setEsgotados(["Açaí"]);
    const session = sessaoConfirm({
      cart: [{ category: "suco", name: "Acai", price: 10 }],
    });
    const res = processMessage("confirmar", session);
    // Item esgotado (mesmo nome, grafias diferentes) é removido — pedido não confirma direto.
    expect(res.session.step).not.toBe("done");
  });
});

describe("Revalidação de disponibilidade na confirmação final (Fase 8)", () => {
  it("item que esgotou depois de ser adicionado ao carrinho é removido antes de confirmar (carrinho fica vazio, não confirma)", () => {
    setEsgotados(["Calabresa"]);
    const res = processMessage("confirmar", sessaoConfirm());
    expect(res.session.step).not.toBe("done");
    expect((res.session.cart ?? []).length).toBe(0);
    expect(res.messages[0]).toContain("esgotou");
  });

  it("carrinho ficando vazio após remoção volta para a seleção de categoria, não confirma pedido vazio", () => {
    setEsgotados(["Calabresa"]);
    const res = processMessage("confirmar", sessaoConfirm());
    expect(res.session.step).toBe("category");
    expect(res.session.cart).toEqual([]);
  });

  it("carrinho com item ainda disponível junto de um esgotado: remove só o esgotado e mantém o resto para reconfirmar", () => {
    setEsgotados(["Calabresa"]);
    const session = sessaoConfirm({
      cart: [
        { category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 },
        { category: "bebida", name: "Coca-Cola", price: 8 },
      ],
    });
    const res = processMessage("confirmar", session);
    expect(res.session.step).toBe("confirm");
    expect(res.session.cart?.length).toBe(1);
    expect(res.session.cart?.[0].name).toBe("Coca-Cola");
  });

  it("nenhum item esgotado: confirma normalmente (comportamento inalterado)", () => {
    setEsgotados([]);
    const res = processMessage("confirmar", sessaoConfirm());
    expect(res.session.step).toBe("done");
  });

  it("borda esgotada também é revalidada na confirmação", () => {
    setEsgotados(["Catupiry"]);
    const session = sessaoConfirm({
      cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Marguerita", border: "Catupiry", price: 45 }],
    });
    const res = processMessage("confirmar", session);
    expect(res.session.step).toBe("category");
  });
});
