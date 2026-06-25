import { describe, it, expect } from "vitest";
import { cartItemEsgotado } from "./liveMenu";

describe("cartItemEsgotado", () => {
  it("retorna false quando o item não tem keys", () => {
    expect(cartItemEsgotado(undefined, ["Calabresa"])).toBe(false);
    expect(cartItemEsgotado([], ["Calabresa"])).toBe(false);
  });

  it("retorna false quando nenhum key está esgotado", () => {
    expect(cartItemEsgotado(["Calabresa"], [])).toBe(false);
    expect(cartItemEsgotado(["Calabresa", "Catupiry"], ["Bacon"])).toBe(false);
  });

  it("retorna true quando algum key (sabor ou borda) está esgotado", () => {
    expect(cartItemEsgotado(["Calabresa"], ["Calabresa"])).toBe(true);
    // pizza meio a meio: basta um sabor esgotar
    expect(cartItemEsgotado(["Mussarela", "Calabresa"], ["Calabresa"])).toBe(true);
    // borda esgotada
    expect(cartItemEsgotado(["Mussarela", "Catupiry"], ["Catupiry"])).toBe(true);
  });

  it("item simples (lanche/bebida/suco) usa o próprio nome como key", () => {
    expect(cartItemEsgotado(["X-Burguer"], ["X-Burguer"])).toBe(true);
    expect(cartItemEsgotado(["X-Burguer"], ["Coca"])).toBe(false);
  });
});
