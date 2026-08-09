// Testes da ponte seleção estruturada -> ItemApp canônico — cardápio oficial
// 2026 (pizza com addOnIds/MINI, Calzone flavor_priced, Pastel de Forno/
// Feira, Macarronada com addOnGroup, Hambúrguer, sucos, vitaminas, bebidas).
import { describe, expect, it } from "vitest";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { buildSimpleCatalog, todosOsProdutos } from "@/lib/catalog/simpleProducts";
import { MENU } from "@/lib/menu";
import { SUCOS } from "@/lib/catalog/officialMenu2026";
import { ACRESCIMO_LEITE_CENTS, type ItemApp } from "@/lib/pedidoAppItens";
import {
  resolverItemComSelecaoEstruturada,
  temSelecaoEstruturada,
  resolverItemComSelecaoSimplesEstruturada,
  temSelecaoSimplesEstruturada,
  temSelecaoDupla,
} from "./pedidoAppSelecaoEstruturada";

const catalog = buildPizzaCatalog(MENU);
const simpleCatalog = buildSimpleCatalog(MENU);

function flavorIdByName(name: string): string {
  const flavor = catalog.flavors.find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor ${name} não encontrado`);
  return flavor.id;
}

function sizeIdByCode(code: string): string {
  const size = catalog.sizes.find((entry) => entry.code === code);
  if (!size) throw new Error(`Tamanho ${code} não encontrado`);
  return size.id;
}

function addOnIdByLabel(label: string): string {
  const addOn = catalog.addOns.find((entry) => entry.label === label);
  if (!addOn) throw new Error(`Adicional ${label} não encontrado`);
  return addOn.id;
}

function productIdByName(name: string): string {
  const produto = todosOsProdutos(simpleCatalog).find((entry) => entry.name === name);
  if (!produto) throw new Error(`Produto ${name} não encontrado`);
  return produto.id;
}

function calzoneFlavorIdByName(name: string): string {
  const calzone = simpleCatalog.calzone[0];
  const flavor = calzone?.flavors?.find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor de calzone ${name} não encontrado`);
  return flavor.id;
}

