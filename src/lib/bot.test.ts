import { vi, describe, test, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, detectarLancheEspecifico, detectarFamiliaProduto, createInitialSession, BotSession } from "./bot";

function sessaoName(): BotSession {
  // Conversa inicial, SEM nome salvo, no step "name"
  return { ...createInitialSession(), step: "name" };
}

function sessaoCategoria(): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Teste" };
}

function sessaoAddMore(): BotSession {
  return {
    ...createInitialSession(),
    step: "add_more",
    customerName: "Teste",
    cart: [{ category: "pizza", name: "Pizza", size: "M", flavor: "Calabresa", border: "Sem borda", price: 40 }],
  };
}

const OUTROS_LANCHES = ["Calzone", "X-Burguer", "X-Bacon", "X-Tudo", "Porção de Batatas", "Porcao de Batatas"];

function naoContemOutrosLanches(msg: string) {
  for (const lanche of OUTROS_LANCHES) {
    expect(msg).not.toContain(lanche);
  }
}

// ===== detectarFamiliaProduto() =====

describe("detectarFamiliaProduto", () => {
  test("detecta 'macarronada' como família", () => {
    const res = detectarFamiliaProduto("quero uma macarronada");
    expect(res).not.toBeNull();
    expect(res!.label).toBe("macarronada");
    expect(res!.itens.some(i => i.name === "Macarronada de Carne")).toBe(true);
  });

  test("família contém Carne e Frango", () => {
    const nomes = detectarFamiliaProduto("macarronada")!.itens.map(i => i.name);
    expect(nomes).toContain("Macarronada de Carne");
    expect(nomes).toContain("Macarronada de Frango");
  });

  test("detecta 'macaronada' (erro ortográfico)", () => {
    expect(detectarFamiliaProduto("macaronada")!.label).toBe("macarronada");
  });

  test("detecta 'tem macarrão?'", () => {
    expect(detectarFamiliaProduto("tem macarrão?")!.label).toBe("macarronada");
  });

  test("detecta 'quero uma massa' via alias", () => {
    expect(detectarFamiliaProduto("quero uma massa")!.label).toBe("macarronada");
  });

  test("NÃO detecta família para 'lanche'/'quero lanche'/'2'", () => {
    expect(detectarFamiliaProduto("lanche")).toBeNull();
    expect(detectarFamiliaProduto("quero lanche")).toBeNull();
    expect(detectarFamiliaProduto("2")).toBeNull();
  });

  test("NÃO detecta família para 'pizza'", () => {
    expect(detectarFamiliaProduto("quero pizza")).toBeNull();
  });

  test("família só contém itens de macarronada (sem outros lanches)", () => {
    const nomes = detectarFamiliaProduto("macarronada")!.itens.map(i => i.name);
    expect(nomes).toContain("Macarronada de Carne");
    expect(nomes).toContain("Macarronada de Frango");
    expect(nomes).not.toContain("Calzone");
    expect(nomes).not.toContain("X-Burguer");
    expect(nomes).not.toContain("X-Bacon");
    expect(nomes).not.toContain("X-Tudo");
    expect(nomes).not.toContain("Porcao de Batatas");
  });
});

// ===== Novo fluxo: macarronada estilo pizza (sabor → tamanho) =====

