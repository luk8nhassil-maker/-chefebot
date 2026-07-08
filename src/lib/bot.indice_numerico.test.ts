import { vi, describe, test, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, createInitialSession, setEsgotados, type BotSession } from "./bot";

// Regressão do bug crítico de índice: a lista numerada exibida ao cliente era
// filtrada (sem Mini-Pizza, sem esgotados), mas o número digitado era resolvido
// contra o array cru do cardápio — desalinhando o índice e entregando um item
// diferente do que o cliente escolheu (às vezes silenciosamente, sem nenhum aviso).

function sessaoCategoria(): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Teste" };
}

beforeEach(() => {
  setEsgotados([]);
});

describe("Lanche por número — lista exibida bate com o item resolvido", () => {
  // Lista exibida (listaLanches, sem Mini-Pizza):
  // 1. Calzone  2. Macarronada de Carne  3. Macarronada de Frango
  // 4. X-Burguer  5. X-Bacon  6. X-Tudo  7. Porção de Batatas
  function abreLanches(): BotSession {
    return processMessage("2", sessaoCategoria()).session; // "2. Lanches" na home
  }

  test('"1" resolve Calzone', () => {
    const res = processMessage("1", abreLanches());
    expect(res.session.step).toBe("lanche_flavor");
    expect(res.session.currentLanche).toBe("Calzone");
  });

  test('"2" resolve Macarronada de Carne (não Mini-Pizza)', () => {
    const res = processMessage("2", abreLanches());
    expect(res.session.currentLanche).toBe("Macarronada de Carne");
    expect(res.session.step).toBe("lanche_macarronada_size");
  });

  test('"3" resolve Macarronada de Frango', () => {
    const res = processMessage("3", abreLanches());
    expect(res.session.currentLanche).toBe("Macarronada de Frango");
    expect(res.session.step).toBe("lanche_macarronada_size");
  });

  test('"4" resolve X-Burguer', () => {
    const res = processMessage("4", abreLanches());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart.at(-1)?.name).toBe("X-Burguer");
  });

  test('"5" resolve X-Bacon', () => {
    const res = processMessage("5", abreLanches());
    expect(res.session.cart.at(-1)?.name).toBe("X-Bacon");
  });

  test('"6" resolve X-Tudo', () => {
    const res = processMessage("6", abreLanches());
    expect(res.session.cart.at(-1)?.name).toBe("X-Tudo");
  });

  test('"7" resolve Porcao de Batatas', () => {
    const res = processMessage("7", abreLanches());
    expect(res.session.cart.at(-1)?.name).toBe("Porcao de Batatas");
  });
});

describe("Sabor de pizza por número — com sabor esgotado antes do escolhido", () => {
  function abreFlavorComSize(): BotSession {
    const cat = processMessage("1", sessaoCategoria()).session; // "1. Pizza"
    return processMessage("3", cat).session; // tamanho Grande (opção 3 já com shift do Mini-Pizza)
  }

  test("sem esgotado: número 1 é o primeiro sabor salgado da lista", () => {
    const res = processMessage("1", abreFlavorComSize());
    expect(res.session.currentFlavor).toBe("Calabresa");
  });

  test("com o 1º sabor esgotado, número 1 vira o 2º sabor real (não desloca para o 1º, que sumiu da lista)", () => {
    setEsgotados(["Calabresa"]);
    const sess = abreFlavorComSize();
    // Lista exibida agora começa em "Frango Catupiry" (Calabresa sumiu)
    const listaMsg = processMessage("999", sess).messages.join("\n"); // resposta inválida reexibe a lista
    expect(listaMsg).toContain("1. Frango Catupiry");
    expect(listaMsg).not.toContain("Calabresa");

    const res = processMessage("1", sess);
    expect(res.session.currentFlavor).toBe("Frango Catupiry");
  });

  test("com o 1º sabor esgotado, número 2 (exibido) resolve para o 3º sabor real, não para o esgotado", () => {
    setEsgotados(["Calabresa"]);
    const sess = abreFlavorComSize();
    // Lista filtrada: 1. Frango Catupiry  2. Portuguesa  3. Carne Seca ...
    const res = processMessage("2", sess);
    expect(res.session.currentFlavor).toBe("Portuguesa");
  });
});