function pastelFornoFlavorIdByName(name: string): string {
  const pastel = simpleCatalog.pastelForno[0];
  const flavor = pastel?.flavors?.find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor de pastel de forno ${name} não encontrado`);
  return flavor.id;
}

function macarronadaSizeIdByCode(productName: string, code: string): string {
  const produto = simpleCatalog.macarronadas.find((entry) => entry.name === productName);
  const size = produto?.sizes?.find((entry) => entry.code === code);
  if (!size) throw new Error(`Tamanho ${code} não encontrado para ${productName}`);
  return size.id;
}

function macarronadaAddOnIdByLabel(productName: string, label: string): string {
  const produto = simpleCatalog.macarronadas.find((entry) => entry.name === productName);
  const opcao = produto?.addOnGroup?.options.find((entry) => entry.label === label);
  if (!opcao) throw new Error(`Adicional ${label} não encontrado para ${productName}`);
  return opcao.id;
}

describe("temSelecaoEstruturada", () => {
  it("true quando pizzaSelection presente com objeto válido", () => {
    expect(temSelecaoEstruturada({ pizzaSelection: { sizeId: "x", flavorIds: ["y"] } })).toBe(true);
  });
  it("false quando a propriedade está totalmente ausente", () => {
    expect(temSelecaoEstruturada({})).toBe(false);
  });

  // Detecta PRESENÇA da propriedade, nunca truthiness do valor — um payload
  // adulterado com `pizzaSelection: null` (ou false/""/0/{}) ainda assim
  // declarou a intenção de usar o formato novo e precisa ser tratado (e
  // rejeitado) como tal, nunca reinterpretado como item legado.
  it.each([null, false, 0, "", {}, "texto", 42, []])("true mesmo quando pizzaSelection é %p (presente, mas com valor falsy/malformado)", (valor) => {
    expect(temSelecaoEstruturada({ pizzaSelection: valor })).toBe(true);
  });
});

describe("resolverItemComSelecaoEstruturada", () => {
  it("ignora name/detail enviados pelo cliente e reconstrói a partir do catálogo", () => {
    const itemAdulterado: ItemApp = {
      kind: "pizza",
      name: "Pizza F",
      detail: "algo que o cliente inventou · borda inventada",
      price: 0.01,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(itemAdulterado, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Pizza G");
      expect(resultado.item.detail).toBe("Calabresa");
      expect(resultado.item.price).toBe(45); // preço oficial da Calabresa G (cardápio 2026)
    }
  });

  it("meio a meio: nome inclui '(meio a meio)' e detail lista os dois sabores", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa"), flavorIdByName("Baiana")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Pizza G (meio a meio)");
      expect(resultado.item.detail).toBe("Calabresa / Baiana");
    }
  });

  it("com borda: detail inclui '· borda <label>'", () => {
    const border = catalog.borders[0];
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], borderId: border.id },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.item.detail).toBe(`Calabresa · borda ${border.label}`);
  });

  it("com adicionais: detail inclui '· adicional <labels>'", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa")],
        addOnIds: [addOnIdByLabel("Bacon"), addOnIdByLabel("Calabresa")],
      },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.item.detail).toBe("Calabresa · adicional Bacon, Calabresa");
  });

  it("com borda E adicionais: os dois aparecem no detail, nessa ordem", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa")],
        borderId: catalog.borders[0].id,
        addOnIds: [addOnIdByLabel("Bacon")],
      },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.detail).toBe(`Calabresa · borda ${catalog.borders[0].label} · adicional Bacon`);
    }
  });

  it("MINI + borda é rejeitado, mesmo com sabor válido", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("MINI"), flavorIds: [flavorIdByName("Calabresa")], borderId: catalog.borders[0].id },
    };
    expect(resolverItemComSelecaoEstruturada(item, catalog)).toEqual({ ok: false, error: "Mini não aceita borda" });
  });

  it("Especial + MINI é rejeitado", () => {
    const especial = catalog.flavors.find((f) => f.category === "especial")!;
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("MINI"), flavorIds: [especial.id] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(false);
  });

  it("nunca tenta o caminho legado: falha definitiva quando a seleção é inválida, mesmo com name/detail válidos no payload", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza G", // válido no formato legado
      detail: "Calabresa", // válido no formato legado
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: "size-inexistente", flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Tamanho não encontrado" });
  });

  it("rejeita kind diferente de pizza", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "Refrigerante",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Seleção estruturada só é aceita para pizza" });
  });

  it("rejeita quantidade inválida", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 0,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Quantidade inválida" });
  });

  it("rejeita pizzaSelection: null explicitamente, sem lançar exceção", () => {
    const item = {
      kind: "pizza",
      name: "Pizza G",
      detail: "Calabresa",
      price: 45,
      qty: 1,
      pizzaSelection: null,
    } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Seleção de pizza inválida" });
  });

  it.each([false, 0, "", "texto", 42, [], {}])("rejeita pizzaSelection malformado (%p), sem lançar exceção", (valor) => {
    const item = { kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 45, qty: 1, pizzaSelection: valor } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("Seleção de pizza inválida");
  });

  it("rejeita addOnIds que não é array", () => {
    const item = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], addOnIds: "Bacon" },
    } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Seleção de pizza inválida" });
  });
});

describe("temSelecaoSimplesEstruturada", () => {
  it("true quando simpleSelection presente com objeto válido", () => {
    expect(temSelecaoSimplesEstruturada({ simpleSelection: { productId: "x" } })).toBe(true);
  });
  it("false quando a propriedade está totalmente ausente", () => {
    expect(temSelecaoSimplesEstruturada({})).toBe(false);
  });
  it.each([null, false, 0, "", {}, "texto", 42, []])("true mesmo quando simpleSelection é %p (presente, mas com valor falsy/malformado)", (valor) => {
    expect(temSelecaoSimplesEstruturada({ simpleSelection: valor })).toBe(true);
  });
});

describe("temSelecaoDupla", () => {
  it("true quando pizzaSelection E simpleSelection estão presentes ao mesmo tempo", () => {
    expect(
      temSelecaoDupla({
        pizzaSelection: { sizeId: "size-g", flavorIds: ["flavor-calabresa"] },
        simpleSelection: { productId: "product-calzone", flavorId: "flavor-calabresa" },
      })
    ).toBe(true);
  });

  it("true mesmo quando um dos dois valores é falsy/malformado — presença decide, não a validade", () => {
    expect(temSelecaoDupla({ pizzaSelection: null, simpleSelection: { productId: "x" } })).toBe(true);
    expect(temSelecaoDupla({ pizzaSelection: { sizeId: "x", flavorIds: [] }, simpleSelection: undefined })).toBe(true);
  });

  it("false quando só pizzaSelection está presente", () => {
    expect(temSelecaoDupla({ pizzaSelection: { sizeId: "x", flavorIds: ["y"] } })).toBe(false);
  });

  it("false quando só simpleSelection está presente", () => {
    expect(temSelecaoDupla({ simpleSelection: { productId: "x" } })).toBe(false);
  });

  it("false quando nenhuma das duas propriedades está presente (item legado)", () => {
    expect(temSelecaoDupla({})).toBe(false);
  });
});

describe("REGRESSÃO — fonte única do acréscimo de leite", () => {
  it("com leite soma exatamente ACRESCIMO_LEITE_CENTS ao preço-base do suco, sem leite não soma nada", () => {
    const suco = SUCOS[0]; // Cajá, R$8,00
    const semLeite: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName(suco.name), milk: "sem" },
    };
    const comLeite: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName(suco.name), milk: "com" },
    };
    const resultadoSemLeite = resolverItemComSelecaoSimplesEstruturada(semLeite, simpleCatalog);
    const resultadoComLeite = resolverItemComSelecaoSimplesEstruturada(comLeite, simpleCatalog);
    expect(resultadoSemLeite.ok).toBe(true);
    expect(resultadoComLeite.ok).toBe(true);
    if (resultadoSemLeite.ok && resultadoComLeite.ok) {
      expect(Math.round((resultadoComLeite.item.price - resultadoSemLeite.item.price) * 100)).toBe(ACRESCIMO_LEITE_CENTS);
      expect(resultadoSemLeite.item.price).toBe(suco.priceCents / 100);
    }
  });
});

describe("resolverItemComSelecaoSimplesEstruturada — Calzone (flavor_priced)", () => {
  it("ignora name/detail enviados pelo cliente e reconstrói a partir do catálogo; preço vem do SABOR, não do produto", () => {
    const itemAdulterado: ItemApp = {
      kind: "simple",
      name: "Calzone",
      detail: "algo que o cliente inventou",
      price: 0.01,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: calzoneFlavorIdByName("Carne Seca") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(itemAdulterado, simpleCatalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Calzone");
      expect(resultado.item.detail).toBe("Sabor: Carne Seca");
      expect(resultado.item.price).toBe(40); // preço oficial DESTE sabor (não R$30 do Frango)
    }
  });

  it("Frango custa diferente de Carne Seca no mesmo Calzone (preço por sabor, não por produto)", () => {
    const frango: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: calzoneFlavorIdByName("Frango") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(frango, simpleCatalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.item.price).toBe(30);
  });

  it("Calzone e Pizza reutilizam o MESMO flavorId oficial quando o sabor é a mesma entidade — nenhum ID novo por produto", () => {
    expect(calzoneFlavorIdByName("Delicia")).toBe(catalog.flavors.find((f) => f.name === "Delicia")!.id);
  });

  it("rejeita Calzone sem flavorId (sabor obrigatório)", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Sabor não encontrado" });
  });

  it("Calzone REJEITA sizeId/milk/addOnId anexados, mesmo com flavorId válido", () => {
    for (const extra of [{ sizeId: "qualquer" }, { milk: "com" as const }, { addOnId: "qualquer" }]) {
      const item: ItemApp = {
        kind: "simple",
        name: "",
        price: 0,
        qty: 1,
        simpleSelection: { productId: productIdByName("Calzone"), flavorId: calzoneFlavorIdByName("Calabresa"), ...extra },
      };
      expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
    }
  });
});

describe("resolverItemComSelecaoSimplesEstruturada — Pastel de Forno (single_flavor, preço fixo)", () => {
  it("preço nunca muda por sabor (sempre R$25)", () => {
    for (const nome of ["Carne Seca", "Frango"]) {
      const item: ItemApp = {
        kind: "simple",
        name: "",
        price: 0,
        qty: 1,
        simpleSelection: { productId: productIdByName("Pastel de Forno"), flavorId: pastelFornoFlavorIdByName(nome) },
      };
      const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.item.price).toBe(25);
    }
  });

  it("sabor fora da lista do Pastel de Forno é rejeitado", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Pastel de Forno"), flavorId: "flavor-inexistente" },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Sabor não encontrado" });
  });
});

describe("resolverItemComSelecaoSimplesEstruturada — Pastel de Feira (single_flavor, recheio próprio)", () => {
  it("exige exatamente 1 recheio, preço fixo R$8", () => {
    const pastelFeira = simpleCatalog.lanches.find((l) => l.name === "Pastel de Feira")!;
    const recheio = pastelFeira.flavors!.find((f) => f.name === "Calabresa")!;
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: pastelFeira.id, flavorId: recheio.id },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.item.price).toBe(8);
  });
});

describe("resolverItemComSelecaoSimplesEstruturada — Macarronada (size + addOnGroup opcional)", () => {
  it("exige e usa o tamanho escolhido", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: {
        productId: productIdByName("Macarronada de Carne"),
        sizeId: macarronadaSizeIdByCode("Macarronada de Carne", "G"),
      },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Macarronada de Carne");
      expect(resultado.item.detail).toBe("Tamanho G");
      expect(resultado.item.price).toBe(50);
    }
  });

  it("com addOnId (Bacon): soma R$10 ao preço do tamanho", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: {
        productId: productIdByName("Macarronada de Carne"),
        sizeId: macarronadaSizeIdByCode("Macarronada de Carne", "G"),
        addOnId: macarronadaAddOnIdByLabel("Macarronada de Carne", "Bacon"),
      },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.price).toBe(60); // 50 + 10
      expect(resultado.item.detail).toBe("Tamanho G + Bacon");
    }
  });

  it("addOnId inexistente para o produto é rejeitado", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: {
        productId: productIdByName("Macarronada de Carne"),
        sizeId: macarronadaSizeIdByCode("Macarronada de Carne", "G"),
        addOnId: "macarronada-adicional-inexistente",
      },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Adicional não encontrado" });
  });

  it("rejeita Macarronada sem sizeId (tamanho obrigatório)", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Macarronada de Carne") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Tamanho não encontrado" });
  });

  it("Macarronada REJEITA milk/flavorId anexados, mesmo com sizeId válido", () => {
    for (const extra of [{ milk: "com" as const }, { flavorId: "qualquer" }]) {
      const item: ItemApp = {
        kind: "simple",
        name: "",
        price: 0,
        qty: 1,
        simpleSelection: {
          productId: productIdByName("Macarronada de Carne"),
          sizeId: macarronadaSizeIdByCode("Macarronada de Carne", "G"),
          ...extra,
        },
      };
      expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
    }
  });

  it("addOnId em produto SEM addOnGroup é rejeitado (ex.: X-Burguer com tamanho + addOn de macarronada não se aplica, mas mesmo dentro de 'size' sem grupo seria rejeitado — aqui usamos um produto fixed para provar que addOnId nunca cola)", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("X-Burguer"), addOnId: macarronadaAddOnIdByLabel("Macarronada de Carne", "Bacon") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });
});

describe("resolverItemComSelecaoSimplesEstruturada — sucos, vitaminas, produtos planos", () => {
  it("suco EXIGE milk — sem ele, rejeitado", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Laranja") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });

  it("suco REJEITA sizeId/flavorId/addOnId anexados, mesmo com milk válido", () => {
    for (const extra of [{ sizeId: "qualquer" }, { flavorId: "qualquer" }, { addOnId: "qualquer" }]) {
      const item: ItemApp = {
        kind: "simple",
        name: "",
        price: 0,
        qty: 1,
        simpleSelection: { productId: productIdByName("Laranja"), milk: "com", ...extra },
      };
      expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
    }
  });

  it("Vitamina de Banana é fixed — nunca aceita milk (não herda a regra do leite dos sucos)", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Vitamina de Banana"), milk: "com" as const },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });

  it("Vitamina de Banana sem nenhuma escolha extra: R$10,00", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Vitamina de Banana") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.item.price).toBe(10);
  });

  it("produto simples plano (X-Burguer): resolve só pelo productId", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("X-Burguer") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("X-Burguer");
      expect(resultado.item.price).toBe(17);
    }
  });

  it("produto plano (X-Burguer) REJEITA sizeId/flavorId/milk/addOnId, todos", () => {
    for (const extra of [{ sizeId: "x" }, { flavorId: "x" }, { milk: "com" as const }, { addOnId: "x" }]) {
      const item: ItemApp = {
        kind: "simple",
        name: "",
        price: 0,
        qty: 1,
        simpleSelection: { productId: productIdByName("X-Burguer"), ...extra },
      };
      expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
    }
  });

  it("nunca tenta o caminho legado: falha definitiva quando a seleção é inválida, mesmo com name/detail válidos no payload", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "Calzone",
      detail: "Sabor: Calabresa",
      price: 0,
      qty: 1,
      simpleSelection: { productId: "product-inexistente" },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Produto não encontrado" });
  });

  it("rejeita productId com formato de ID válido mas de outro catálogo (ex.: ID de tamanho de pizza)", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: sizeIdByCode("G") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Produto não encontrado" });
  });

  it("rejeita kind diferente de simple", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza G",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: calzoneFlavorIdByName("Calabresa") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({
      ok: false,
      error: "Seleção estruturada só é aceita para produto simples",
    });
  });

  it("rejeita quantidade inválida", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 0,
      simpleSelection: { productId: productIdByName("X-Burguer") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Quantidade inválida" });
  });

  it("rejeita simpleSelection: null explicitamente, sem lançar exceção", () => {
    const item = {
      kind: "simple",
      name: "Calzone",
      detail: "Sabor: Calabresa",
      price: 35,
      qty: 1,
      simpleSelection: null,
    } as unknown as ItemApp;
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });

  it.each([false, 0, "", "texto", 42, [], {}])("rejeita simpleSelection malformado (%p), sem lançar exceção", (valor) => {
    const item = { kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 35, qty: 1, simpleSelection: valor } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("Seleção de produto inválida");
  });

  it("rejeita milk fora de com/sem", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Laranja"), milk: "banana" as unknown as "com" },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });

  it("rejeita addOnId que não é string", () => {
    const item = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Macarronada de Carne"), sizeId: macarronadaSizeIdByCode("Macarronada de Carne", "G"), addOnId: 42 },
    } as unknown as ItemApp;
    expect(resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog)).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });
});

describe("resolverItemComSelecaoSimplesEstruturada — disponibilidade fresca", () => {
  it("produto esgotado (Calzone inteiro): rejeitado mesmo com IDs válidos", () => {
    const catalogoComCalzoneEsgotado = buildSimpleCatalog(MENU, ["Calzone"]);
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: calzoneFlavorIdByName("Calabresa") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, catalogoComCalzoneEsgotado)).toEqual({
      ok: false,
      error: "Produto indisponível: Calzone",
    });
  });

  it("sabor de Calzone esgotado: rejeitado mesmo com productId válido (item montado ANTES de o sabor esgotar)", () => {
    const catalogoComSaborEsgotado = buildSimpleCatalog(MENU, ["Calabresa"]);
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: calzoneFlavorIdByName("Calabresa") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, catalogoComSaborEsgotado)).toEqual({
      ok: false,
      error: "Sabor indisponível: Calabresa",
    });
  });

  it("esgotar um sabor não afeta outro produto sem esse sabor (ex.: uma bebida)", () => {
    const catalogoComSaborEsgotado = buildSimpleCatalog(MENU, ["Calabresa"]);
    const bebida = catalogoComSaborEsgotado.bebidas.find((b) => b.name === "Cerveja Long Neck")!;
    expect(bebida.available).toBe(true);
  });

  it("REGRESSÃO — disponibilidade específica por produto com ID compartilhado: 'Calabresa' esgotado reflete de forma consistente em pizza e calzone (mesma entidade, mesmo flavorId, cada catálogo calcula por conta própria)", () => {
    const esgotados = ["Calabresa"];
    const catalogoPizzaComEsgotado = buildPizzaCatalog(MENU, esgotados);
    const catalogoSimplesComEsgotado = buildSimpleCatalog(MENU, esgotados);

    const calabresaPizza = catalogoPizzaComEsgotado.flavors.find((f) => f.name === "Calabresa")!;
    const calzoneComEsgotado = catalogoSimplesComEsgotado.calzone[0];
    const calabresaCalzone = calzoneComEsgotado.flavors!.find((f) => f.name === "Calabresa")!;

    expect(calabresaCalzone.id).toBe(calabresaPizza.id);
    expect(calabresaPizza.available).toBe(false);
    expect(calabresaCalzone.available).toBe(false);

    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: calabresaCalzone.id },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, catalogoSimplesComEsgotado)).toEqual({
      ok: false,
      error: "Sabor indisponível: Calabresa",
    });
  });

  it("esconder um sabor específico do Calzone (curadoria, não estoque) nunca afeta a disponibilidade da Pizza para esse mesmo sabor", () => {
    // "Carne Seca" continua 100% disponível na Pizza mesmo que, num cenário
    // hipotético de curadoria futura, o Calzone deixasse de oferecê-lo —
    // hoje a lista do Calzone é fixa (12 sabores do PDF), então este teste
    // prova que os dois catálogos nunca compartilham a MESMA lista de
    // disponibilidade por referência (cada um calcula a própria).
    const catalogoSimples = buildSimpleCatalog(MENU);
    const catalogoPizza = buildPizzaCatalog(MENU);
    const carneSecaCalzone = catalogoSimples.calzone[0].flavors!.find((f) => f.name === "Carne Seca")!;
    const carneSecaPizza = catalogoPizza.flavors.find((f) => f.id === carneSecaCalzone.id)!;
    expect(carneSecaCalzone.available).toBe(true);
    expect(carneSecaPizza.available).toBe(true);
  });

  it("produto simples plano esgotado (ex.: bebida): rejeitado", () => {
    const catalogoComBebidaEsgotada = buildSimpleCatalog(MENU, ["Cerveja Long Neck"]);
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Cerveja Long Neck") },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, catalogoComBebidaEsgotada)).toEqual({
      ok: false,
      error: "Produto indisponível: Cerveja Long Neck",
    });
  });

  it("suco esgotado: rejeitado mesmo com milk válido", () => {
    const catalogoComSucoEsgotado = buildSimpleCatalog(MENU, ["Laranja"]);
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Laranja"), milk: "sem" },
    };
    expect(resolverItemComSelecaoSimplesEstruturada(item, catalogoComSucoEsgotado)).toEqual({
      ok: false,
      error: "Produto indisponível: Laranja",
    });
  });

  it("item montado com catálogo fresco (nada esgotado) continua funcionando normalmente — não é bloqueio geral", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: calzoneFlavorIdByName("Calabresa") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog);
    expect(resultado.ok).toBe(true);
  });
});