describe("fluxo macarronada estilo pizza (sabor → tamanho)", () => {
  function novaSessaoPedido(): BotSession {
    let sess = createInitialSession();
    sess = processMessage("oi", sess).session; // saudação → category
    return sess;
  }

  test("lista mostra Carne e Frango, sem preço e sem outros lanches", () => {
    const res = processMessage("quero uma macarronada", novaSessaoPedido());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Nossas macarronadas");
    expect(msg).toContain("Macarronada de Carne");
    expect(msg).toContain("Macarronada de Frango");
    expect(msg).toContain("Digite o número ou o sabor que deseja");
    expect(msg.toLowerCase()).not.toContain("nossos lanches");
    naoContemOutrosLanches(msg);
    expect(res.session.step).toBe("product_family_choice");
  });

  test("fluxo completo: 'quero uma macarronada' → '1' → 'G' adiciona Carne G", () => {
    let sess = processMessage("quero uma macarronada", novaSessaoPedido()).session;
    const resSabor = processMessage("1", sess);
    expect(resSabor.session.step).toBe("lanche_macarronada_size");
    expect(resSabor.session.currentLanche).toBe("Macarronada de Carne");
    sess = resSabor.session;
    const resTam = processMessage("G", sess);
    expect(resTam.session.step).toBe("add_more");
    expect(resTam.session.cart).toHaveLength(1);
    expect(resTam.session.cart[0].name).toBe("Macarronada de Carne");
    expect(resTam.session.cart[0].size).toBe("G");
    expect(resTam.session.cart[0].price).toBe(50);
  });

  test("fluxo completo: 'quero uma macarronada' → 'frango' → 'M' adiciona Frango M", () => {
    let sess = processMessage("quero uma macarronada", novaSessaoPedido()).session;
    const resSabor = processMessage("frango", sess);
    expect(resSabor.session.step).toBe("lanche_macarronada_size");
    expect(resSabor.session.currentLanche).toBe("Macarronada de Frango");
    sess = resSabor.session;
    const resTam = processMessage("M", sess);
    expect(resTam.session.step).toBe("add_more");
    expect(resTam.session.cart[0].name).toBe("Macarronada de Frango");
    expect(resTam.session.cart[0].size).toBe("M");
    expect(resTam.session.cart[0].price).toBe(43);
  });

  test("escolher por número '2' seleciona Frango", () => {
    const sess = processMessage("quero uma macarronada", novaSessaoPedido()).session;
    const res = processMessage("2", sess);
    expect(res.session.step).toBe("lanche_macarronada_size");
    expect(res.session.currentLanche).toBe("Macarronada de Frango");
  });

  test("'carne' (texto) seleciona Macarronada de Carne", () => {
    const sess = processMessage("quero uma macarronada", novaSessaoPedido()).session;
    const res = processMessage("carne", sess);
    expect(res.session.step).toBe("lanche_macarronada_size");
    expect(res.session.currentLanche).toBe("Macarronada de Carne");
  });

  test("'quero lanche' continua abrindo a lista completa de lanches", () => {
    const res = processMessage("quero lanche", novaSessaoPedido());
    expect(res.session.step).toBe("lanche_escolha");
    expect(res.messages.join("\n")).toContain("Calzone");
  });

  test("'macarrão' e 'massa' abrem a escolha de sabores da macarronada", () => {
    for (const t of ["macarrão", "massa", "macaronada"]) {
      const res = processMessage(t, novaSessaoPedido());
      expect(res.session.step).toBe("product_family_choice");
      expect(res.messages.join("\n")).toContain("Macarronada de Frango");
    }
  });
});

// ===== INTEGRAÇÃO: conversa nova/inicial (o bug de produção) =====

describe("INTEGRAÇÃO — conversa nova: 'quero uma macarronada'", () => {
  test("welcome → saudação → 'quero uma macarronada' lista só macarronadas", () => {
    // 1) Estado inicial, primeira mensagem qualquer dispara saudação e vai pra category
    let sess = createInitialSession();
    const saudacao = processMessage("oi", sess);
    sess = saudacao.session;
    // 2) Primeira mensagem útil de pedido
    const res = processMessage("quero uma macarronada", sess);
    const msg = res.messages.join("\n");
    expect(msg).toContain("Nossas macarronadas");
    expect(msg).toContain("Macarronada de Carne");
    expect(msg.toLowerCase()).not.toContain("nossos lanches");
    naoContemOutrosLanches(msg);
    expect(res.session.step).toBe("product_family_choice");
  });
});

// ===== step "name" (sem nome salvo) — o caminho diagnosticado =====

describe("step name — produto família ANTES da detecção de categoria", () => {
  test("'quero uma macarronada' lista só macarronadas (não 'Nossos lanches')", () => {
    const res = processMessage("quero uma macarronada", sessaoName());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Nossas macarronadas");
    expect(msg).toContain("Macarronada de Carne");
    expect(msg.toLowerCase()).not.toContain("nossos lanches");
    naoContemOutrosLanches(msg);
    expect(res.session.step).toBe("product_family_choice");
  });

  test("NÃO salva 'quero uma macarronada' como nome do cliente", () => {
    const res = processMessage("quero uma macarronada", sessaoName());
    expect(res.session.customerName).toBeUndefined();
  });

  test("'macaronada' (typo) também detecta macarronada", () => {
    const res = processMessage("macaronada", sessaoName());
    expect(res.session.step).toBe("product_family_choice");
    naoContemOutrosLanches(res.messages.join("\n"));
  });

  test("'tem macarrão?' detecta macarronada", () => {
    const res = processMessage("tem macarrão?", sessaoName());
    expect(res.session.step).toBe("product_family_choice");
  });

  test("'quero uma massa' detecta macarronada", () => {
    const res = processMessage("quero uma massa", sessaoName());
    expect(res.session.step).toBe("product_family_choice");
  });

  test("'quero lanche' continua abrindo a lista completa de lanches", () => {
    const res = processMessage("quero lanche", sessaoName());
    expect(res.session.step).toBe("lanche_escolha");
    expect(res.messages.join("\n")).toContain("Calzone");
  });

  test("'quero pizza' continua no fluxo de pizza", () => {
    const res = processMessage("quero pizza", sessaoName());
    expect(res.session.step).toBe("size");
  });
});

