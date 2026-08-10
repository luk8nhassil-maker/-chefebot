// Matriz completa do cardápio oficial 2026 — CARDAPIO_CHEFE.pdf.
//
// Cada valor abaixo foi transcrito de forma INDEPENDENTE (não copiado do
// próprio officialMenu2026.ts) a partir da conferência texto+imagem das 12
// páginas do PDF. Este arquivo é a prova de que a fonte de dados bate com o
// PDF, item por item — se alguém alterar um preço em officialMenu2026.ts
// sem alterar aqui (ou vice-versa) por engano, o teste denuncia a
// divergência.
import { describe, expect, it } from "vitest";
import {
  BEBIDAS,
  CALZONE_FLAVORS,
  HAMBURGUERES,
  LANCHES_FIXOS,
  MACARRONADAS,
  MACARRONADA_ADICIONAL_GRUPO,
  PASTEL_FEIRA_PRICE_CENTS,
  PASTEL_FEIRA_RECHEIOS,
  PASTEL_FORNO_FLAVORS,
  PASTEL_FORNO_PRICE_CENTS,
  PIZZA_ADDONS,
  PIZZA_BORDERS,
  PIZZA_FLAVORS_DOCES,
  PIZZA_FLAVORS_ESPECIAIS,
  PIZZA_FLAVORS_TRADICIONAIS,
  SUCOS,
  VITAMINAS,
  ACRESCIMO_LEITE_CENTS,
} from "./officialMenu2026";

function porNome<T extends { name: string }>(lista: T[], nome: string): T {
  const item = lista.find((entry) => entry.name === nome);
  if (!item) throw new Error(`"${nome}" não encontrado na lista oficial`);
  return item;
}

describe("Pizzas Tradicionais — 18 sabores, com MINI", () => {
  it("tem exatamente 18 sabores", () => {
    expect(PIZZA_FLAVORS_TRADICIONAIS).toHaveLength(18);
  });

  const tabela: [string, number, number, number, number, number][] = [
    // nome, F, G, M, P, MINI (reais)
    ["Á Moda da Casa", 55, 50, 40, 35, 17],
    ["Baiana", 55, 50, 40, 35, 17],
    ["Frango com Chedder", 55, 50, 40, 35, 17],
    ["Milho", 50, 40, 35, 30, 12],
    ["Peruana", 55, 50, 40, 35, 17],
    ["Calabresa", 50, 45, 38, 33, 15],
    ["Frango", 50, 45, 38, 33, 15],
    ["Mussarela", 50, 45, 38, 33, 15],
    ["Bacon", 50, 45, 38, 33, 15],
    ["3 Queijos", 50, 45, 38, 33, 15],
    ["Napolitana", 50, 45, 38, 33, 15],
    ["Presunto", 47, 43, 38, 33, 15],
    ["Xuxa", 48, 43, 35, 30, 13],
    ["4 Queijos", 55, 50, 40, 35, 17],
    ["Siciliana", 55, 50, 40, 35, 17],
    ["Caramussa", 55, 50, 40, 35, 17],
    ["Toscana", 55, 50, 40, 35, 17],
    ["Frango com Requeijão", 55, 50, 40, 35, 17],
  ];

  for (const [nome, f, g, m, p, mini] of tabela) {
    it(`${nome}: F=${f} G=${g} M=${m} P=${p} MINI=${mini}`, () => {
      const flavor = porNome(PIZZA_FLAVORS_TRADICIONAIS, nome);
      expect(flavor.category).toBe("tradicional");
      expect(flavor.pricesBySizeCode).toEqual({
        F: f * 100,
        G: g * 100,
        M: m * 100,
        P: p * 100,
        MINI: mini * 100,
      });
    });
  }
});

