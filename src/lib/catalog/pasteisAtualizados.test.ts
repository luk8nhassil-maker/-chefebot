import { describe, expect, it } from "vitest";
import { PASTEL_CARNE_SECA_ATUAL, PASTEL_FEIRA_ATUAL } from "./pasteisAtualizados";

describe("pastéis atualizados — 19/08/2026", () => {
  it("Pastel de Carne Seca custa R$12 e preserva os ingredientes aprovados", () => {
    expect(PASTEL_CARNE_SECA_ATUAL).toMatchObject({
      id: "lanche-pastel-de-carne-seca",
      name: "Pastel de Carne Seca",
      priceCents: 1200,
      ingredients: "Carne de sol, Catupiry, queijo mussarela e orégano.",
    });
  });

  it("Pastel de Feira custa R$8 e tem exatamente os seis recheios aprovados", () => {
    expect(PASTEL_FEIRA_ATUAL.priceCents).toBe(800);
    expect(PASTEL_FEIRA_ATUAL.recheios.map((r) => r.name)).toEqual([
      "Carne",
      "Frango",
      "Frango com Catupiri",
      "Queijo",
      "Calabresa",
      "Queijo com Presunto",
    ]);
  });

  it("recheio Carne não herda a receita antiga de carne seca", () => {
    const carne = PASTEL_FEIRA_ATUAL.recheios.find((r) => r.name === "Carne");
    expect(carne).toMatchObject({
      id: "pastel-feira-carne",
      ingredients: "Carne moída, milho e ervilha.",
    });
  });
});