// ===== step "category" =====

describe("step category — produto família", () => {
  test("'quero uma macarronada' lista só macarronadas", () => {
    const res = processMessage("quero uma macarronada", sessaoCategoria());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Nossas macarronadas");
    expect(msg.toLowerCase()).not.toContain("nossos lanches");
    naoContemOutrosLanches(msg);
    expect(res.session.step).toBe("product_family_choice");
  });

  test("'macaronada'/'tem macarrão?'/'massa' detectam macarronada", () => {
    for (const t of ["macaronada", "tem macarrão?", "quero uma massa"]) {
      const res = processMessage(t, sessaoCategoria());
      expect(res.session.step).toBe("product_family_choice");
    }
  });

  test("'quero lanche' continua abrindo categoria de lanches completa", () => {
    const res = processMessage("quero lanche", sessaoCategoria());
    expect(res.session.step).toBe("lanche_escolha");
    expect(res.messages.join("\n")).toContain("Calzone");
  });

  test("'quero pizza' continua no fluxo de pizza", () => {
    expect(processMessage("quero pizza", sessaoCategoria()).session.step).toBe("size");
  });
});

// ===== step "add_more" =====

describe("step add_more — produto família", () => {
  test("'quero uma macarronada' lista só macarronadas", () => {
    const res = processMessage("quero uma macarronada", sessaoAddMore());
    const msg = res.messages.join("\n");
    expect(msg).toContain("Macarronada de Carne");
    naoContemOutrosLanches(msg);
    expect(res.session.step).toBe("product_family_choice");
  });

  test("typo 'macaronada' no add_more também detecta (não invalida)", () => {
    const res = processMessage("macaronada", sessaoAddMore());
    expect(res.session.step).toBe("product_family_choice");
  });

  test("'lanche' no add_more continua abrindo cardápio completo", () => {
    const res = processMessage("lanche", sessaoAddMore());
    expect(res.session.step).toBe("lanche_escolha");
    expect(res.messages.join("\n")).toContain("Calzone");
  });
});

// ===== Fluxo completo após escolher na família =====

describe("fluxo completo após product_family_choice", () => {
  function sessaoFamilyChoice(): BotSession {
    return {
      ...createInitialSession(),
      step: "product_family_choice",
      customerName: "Teste",
      currentCategory: "lanche",
      familiaLabel: "macarronada",
      candidatosFamilia: [{ name: "Macarronada de Carne", price: 0, hasFlavors: false, flavorsKey: "", sizes: [{ code: "P", price: 28 }, { code: "M", price: 40 }, { code: "G", price: 50 }] }],
    };
  }

  test("digitar '1' (número da opção) vai para escolha de tamanho", () => {
    const res = processMessage("1", sessaoFamilyChoice());
    expect(res.session.step).toBe("lanche_macarronada_size");
    expect(res.session.currentLanche).toBe("Macarronada de Carne");
  });

  test("digitar tamanho 'P' adiciona ao carrinho e segue para add_more", () => {
    const res = processMessage("P", sessaoFamilyChoice());
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart).toHaveLength(1);
    expect(res.session.cart[0].name).toBe("Macarronada de Carne");
    expect(res.session.cart[0].size).toBe("P");
    expect(res.session.cart[0].price).toBe(28);
  });

  test("digitar 'G' adiciona com preço correto", () => {
    expect(processMessage("G", sessaoFamilyChoice()).session.cart[0].price).toBe(50);
  });

  test("escolha de tamanho em lanche_macarronada_size segue o fluxo normal", () => {
    const sessSize: BotSession = {
      ...createInitialSession(),
      step: "lanche_macarronada_size",
      customerName: "Teste",
      currentLanche: "Macarronada de Carne",
    };
    const res = processMessage("M", sessSize);
    expect(res.session.step).toBe("add_more");
    expect(res.session.cart[0].size).toBe("M");
    expect(res.session.cart[0].price).toBe(40);
  });

  test("após escolher macarronada, fechar pedido vai para delivery_type", () => {
    const sessAddMore: BotSession = {
      ...createInitialSession(),
      step: "add_more",
      customerName: "Teste",
      cart: [{ category: "lanche", name: "Macarronada de Carne", size: "P", price: 28 }],
    };
    expect(processMessage("fechar pedido", sessAddMore).session.step).toBe("delivery_type");
  });
});