describe("Pizzas Especiais — 20 sabores, SEM MINI", () => {
  it("tem exatamente 20 sabores", () => {
    expect(PIZZA_FLAVORS_ESPECIAIS).toHaveLength(20);
  });

  it("nenhum sabor Especial tem preço MINI", () => {
    for (const flavor of PIZZA_FLAVORS_ESPECIAIS) {
      expect(flavor.pricesBySizeCode.MINI).toBeUndefined();
    }
  });

  const tabela: [string, number, number, number, number][] = [
    // nome, F, G, M, P (reais)
    ["Calabresa Suprema", 70, 62, 55, 42],
    ["Frango Catupiry Original", 70, 62, 55, 42],
    ["6 Queijos", 65, 55, 50, 40],
    ["Nordestina", 60, 55, 45, 38],
    ["Mexicana", 60, 55, 43, 38],
    ["Portuguesa", 60, 53, 43, 38],
    ["Carne Seca Especial", 70, 62, 55, 42],
    ["Mazini", 60, 55, 45, 38],
    ["Carne Seca", 60, 55, 45, 40],
    ["Atum", 60, 55, 45, 40],
    ["5 Queijos", 60, 55, 45, 40],
    ["Caipira", 60, 55, 45, 40],
    ["Peper Cheddar", 60, 55, 45, 40],
    ["Delicia", 65, 58, 50, 45],
    ["Pizza do Chefe", 65, 55, 45, 40],
    ["Calabresa com Barbecue", 60, 55, 45, 40],
    ["Calabresa Especial", 60, 52, 43, 38],
    ["Calabresa Suprema 2", 70, 62, 55, 42],
    ["Carne de Sol da Casa", 70, 62, 55, 42],
    ["Carne de Sol Especial da Casa", 70, 62, 55, 42],
  ];

  for (const [nome, f, g, m, p] of tabela) {
    it(`${nome}: F=${f} G=${g} M=${m} P=${p}`, () => {
      const flavor = porNome(PIZZA_FLAVORS_ESPECIAIS, nome);
      expect(flavor.category).toBe("especial");
      expect(flavor.pricesBySizeCode).toEqual({ F: f * 100, G: g * 100, M: m * 100, P: p * 100 });
    });
  }

  it("Calabresa Suprema e Calabresa Suprema 2 são sabores DISTINTOS (nunca duplicata)", () => {
    const a = porNome(PIZZA_FLAVORS_ESPECIAIS, "Calabresa Suprema");
    const b = porNome(PIZZA_FLAVORS_ESPECIAIS, "Calabresa Suprema 2");
    expect(a.id).not.toBe(b.id);
    expect(a.ingredients).not.toBe(b.ingredients);
  });
});

describe("Pizzas Doces — 7 sabores, com MINI", () => {
  it("tem exatamente 7 sabores", () => {
    expect(PIZZA_FLAVORS_DOCES).toHaveLength(7);
  });

  const tabela: [string, number, number, number, number, number][] = [
    ["Chocolate", 55, 50, 40, 35, 17],
    ["Choconinho", 60, 55, 45, 40, 20],
    ["M&M", 55, 50, 40, 35, 17],
    ["Dois Amores", 60, 55, 45, 40, 20],
    ["Sensação", 55, 50, 40, 35, 17],
    ["Romeu e Julieta", 55, 50, 40, 35, 17],
    ["Cartola", 55, 50, 40, 35, 17],
  ];

  for (const [nome, f, g, m, p, mini] of tabela) {
    it(`${nome}: F=${f} G=${g} M=${m} P=${p} MINI=${mini}`, () => {
      const flavor = porNome(PIZZA_FLAVORS_DOCES, nome);
      expect(flavor.category).toBe("doce");
      expect(flavor.pricesBySizeCode).toEqual({ F: f * 100, G: g * 100, M: m * 100, P: p * 100, MINI: mini * 100 });
    });
  }
});

