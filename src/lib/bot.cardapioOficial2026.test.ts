import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { createInitialSession, processMessage, setEsgotados, type BotSession } from "./bot";
import { CALZONE_FLAVORS, PIZZA_BORDERS, PIZZA_FLAVORS, SUCOS } from "./catalog/officialMenu2026";

function categoria(): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Auditoria" };
}

beforeEach(() => setEsgotados([]));

describe("bot usa o cardápio comercial oficial 2026", () => {
  it("precifica pizza por sabor e tamanho, não pelo menor preço do tamanho", () => {
    const pizza = processMessage("1", categoria()).session;
    const tamanho = processMessage("3", pizza).session; // G
    const sabor = processMessage("Calabresa Suprema", tamanho).session;
    const resultado = processMessage("não", sabor);

    const esperado = PIZZA_FLAVORS.find((item) => item.name === "Calabresa Suprema")!.pricesBySizeCode.G! / 100;
    expect(resultado.session.cart.at(-1)).toMatchObject({ size: "G", flavor: "Calabresa Suprema", price: esperado });
  });

  it("meio a meio cobra o maior sabor e soma a borda oficial daquele tamanho", () => {
    const session: BotSession = { ...categoria(), step: "flavor", currentCategory: "pizza", currentSize: "G" };
    const sabores = processMessage("Calabresa e Delicia", session).session;
    const resultado = processMessage("Catupiry Original", sabores);
    const maiorSabor = Math.max(
      PIZZA_FLAVORS.find((item) => item.name === "Calabresa")!.pricesBySizeCode.G!,
      PIZZA_FLAVORS.find((item) => item.name === "Delicia")!.pricesBySizeCode.G!,
    );
    const borda = PIZZA_BORDERS.find((item) => item.label === "Catupiry Original")!.pricesBySizeCode.G;

    expect(resultado.session.cart.at(-1)?.price).toBe((maiorSabor + borda) / 100);
  });

  it("Mini aceita sabor tradicional sem borda e rejeita sabor especial", () => {
    const mini: BotSession = { ...categoria(), step: "flavor", currentCategory: "pizza", currentSize: "MINI" };
    const tradicional = processMessage("Calabresa", mini);
    expect(tradicional.session.cart.at(-1)).toMatchObject({ size: "MINI", flavor: "Calabresa", border: "Sem borda", price: 15 });

    const especial = processMessage("Calabresa Suprema", mini);
    expect(especial.session.cart).toHaveLength(0);
    expect(especial.session.step).toBe("flavor");
    expect(especial.messages.join(" ")).toContain("não está disponível no tamanho *MINI*");
  });

  it("Calzone usa o preço próprio do sabor oficial", () => {
    const lanches = processMessage("2", categoria()).session;
    const calzone = processMessage("1", lanches).session;
    const resultado = processMessage("Calabresa", calzone);
    const esperado = CALZONE_FLAVORS.find((item) => item.name === "Calabresa")!.priceCents / 100;

    expect(resultado.session.cart.at(-1)).toMatchObject({ name: "Calzone", flavor: "Calabresa", price: esperado });
  });

  it("Vitamina é produto fechado e não recebe pergunta nem acréscimo de leite", () => {
    const sucos = processMessage("4", categoria()).session;
    const resultado = processMessage(String(SUCOS.length + 1), sucos);

    expect(resultado.session.cart.at(-1)).toMatchObject({ name: "Vitamina de Banana", price: 10 });
    expect(resultado.session.step).toBe("add_more");
    expect(resultado.messages.join(" ")).not.toContain("com leite ou sem leite");
  });
});
