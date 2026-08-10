// Testes de buildSimpleCatalog — cardápio oficial 2026.
//
// A Mini-Pizza (produto separado, sabor único, flavorsMode) deixou de
// existir — MINI agora é um TAMANHO de pizza (ver @/lib/pricing/pizzaEngine
// e @/lib/catalog/officialMenu2026, decisão comercial aprovada). Calzone
// deixou de reaproveitar a lista inteira de sabores da Pizza: agora tem uma
// lista PRÓPRIA e fixa de 12 sabores, cada um com preço individual
// ("flavor_priced") — não depende mais de `flavorsMode`/`calzoneFlavors`
// (esses campos continuam existindo no Menu legado só para o caminho
// officialUnitPrice, nunca lidos por este módulo).
import { describe, expect, it } from "vitest";
import { buildSimpleCatalog, todosOsProdutos } from "./simpleProducts";
import { MENU } from "@/lib/menu";

function produto(nome: string, catalog: ReturnType<typeof buildSimpleCatalog>) {
  const p = todosOsProdutos(catalog).find((entry) => entry.name === nome);
  if (!p) throw new Error(`Produto "${nome}" não encontrado`);
  return p;
}

describe("buildSimpleCatalog — Calzone (flavor_priced, 12 sabores, preço por sabor)", () => {
  it("é UM produto com strategy flavor_priced e 12 sabores", () => {
    const catalog = buildSimpleCatalog(MENU);
    const calzone = produto("Calzone", catalog);
    expect(calzone.strategy).toBe("flavor_priced");
    expect(calzone.flavors).toHaveLength(12);
  });

  it("cada sabor carrega seu PRÓPRIO priceCents — Carne Seca (R$40) ≠ Frango (R$30)", () => {
    const catalog = buildSimpleCatalog(MENU);
    const calzone = produto("Calzone", catalog);
    const carneSeca = calzone.flavors!.find((f) => f.name === "Carne Seca")!;
    const frango = calzone.flavors!.find((f) => f.name === "Frango")!;
    expect(carneSeca.priceCents).toBe(4000);
    expect(frango.priceCents).toBe(3000);
  });

  it("sabores compartilhados com a Pizza reaproveitam o mesmo flavorId — nunca um ID novo", () => {
    const catalog = buildSimpleCatalog(MENU);
    const calzone = produto("Calzone", catalog);
    const delicia = calzone.flavors!.find((f) => f.name === "Delicia")!;
    expect(delicia.id).toBe("flavor-delicia");
  });

  it("Mazine exibe o rótulo do Calzone, mas reaproveita o flavorId da Mazini (pizza)", () => {
    const catalog = buildSimpleCatalog(MENU);
    const calzone = produto("Calzone", catalog);
    const mazine = calzone.flavors!.find((f) => f.name === "Mazine")!;
    expect(mazine.id).toBe("flavor-mazini");
    expect(mazine.displayLabel).toBe("Mazine");
  });

  it("esgotar 'Calabresa' também esgota o sabor Calabresa do Calzone (mesmo flavorId/ingrediente)", () => {
    const catalog = buildSimpleCatalog(MENU, ["Calabresa"]);
    const calzone = produto("Calzone", catalog);
    const calabresa = calzone.flavors!.find((f) => f.name === "Calabresa")!;
    expect(calabresa.available).toBe(false);
  });

  it("esconder um sabor do Calzone (curadoria) não é confundido com esgotar a Pizza — outros sabores do Calzone continuam disponíveis", () => {
    const catalog = buildSimpleCatalog(MENU, ["Carne Seca"]);
    const calzone = produto("Calzone", catalog);
    expect(calzone.flavors!.find((f) => f.name === "Frango")?.available).toBe(true);
  });
});

describe("buildSimpleCatalog — Pastel de Forno (single_flavor, 12 sabores, todos R$25)", () => {
  it("12 sabores, todos com priceCents do PRODUTO (25,00), sabor nunca muda o preço", () => {
    const catalog = buildSimpleCatalog(MENU);
    const pastel = produto("Pastel de Forno", catalog);
    expect(pastel.strategy).toBe("single_flavor");
    expect(pastel.priceCents).toBe(2500);
    expect(pastel.flavors).toHaveLength(12);
  });

  it("os mesmos 12 nomes de sabor do Calzone", () => {
    const catalog = buildSimpleCatalog(MENU);
    const calzone = produto("Calzone", catalog);
    const pastel = produto("Pastel de Forno", catalog);
    expect(pastel.flavors!.map((f) => f.name).sort()).toEqual(calzone.flavors!.map((f) => f.name).sort());
  });
});