describe("Adicionais de pizza — P/M/G/F (nunca MINI)", () => {
  it("tem exatamente 8 adicionais", () => {
    expect(PIZZA_ADDONS).toHaveLength(8);
  });

  const tabela: [string, number, number, number, number][] = [
    // label, P, M, G, F (reais)
    ["Requeijão Cremoso", 5, 5, 5, 7],
    ["Cheddar Cremoso", 5, 5, 5, 7],
    ["Geléia de Pimenta", 6, 7, 10, 15],
    ["Catupiry (Original)", 8, 10, 12, 15],
    ["Cream Cheese", 8, 10, 12, 15],
    ["Bacon", 6, 8, 10, 12],
    ["Calabresa", 5, 7, 9, 12],
    ["Barbecue", 8, 10, 12, 15],
  ];

  for (const [label, p, m, g, f] of tabela) {
    it(`${label}: P=${p} M=${m} G=${g} F=${f}`, () => {
      const addOn = porNome(PIZZA_ADDONS.map((a) => ({ ...a, name: a.label })), label);
      expect(addOn.pricesBySizeCode).toEqual({ P: p * 100, M: m * 100, G: g * 100, F: f * 100 });
    });
  }
});

describe("Bordas de pizza — P/M/G/F (nunca MINI), preço igual em todos os tamanhos", () => {
  it("tem exatamente 4 bordas", () => {
    expect(PIZZA_BORDERS).toHaveLength(4);
  });

  const tabela: [string, number][] = [
    ["Requeijão Cremoso", 10],
    ["Catupiry Original", 15],
    ["Cream Cheese", 15],
    ["Cheddar", 10],
  ];

  for (const [label, preco] of tabela) {
    it(`${label}: R$ ${preco},00 em todos os tamanhos`, () => {
      const border = porNome(PIZZA_BORDERS.map((b) => ({ ...b, name: b.label })), label);
      expect(border.pricesBySizeCode).toEqual({ P: preco * 100, M: preco * 100, G: preco * 100, F: preco * 100 });
    });
  }
});

describe("Calzone — 12 sabores, preço PRÓPRIO por sabor", () => {
  it("tem exatamente 12 sabores", () => {
    expect(CALZONE_FLAVORS).toHaveLength(12);
  });

  const tabela: [string, number][] = [
    ["Carne Seca", 40],
    ["Frango", 30],
    ["Frango com Requeijão", 35],
    ["Calabresa", 30],
    ["Calabresa com Requeijão", 32],
    ["Portuguesa", 35],
    ["Baiana", 30],
    ["Mexicana", 35],
    ["Mazine", 35],
    ["3 Queijos", 28],
    ["A Moda", 35],
    ["Delicia", 35],
  ];

  for (const [nome, preco] of tabela) {
    it(`${nome}: R$ ${preco},00`, () => {
      const sabor = porNome(CALZONE_FLAVORS, nome);
      expect(sabor.priceCents).toBe(preco * 100);
    });
  }

  it("sabores com ingredientes idênticos a um sabor de pizza reaproveitam o mesmo flavorId", () => {
    expect(porNome(CALZONE_FLAVORS, "Mazine").flavorId).toBe("flavor-mazini");
    expect(porNome(CALZONE_FLAVORS, "A Moda").flavorId).toBe("flavor-a-moda-da-casa");
    expect(porNome(CALZONE_FLAVORS, "Delicia").flavorId).toBe("flavor-delicia");
    expect(porNome(CALZONE_FLAVORS, "Carne Seca").flavorId).toBe("flavor-carne-seca");
    expect(porNome(CALZONE_FLAVORS, "Calabresa").flavorId).toBe("flavor-calabresa");
  });

  it("Calabresa com Requeijão NÃO tem sabor de pizza equivalente — flavorId próprio", () => {
    const sabor = porNome(CALZONE_FLAVORS, "Calabresa com Requeijão");
    expect(sabor.flavorId).toBe("flavor-calabresa-com-requeijao");
  });
});

describe("Pastel de Forno — 12 sabores (mesmos do Calzone), todos R$25,00", () => {
  it("tem exatamente 12 sabores, todos a R$25,00", () => {
    expect(PASTEL_FORNO_FLAVORS).toHaveLength(12);
    expect(PASTEL_FORNO_PRICE_CENTS).toBe(2500);
    for (const sabor of PASTEL_FORNO_FLAVORS) expect(sabor.priceCents).toBe(2500);
  });

  it("os mesmos 12 nomes do Calzone", () => {
    const nomesCalzone = CALZONE_FLAVORS.map((f) => f.name).sort();
    const nomesPastel = PASTEL_FORNO_FLAVORS.map((f) => f.name).sort();
    expect(nomesPastel).toEqual(nomesCalzone);
  });
});

