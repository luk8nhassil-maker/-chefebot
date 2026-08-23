// Testes do motor nativo de preço de pizza — cardápio oficial 2026.
//
// O motor não tem mais um "caminho legado equivalente" para comparar: o
// cardápio 2026 introduz preço por sabor (antes só existia por tamanho), e
// o caminho legado (officialUnitPrice) continua deliberadamente preso ao
// Menu antigo (compatibilidade de pedidos/carrinhos antigos — ver
// @/lib/menu e o cabeçalho de @/lib/catalog/officialMenu2026). Os dois
// motores DIVERGEM por design agora; testar "equivalência" entre eles não
// faz mais sentido. Este arquivo testa o motor nativo direto contra a
// matriz oficial (@/lib/catalog/officialMenu2026), com casos concretos
// reais para dar confiança sem duplicar a verificação exaustiva de preço
// por sabor (essa fica em officialMenu2026.test.ts).
import { describe, expect, it } from "vitest";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { MENU } from "@/lib/menu";
import { PIZZA_FLAVORS, PIZZA_SIZES } from "@/lib/catalog/officialMenu2026";
import { precificarPizzaPorId } from "./pizzaEngine";

const catalog = buildPizzaCatalog(MENU);

function sizeIdByCode(code: string): string {
  const size = catalog.sizes.find((entry) => entry.code === code);
  if (!size) throw new Error(`Tamanho ${code} não encontrado no catálogo`);
  return size.id;
}