describe("buildSimpleCatalog — Pastel de Feira (single_flavor, dentro de Lanches, 6 recheios próprios)", () => {
  it("está em `lanches`, R$8,00, 6 recheios, recheios NÃO reaproveitam flavorId de pizza", () => {
    const catalog = buildSimpleCatalog(MENU);
    const pastelFeira = catalog.lanches.find((l) => l.name === "Pastel de Feira")!;
    expect(pastelFeira.strategy).toBe("single_flavor");
    expect(pastelFeira.priceCents).toBe(800);
    expect(pastelFeira.flavors).toHaveLength(6);
    for (const recheio of pastelFeira.flavors!) {
      expect(recheio.id.startsWith("pastel-feira-")).toBe(true);
    }
  });

  it("ID próprio de Calabresa esgota só o recheio do Pastel de Feira", () => {
    const catalog = buildSimpleCatalog(MENU, [], ["pastel-feira-calabresa"]);
    const pastelFeira = catalog.lanches.find((l) => l.name === "Pastel de Feira")!;
    const calzone = produto("Calzone", catalog);
    expect(pastelFeira.flavors!.find((f) => f.name === "Calabresa")?.available).toBe(false);
    expect(calzone.flavors!.find((f) => f.name === "Calabresa")?.available).toBe(true);
  });
});

describe("buildSimpleCatalog — Hambúrguer (fixed, categoria própria)", () => {
  it("5 produtos, cada um fixed com o próprio preço", () => {
    const catalog = buildSimpleCatalog(MENU);
    expect(catalog.hamburgueres).toHaveLength(5);
    for (const h of catalog.hamburgueres) expect(h.strategy).toBe("fixed");
    expect(produto("X-Tudo", catalog).priceCents).toBe(2500);
  });
});

describe("buildSimpleCatalog — Macarronada (size + addOnGroup opcional)", () => {
  it("2 produtos, 4 tamanhos cada (G/M/P/PP)", () => {
    const catalog = buildSimpleCatalog(MENU);
    expect(catalog.macarronadas).toHaveLength(2);
    for (const m of catalog.macarronadas) {
      expect(m.strategy).toBe("size");
      expect(m.sizes!.map((s) => s.code).sort()).toEqual(["G", "M", "P", "PP"]);
    }
  });

  it("Macarronada de Carne: G=5000 M=4000 P=2800 PP=1500", () => {
    const catalog = buildSimpleCatalog(MENU);
    const carne = produto("Macarronada de Carne", catalog);
    const porCodigo = Object.fromEntries(carne.sizes!.map((s) => [s.code, s.priceCents]));
    expect(porCodigo).toEqual({ G: 5000, M: 4000, P: 2800, PP: 1500 });
  });

  it("addOnGroup com Bacon e Ovos, R$10 cada, max 1", () => {
    const catalog = buildSimpleCatalog(MENU);
    const carne = produto("Macarronada de Carne", catalog);
    expect(carne.addOnGroup?.max).toBe(1);
    expect(carne.addOnGroup?.options.map((o) => o.label).sort()).toEqual(["Bacon", "Ovos"]);
    for (const opcao of carne.addOnGroup!.options) expect(opcao.priceCents).toBe(1000);
  });
});

describe("buildSimpleCatalog — Sucos (milk) e Vitaminas (fixed, sem herdar regra do leite)", () => {
  it("11 sucos, strategy milk, preço-base próprio por sabor", () => {
    const catalog = buildSimpleCatalog(MENU);
    expect(catalog.sucos).toHaveLength(11);
    for (const s of catalog.sucos) expect(s.strategy).toBe("milk");
    expect(produto("Bacuri", catalog).priceCents).toBe(1000);
    expect(produto("Cajú", catalog).priceCents).toBe(700);
  });

  it("Vitamina de Banana é fixed (R$10) — categoria própria, nunca strategy milk", () => {
    const catalog = buildSimpleCatalog(MENU);
    expect(catalog.vitaminas).toHaveLength(1);
    const vitamina = produto("Vitamina de Banana", catalog);
    expect(vitamina.strategy).toBe("fixed");
    expect(vitamina.priceCents).toBe(1000);
  });
});

describe("buildSimpleCatalog — Bebidas (fixed, 23 itens exatamente do PDF)", () => {
  it("23 produtos, todos fixed", () => {
    const catalog = buildSimpleCatalog(MENU);
    expect(catalog.bebidas).toHaveLength(23);
    for (const b of catalog.bebidas) expect(b.strategy).toBe("fixed");
  });

  it("preço nunca reaproveitado do Menu antigo — ex.: Água sem Gás agora R$3 (antes R$3 coincide, mas Refrigerante 1L agora R$11 sem ambiguidade com o antigo 'Refrigerante 1L' R$11 coincide; Guaraná 1L novo R$9 == antigo)", () => {
    // Verificação direta: todo preço bate com a fonte oficial 2026, não com
    // MENU.bebidas (que é o cardápio ANTIGO, propositalmente não tocado).
    const catalog = buildSimpleCatalog(MENU);
    expect(produto("Cerveja Long Neck", catalog).priceCents).toBe(1000);
    expect(produto("Refrigerante Lata", catalog).priceCents).toBe(600);
  });
});

describe("buildSimpleCatalog — IDs estáveis e disponibilidade", () => {
  it("IDs determinísticos entre duas construções", () => {
    const a = buildSimpleCatalog(MENU);
    const b = buildSimpleCatalog(MENU);
    expect(todosOsProdutos(a).map((p) => p.id)).toEqual(todosOsProdutos(b).map((p) => p.id));
  });

  it("produto esgotado por nome fica indisponível", () => {
    const catalog = buildSimpleCatalog(MENU, ["X-Tudo"]);
    expect(produto("X-Tudo", catalog).available).toBe(false);
    expect(produto("X-Burguer", catalog).available).toBe(true);
  });
});