describe("Pastel de Feira — R$8,00, exige exatamente 1 dos 6 recheios", () => {
  it("6 recheios, R$8,00", () => {
    expect(PASTEL_FEIRA_RECHEIOS).toHaveLength(6);
    expect(PASTEL_FEIRA_PRICE_CENTS).toBe(800);
  });

  it("recheios exatamente conforme o PDF", () => {
    expect(PASTEL_FEIRA_RECHEIOS.map((r) => r.name).sort()).toEqual(
      ["Frango", "Frango com Catupiri", "Queijo", "Calabresa", "Carne seca", "Queijo com Presunto"].sort()
    );
  });
});

describe("Hambúrguer — exatamente 5 itens", () => {
  it("X-Burguer, X-Bacon, X-Tudo, X-Calabresa, X-Salada", () => {
    expect(HAMBURGUERES).toHaveLength(5);
    expect(HAMBURGUERES.map((h) => h.name).sort()).toEqual(
      ["X-Burguer", "X-Bacon", "X-Tudo", "X-Calabresa", "X-Salada"].sort()
    );
  });

  const tabela: [string, number][] = [
    ["X-Burguer", 17],
    ["X-Bacon", 20],
    ["X-Tudo", 25],
    ["X-Calabresa", 20],
    ["X-Salada", 15],
  ];
  for (const [nome, preco] of tabela) {
    it(`${nome}: R$ ${preco},00`, () => {
      expect(porNome(HAMBURGUERES, nome).priceCents).toBe(preco * 100);
    });
  }
});

describe("Lanches fixos", () => {
  const tabela: [string, number][] = [
    ["Porção de Batatas", 12],
    ["Coxinha de Frango", 8],
    ["Coxinha de Frango c/ Catupiry", 7],
    ["Pastel de Carne Seca", 12],
  ];
  for (const [nome, preco] of tabela) {
    it(`${nome}: R$ ${preco},00`, () => {
      expect(porNome(LANCHES_FIXOS, nome).priceCents).toBe(preco * 100);
    });
  }
});

describe("Macarronada — G/M/P/PP", () => {
  it("tem exatamente 2 produtos", () => {
    expect(MACARRONADAS).toHaveLength(2);
  });

  it("Macarronada de Carne: G=50 M=40 P=28 PP=15", () => {
    const produto = porNome(MACARRONADAS, "Macarronada de Carne");
    expect(produto.pricesBySizeCode).toEqual({ G: 5000, M: 4000, P: 2800, PP: 1500 });
  });

  it("Macarronada de Frango: G=55 M=43 P=30 PP=17", () => {
    const produto = porNome(MACARRONADAS, "Macarronada de Frango");
    expect(produto.pricesBySizeCode).toEqual({ G: 5500, M: 4300, P: 3000, PP: 1700 });
  });

  it("adicional opcional: Bacon OU Ovos, R$10,00 cada, no máximo 1", () => {
    expect(MACARRONADA_ADICIONAL_GRUPO.max).toBe(1);
    expect(MACARRONADA_ADICIONAL_GRUPO.options).toHaveLength(2);
    for (const opcao of MACARRONADA_ADICIONAL_GRUPO.options) {
      expect(["Bacon", "Ovos"]).toContain(opcao.label);
      expect(opcao.priceCents).toBe(1000);
    }
  });
});