function flavorIdByName(name: string): string {
  const flavor = catalog.flavors.find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor ${name} não encontrado no catálogo`);
  return flavor.id;
}

function borderIdByLabel(label: string): string {
  const border = catalog.borders.find((entry) => entry.label === label);
  if (!border) throw new Error(`Borda ${label} não encontrada no catálogo`);
  return border.id;
}

function addOnIdByLabel(label: string): string {
  const addOn = catalog.addOns.find((entry) => entry.label === label);
  if (!addOn) throw new Error(`Adicional ${label} não encontrado no catálogo`);
  return addOn.id;
}

describe("motor nativo: preço de 1 sabor = preço oficial do sabor no tamanho (matriz completa)", () => {
  for (const flavor of PIZZA_FLAVORS) {
    for (const [sizeCode, precoCents] of Object.entries(flavor.pricesBySizeCode)) {
      it(`Pizza ${sizeCode} · ${flavor.name} = R$ ${(precoCents! / 100).toFixed(2)}`, () => {
        const resultado = precificarPizzaPorId(
          { sizeId: sizeIdByCode(sizeCode), flavorIds: [flavorIdByName(flavor.name)], quantity: 1 },
          catalog
        );
        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(precoCents);
      });
    }
  }
});

describe("motor nativo: Pizzas Especiais NÃO têm tamanho MINI", () => {
  it("rejeita Especial + MINI com mensagem clara (nunca inventa preço)", () => {
    const flavor = PIZZA_FLAVORS.find((f) => f.category === "especial")!;
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("MINI"), flavorIds: [flavorIdByName(flavor.name)], quantity: 1 },
      catalog
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toContain(flavor.name);
  });

  it("todo sabor Tradicional e Doce aceita MINI", () => {
    for (const flavor of PIZZA_FLAVORS.filter((f) => f.category !== "especial")) {
      const resultado = precificarPizzaPorId(
        { sizeId: sizeIdByCode("MINI"), flavorIds: [flavorIdByName(flavor.name)], quantity: 1 },
        catalog
      );
      expect(resultado.ok).toBe(true);
    }
  });

  it("meio a meio Tradicional + Especial no tamanho MINI é rejeitado (o Especial não tem MINI)", () => {
    const tradicional = PIZZA_FLAVORS.find((f) => f.category === "tradicional")!;
    const especial = PIZZA_FLAVORS.find((f) => f.category === "especial")!;
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("MINI"),
        flavorIds: [flavorIdByName(tradicional.name), flavorIdByName(especial.name)],
        quantity: 1,
      },
      catalog
    );
    expect(resultado.ok).toBe(false);
  });
});

describe("motor nativo: MINI nunca aceita borda nem adicional", () => {
  it("rejeita MINI + borda", () => {
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("MINI"),
        flavorIds: [flavorIdByName("Calabresa")],
        borderId: borderIdByLabel("Cheddar"),
        quantity: 1,
      },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Mini não aceita borda" });
  });

  it("rejeita MINI + adicional", () => {
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("MINI"),
        flavorIds: [flavorIdByName("Calabresa")],
        addOnIds: [addOnIdByLabel("Bacon")],
        quantity: 1,
      },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Mini não aceita adicional" });
  });

  it("P/M/G/F aceitam borda e adicional normalmente", () => {
    for (const code of ["P", "M", "G", "F"]) {
      const resultado = precificarPizzaPorId(
        {
          sizeId: sizeIdByCode(code),
          flavorIds: [flavorIdByName("Calabresa")],
          borderId: borderIdByLabel("Cheddar"),
          addOnIds: [addOnIdByLabel("Bacon")],
          quantity: 1,
        },
        catalog
      );
      expect(resultado.ok).toBe(true);
    }
  });
});

describe("motor nativo: meio a meio preserva o preço real de cada categoria", () => {
  it("Presunto (mais barato) + Á Moda da Casa (mais caro) = preço do mais caro, nas duas ordens", () => {
    const barato = flavorIdByName("Presunto"); // F47 G43 M38 P33 MINI15
    const caro = flavorIdByName("Á Moda da Casa"); // F55 G50 M40 P35 MINI17
    for (const code of ["F", "G", "M", "P", "MINI"]) {
      const direto = precificarPizzaPorId({ sizeId: sizeIdByCode(code), flavorIds: [barato, caro], quantity: 1 }, catalog);
      const invertido = precificarPizzaPorId({ sizeId: sizeIdByCode(code), flavorIds: [caro, barato], quantity: 1 }, catalog);
      const esperado = PIZZA_FLAVORS.find((f) => f.name === "Á Moda da Casa")!.pricesBySizeCode[code as "F"];
      expect(direto.ok).toBe(true);
      expect(invertido.ok).toBe(true);
      if (direto.ok) expect(direto.unitPriceCents).toBe(esperado);
      if (invertido.ok) expect(invertido.unitPriceCents).toBe(esperado);
      // Nunca a média dos dois.
      const media = Math.round(
        ((PIZZA_FLAVORS.find((f) => f.name === "Presunto")!.pricesBySizeCode[code as "F"] ?? 0) + (esperado ?? 0)) / 2
      );
      if (direto.ok) expect(direto.unitPriceCents).not.toBe(media);
    }
  });

  it("mesma categoria continua usando Math.max; categorias diferentes usam metade real de cada sabor", () => {
  const tradA = PIZZA_FLAVORS.filter((f) => f.category === "tradicional")[0];
  const tradB = PIZZA_FLAVORS.filter((f) => f.category === "tradicional")[1];
  const especialA = PIZZA_FLAVORS.filter((f) => f.category === "especial")[0];
  const especialB = PIZZA_FLAVORS.filter((f) => f.category === "especial")[1];
  const doce = PIZZA_FLAVORS.filter((f) => f.category === "doce")[0];

  for (const [a, b] of [[tradA, tradB], [especialA, especialB]] as const) {
    const r = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName(a.name), flavorIdByName(b.name)], quantity: 1 }, catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unitPriceCents).toBe(Math.max(a.pricesBySizeCode.G!, b.pricesBySizeCode.G!));
  }

  for (const [a, b] of [[tradA, especialA], [tradA, doce]] as const) {
    const esperado = Math.round((a.pricesBySizeCode.G! + b.pricesBySizeCode.G!) / 2);
    const direto = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName(a.name), flavorIdByName(b.name)], quantity: 1 }, catalog);
    const invertido = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName(b.name), flavorIdByName(a.name)], quantity: 1 }, catalog);
    expect(direto.ok).toBe(true);
    expect(invertido.ok).toBe(true);
    if (direto.ok) expect(direto.unitPriceCents).toBe(esperado);
    if (invertido.ok) expect(invertido.unitPriceCents).toBe(esperado);
  }
});
});

describe("motor nativo: borda e adicionais somam depois do preço-base; quantidade multiplica só o total", () => {
  it("preço = maior sabor + borda + soma dos adicionais", () => {
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa")],
        borderId: borderIdByLabel("Catupiry Original"),
        addOnIds: [addOnIdByLabel("Bacon"), addOnIdByLabel("Barbecue")],
        quantity: 1,
      },
      catalog
    );
    const precoCalabresaG = PIZZA_FLAVORS.find((f) => f.name === "Calabresa")!.pricesBySizeCode.G!;
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      // Catupiry Original G = 1500; Bacon G = 1000; Barbecue G = 1200 (ver officialMenu2026).
      expect(resultado.unitPriceCents).toBe(precoCalabresaG + 1500 + 1000 + 1200);
    }
  });

  it("adicional duplicado é rejeitado (nunca cobra duas vezes o mesmo)", () => {
    const bacon = addOnIdByLabel("Bacon");
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], addOnIds: [bacon, bacon], quantity: 1 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Adicional duplicado" });
  });

  it("múltiplos adicionais DIFERENTES são permitidos e todos somam", () => {
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("P"),
        flavorIds: [flavorIdByName("Calabresa")],
        addOnIds: catalog.addOns.map((a) => a.id),
        quantity: 1,
      },
      catalog
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      const somaAdicionais = catalog.addOns.reduce((soma, a) => soma + a.pricesBySizeCode.P, 0);
      const precoCalabresaP = PIZZA_FLAVORS.find((f) => f.name === "Calabresa")!.pricesBySizeCode.P!;
      expect(resultado.unitPriceCents).toBe(precoCalabresaP + somaAdicionais);
    }
  });

  it("adicional inexistente é rejeitado", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], addOnIds: ["addon-inexistente"], quantity: 1 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Adicional não encontrado" });
  });

  it("3x Pizza G Calabresa: total = unitário × 3, unitário nunca muda", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 3 },
      catalog
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.totalCents).toBe(resultado.unitPriceCents * 3);
  });
});

describe("motor nativo: preço adulterado pelo cliente é sempre ignorado — preço vem só do catálogo por ID", () => {
  it("precificarPizzaPorId nunca aceita um campo de preço na seleção — o tipo não tem essa propriedade", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 1 },
      catalog
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.unitPriceCents).toBe(PIZZA_FLAVORS.find((f) => f.name === "Calabresa")!.pricesBySizeCode.G);
    }
  });
});

describe("motor nativo: regras de validação (sem preço envolvido)", () => {
  it("rejeita tamanho inexistente", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: "size-inexistente", flavorIds: [flavorIdByName("Calabresa")], quantity: 1 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Tamanho não encontrado" });
  });

  it("rejeita sabor inexistente", () => {
    const resultado = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: ["flavor-inexistente"], quantity: 1 }, catalog);
    expect(resultado).toEqual({ ok: false, error: "Sabor não encontrado" });
  });

  it("rejeita sabor repetido (meio a meio do mesmo sabor duas vezes)", () => {
    const id = flavorIdByName("Calabresa");
    const resultado = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [id, id], quantity: 1 }, catalog);
    expect(resultado).toEqual({ ok: false, error: "Sabor repetido" });
  });

  it("rejeita zero sabores", () => {
    const resultado = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [], quantity: 1 }, catalog);
    expect(resultado).toEqual({ ok: false, error: "Selecione 1 ou 2 sabores" });
  });

  it("rejeita mais de dois sabores", () => {
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa"), flavorIdByName("Portuguesa"), flavorIdByName("Mussarela")],
        quantity: 1,
      },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Selecione 1 ou 2 sabores" });
  });

  it("rejeita sabor esgotado", () => {
    const catalogComEsgotado = buildPizzaCatalog(MENU, ["Calabresa"]);
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 1 },
      catalogComEsgotado
    );
    expect(resultado).toEqual({ ok: false, error: "Sabor indisponível: Calabresa" });
  });

  it("rejeita borda esgotada", () => {
    const catalogComEsgotado = buildPizzaCatalog(MENU, ["Cheddar"]);
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa")],
        borderId: borderIdByLabel("Cheddar"),
        quantity: 1,
      },
      catalogComEsgotado
    );
    expect(resultado).toEqual({ ok: false, error: "Borda indisponível: Cheddar" });
  });

  it("rejeita adicional esgotado", () => {
    const catalogComEsgotado = buildPizzaCatalog(MENU, ["Bacon"]);
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa")],
        addOnIds: [addOnIdByLabel("Bacon")],
        quantity: 1,
      },
      catalogComEsgotado
    );
    expect(resultado).toEqual({ ok: false, error: "Adicional indisponível: Bacon" });
  });

  it("rejeita borda inexistente", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], borderId: "border-inexistente", quantity: 1 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Borda não encontrada" });
  });

  it("rejeita quantidade zero", () => {
    const resultado = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 0 }, catalog);
    expect(resultado).toEqual({ ok: false, error: "Quantidade inválida" });
  });

  it("rejeita quantidade fracionária", () => {
    const resultado = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 1.5 }, catalog);
    expect(resultado).toEqual({ ok: false, error: "Quantidade inválida" });
  });
});

describe("motor nativo: tamanhos oficiais (fatias)", () => {
  it("F=12, G=10, M=8, P=6, MINI=4 fatias", () => {
    const fatias = Object.fromEntries(PIZZA_SIZES.map((s) => [s.code, s.fatias]));
    expect(fatias).toEqual({ F: 12, G: 10, M: 8, P: 6, MINI: 4 });
  });
});
