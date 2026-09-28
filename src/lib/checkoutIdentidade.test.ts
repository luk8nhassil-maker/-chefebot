import { describe, expect, test } from "vitest";
import { resolverIdentidadeCheckout } from "./checkoutIdentidade";

describe("resolverIdentidadeCheckout", () => {
  test("nome sozinho é válido", () => {
    expect(resolverIdentidadeCheckout({ nome: "  Maria  " })).toEqual({
      nome: "Maria",
      apelido: "",
      exibicao: "Maria",
      valida: true,
    });
  });

  test("apelido sozinho é válido", () => {
    expect(resolverIdentidadeCheckout({ apelido: "  Mah  " })).toEqual({
      nome: "",
      apelido: "Mah",
      exibicao: "Mah",
      valida: true,
    });
  });

  test("com ambos preenchidos, nome continua como identificação principal", () => {
    const r = resolverIdentidadeCheckout({ nome: "Maria Silva", apelido: "Mah" });
    expect(r.valida).toBe(true);
    expect(r.exibicao).toBe("Maria Silva");
  });

  test("sem nome e sem apelido é inválido na UI nova", () => {
    expect(resolverIdentidadeCheckout({ nome: " ", apelido: "" }).valida).toBe(false);
  });

  test("clienteLegado mantém compatibilidade de payload antigo sem liberar regra nova", () => {
    const r = resolverIdentidadeCheckout({ clienteLegado: "Cliente Antigo" });
    expect(r.valida).toBe(false);
    expect(r.exibicao).toBe("Cliente Antigo");
  });
});