describe("Sucos — 11 sabores + acréscimo único de leite", () => {
  it("tem exatamente 11 sabores", () => {
    expect(SUCOS).toHaveLength(11);
  });

  it("acréscimo com leite = R$1,00", () => {
    expect(ACRESCIMO_LEITE_CENTS).toBe(100);
  });

  const tabela: [string, number][] = [
    ["Cajá", 8],
    ["Cajú", 7],
    ["Acerola", 7],
    ["Goiaba", 7],
    ["Bacuri", 10],
    ["Cupuaçú", 9],
    ["Laranja", 10],
    ["Maracujá", 10],
    ["Graviola", 9],
    ["Abacaxi", 8],
    ["Abacaxi c/ Hortelã", 9],
  ];
  for (const [nome, preco] of tabela) {
    it(`${nome}: R$ ${preco},00 (base, sem leite)`, () => {
      expect(porNome(SUCOS, nome).priceCents).toBe(preco * 100);
    });
  }
});

describe("Vitaminas — categoria própria, sem herdar regra do leite", () => {
  it("Vitamina de Banana: R$10,00", () => {
    expect(VITAMINAS).toHaveLength(1);
    expect(porNome(VITAMINAS, "Vitamina de Banana").priceCents).toBe(1000);
  });
});

describe("Bebidas — exatamente as do PDF (23 itens)", () => {
  it("tem exatamente 23 itens", () => {
    expect(BEBIDAS).toHaveLength(23);
  });

  const tabela: [string, number][] = [
    ["Guaraná 1L", 9],
    ["Guaraná 1,5L", 11],
    ["Guaraná 2L", 13],
    ["Guaraná Lata", 6],
    ["Guaraná Zero Lata", 6],
    ["Guaraná Zero 1L", 9],
    ["Guaraná Zero 2L", 13],
    ["Pepsi Lata", 5],
    ["Coca-Cola 1L", 11],
    ["Jesus 1L", 11],
    ["Fanta Laranja 1L", 11],
    ["Kuat 1L", 11],
    ["Coca-Cola 2L", 15],
    ["Jesus 2L", 15],
    ["Fanta Laranja 2L", 15],
    ["Fanta Uva 2L", 15],
    ["Kuat 2L", 15],
    ["Refrigerante 1,5L", 13],
    ["Refrigerante Lata", 6],
    ["Refrigerante Retornável", 10],
    ["Água sem Gás", 3],
    ["Água com Gás", 4],
    ["Cerveja Long Neck", 10],
  ];

  for (const [nome, preco] of tabela) {
    it(`${nome}: R$ ${preco.toFixed(2).replace(".", ",")}`, () => {
      expect(porNome(BEBIDAS, nome).priceCents).toBe(Math.round(preco * 100));
    });
  }
});

describe("Todos os preços em centavos inteiros (nunca fração de centavo)", () => {
  it("nenhum preço em nenhuma lista é NaN ou não-inteiro", () => {
    const todosOsCents: number[] = [
      ...PIZZA_FLAVORS_TRADICIONAIS.flatMap((f) => Object.values(f.pricesBySizeCode)),
      ...PIZZA_FLAVORS_ESPECIAIS.flatMap((f) => Object.values(f.pricesBySizeCode)),
      ...PIZZA_FLAVORS_DOCES.flatMap((f) => Object.values(f.pricesBySizeCode)),
      ...PIZZA_ADDONS.flatMap((a) => Object.values(a.pricesBySizeCode)),
      ...PIZZA_BORDERS.flatMap((b) => Object.values(b.pricesBySizeCode)),
      ...CALZONE_FLAVORS.map((f) => f.priceCents),
      ...PASTEL_FORNO_FLAVORS.map((f) => f.priceCents),
      PASTEL_FEIRA_PRICE_CENTS,
      ...HAMBURGUERES.map((h) => h.priceCents),
      ...LANCHES_FIXOS.map((l) => l.priceCents),
      ...MACARRONADAS.flatMap((m) => Object.values(m.pricesBySizeCode)),
      ...MACARRONADA_ADICIONAL_GRUPO.options.map((o) => o.priceCents),
      ...SUCOS.map((s) => s.priceCents),
      ...VITAMINAS.map((v) => v.priceCents),
      ...BEBIDAS.map((b) => b.priceCents),
      ACRESCIMO_LEITE_CENTS,
    ] as number[];
    for (const cents of todosOsCents) {
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThan(0);
    }
  });
});