describe("Bebida por número — com bebida esgotada antes da escolhida", () => {
  function abreBebidas(): BotSession {
    return processMessage("3", sessaoCategoria()).session; // "3. Bebidas"
  }

  test("sem esgotado: número 1 é a 1ª bebida da lista", () => {
    const res = processMessage("1", abreBebidas());
    expect(res.session.cart.at(-1)?.name).toBe("Refrigerante 1L");
  });

  // Nota: "número 1 vira a 2ª bebida real" não dá pra testar com input "1" puro aqui —
  // "Refrigerante 1L" contém o dígito "1" no próprio nome, então o casamento por NOME
  // (`normalizar(nome).includes(n)`, checado antes do índice numérico) acha esse item
  // esgotado e recusa antes mesmo de chegar no fallback por número — comportamento correto,
  // só não exercita o trecho corrigido. A seleção dupla abaixo testa exatamente esse trecho,
  // já que "1 e 2" não passa pelo casamento por nome.
  test("com a 1ª bebida esgotada, '1 e 2' resolve para a 2ª e a 3ª bebida real (lista filtrada)", () => {
    setEsgotados(["Refrigerante 1L"]);
    const sess = abreBebidas();
    const res = processMessage("1 e 2", sess);
    const nomes = res.session.cart.slice(-2).map((i) => i.name);
    expect(nomes).toEqual(["Refrigerante 1,5L", "Refrigerante 2L"]);
  });

  test("com a 1ª bebida esgotada, número 2 (exibido) resolve para a 3ª bebida real", () => {
    setEsgotados(["Refrigerante 1L"]);
    const sess = abreBebidas();
    const res = processMessage("2", sess);
    expect(res.session.cart.at(-1)?.name).toBe("Refrigerante 2L");
  });
});

describe("Suco por número — com suco esgotado antes do escolhido", () => {
  function abreSucos(): BotSession {
    return processMessage("4", sessaoCategoria()).session; // "4. Sucos e Vitaminas"
  }

  test("sem esgotado: número 1 é o 1º suco da lista", () => {
    const res = processMessage("1", abreSucos());
    expect(res.session.pendingSucosLeite?.[0]?.name ?? res.session.cart.at(-1)?.name).toBe("Caja");
  });

  test("com o 1º suco esgotado, número 1 vira o 2º suco real", () => {
    setEsgotados(["Caja"]);
    const sess = abreSucos();
    const res = processMessage("1", sess);
    const nome = res.session.pendingSucosLeite?.[0]?.name ?? res.session.cart.at(-1)?.name;
    expect(nome).toBe("Caju");
  });

  test("com o 1º suco esgotado, número 2 (exibido) resolve para o 3º suco real", () => {
    setEsgotados(["Caja"]);
    const sess = abreSucos();
    const res = processMessage("2", sess);
    const nome = res.session.pendingSucosLeite?.[0]?.name ?? res.session.cart.at(-1)?.name;
    expect(nome).toBe("Acerola");
  });
});

describe("Meio a meio por número — com sabor esgotado, os dois números batem com a lista exibida", () => {
  function abreFlavorComSize(): BotSession {
    const cat = processMessage("1", sessaoCategoria()).session;
    return processMessage("3", cat).session; // tamanho Grande, permite meio a meio
  }

  test("sem esgotado: '1 e 2' resulta em Calabresa/Frango Catupiry", () => {
    const res = processMessage("1 e 2", abreFlavorComSize());
    expect(res.session.currentFlavor).toBe("Calabresa/Frango Catupiry");
  });

  test("com o 1º sabor esgotado, '1 e 2' resulta nos dois primeiros da lista FILTRADA (Frango Catupiry/Portuguesa)", () => {
    setEsgotados(["Calabresa"]);
    const sess = abreFlavorComSize();
    const res = processMessage("1 e 2", sess);
    expect(res.session.currentFlavor).toBe("Frango Catupiry/Portuguesa");
  });
});
