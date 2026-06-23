import { describe, it, expect } from "vitest";
import {
  atualizarRascunhoAtendimentoTempoReal,
} from "./rascunhoAtendimentoTempoReal";
import { calcularResumoAtendimentoHumano } from "./resumoAtendimentoHumano";
import { createInitialSession, type BotSession } from "./bot";

function nova(): BotSession {
  return createInitialSession();
}

// ─── 1. Pizza família calabresa e frango ─────────────────────────────────────

describe("1. pizza família calabresa e frango gera item legível", () => {
  it("detecta 'Pizza Família Calabresa/Frango'", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(
      nova(),
      "queria uma pizza familia de calabresa e frango",
    );
    expect(s.rascunhoAtendimento?.itens[0]).toBe("Pizza Família Calabresa/Frango");
  });

  it("respeita a ordem de aparição dos sabores (meio a meio)", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "pizza grande frango e calabresa");
    expect(s.rascunhoAtendimento?.itens[0]).toBe("Pizza G Frango/Calabresa");
  });
});

// ─── 2. Endereço e bairro ────────────────────────────────────────────────────

describe("2. endereço e bairro gerados a partir da mensagem", () => {
  it("'rua do caju, 24, bairro tucum' → endereço e bairro", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "rua do caju, 24, bairro tucum");
    expect(s.rascunhoAtendimento?.endereco).toBe("Rua do caju, 24");
    expect(s.rascunhoAtendimento?.bairro).toBe("Tucum");
    expect(s.rascunhoAtendimento?.tipoEntrega).toBe("delivery");
  });

  it("bairro conhecido é normalizado para o nome canônico do cadastro", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "avenida brasil, 100, bairro centro");
    expect(s.rascunhoAtendimento?.bairro).toBe("Centro");
  });
});

// ─── 3. Pagamento dinheiro ───────────────────────────────────────────────────

describe("3. mensagem 'dinheiro' gera pagamento dinheiro", () => {
  it("detecta pagamento Dinheiro", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "dinheiro");
    expect(s.rascunhoAtendimento?.pagamento).toBe("Dinheiro");
  });
});

// ─── 4. Dinheiro sem troco → pendência de troco no resumo ────────────────────

describe("4. dinheiro sem troco gera pendência de troco", () => {
  it("resumo lista 'Confirmar troco' quando pagamento é Dinheiro sem troco", () => {
    let s = nova();
    s = atualizarRascunhoAtendimentoTempoReal(s, "pizza familia de calabresa e frango");
    s = atualizarRascunhoAtendimentoTempoReal(s, "rua do caju, 24, bairro tucum");
    s = atualizarRascunhoAtendimentoTempoReal(s, "dinheiro");
    const resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.pendencias).toContain("Confirmar troco");
  });
});

// ─── 5. Pix não gera pendência de troco ──────────────────────────────────────

describe("5. pix não gera pendência de troco", () => {
  it("resumo não lista 'Confirmar troco' quando pagamento é Pix", () => {
    let s = nova();
    s = atualizarRascunhoAtendimentoTempoReal(s, "pizza familia de calabresa e frango");
    s = atualizarRascunhoAtendimentoTempoReal(s, "rua do caju, 24, bairro tucum");
    s = atualizarRascunhoAtendimentoTempoReal(s, "vou pagar no pix");
    const resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.pagamento).toBe("Pix");
    expect(resumo.pendencias).not.toContain("Confirmar troco");
  });
});

// ─── 6. Cartão não gera pendência de troco ───────────────────────────────────

describe("6. cartão não gera pendência de troco", () => {
  it("resumo não lista 'Confirmar troco' quando pagamento é Cartão", () => {
    let s = nova();
    s = atualizarRascunhoAtendimentoTempoReal(s, "pizza familia de calabresa e frango");
    s = atualizarRascunhoAtendimentoTempoReal(s, "rua do caju, 24, bairro tucum");
    s = atualizarRascunhoAtendimentoTempoReal(s, "cartao de credito");
    const resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.pagamento).toBe("Cartão");
    expect(resumo.pendencias).not.toContain("Confirmar troco");
  });
});

// ─── 7. Rascunho não sobrescreve dado oficial confirmado ─────────────────────

describe("7. resumo prefere o dado oficial quando ele já existe", () => {
  it("bairro oficial da sessão prevalece sobre o bairro do rascunho", () => {
    let s = nova();
    s.neighborhood = "Centro"; // dado oficial confirmado no fluxo
    s = atualizarRascunhoAtendimentoTempoReal(s, "bairro tucum");
    // rascunho captura Tucum, mas o resumo usa o oficial (Centro)
    expect(s.rascunhoAtendimento?.bairro).toBe("Tucum");
    const resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.bairro).toBe("Centro");
  });

  it("pagamento oficial prevalece sobre o do rascunho", () => {
    let s = nova();
    s.paymentMethod = "Pix";
    s = atualizarRascunhoAtendimentoTempoReal(s, "dinheiro");
    const resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.pagamento).toBe("Pix");
  });
});

// ─── 8. Não inventa bairro ───────────────────────────────────────────────────

describe("8. não inventa bairro quando a mensagem não contém bairro", () => {
  it("mensagem sem 'bairro' não preenche bairro", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "quero pagar no pix");
    expect(s.rascunhoAtendimento?.bairro).toBeUndefined();
  });

  it("endereço sem palavra 'bairro' não inventa bairro", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "rua das flores, 50");
    expect(s.rascunhoAtendimento?.endereco).toBe("Rua das flores, 50");
    expect(s.rascunhoAtendimento?.bairro).toBeUndefined();
  });
});

// ─── 9. Não inventa pedido em saudação ───────────────────────────────────────

describe("9. não inventa pedido quando a mensagem é só saudação", () => {
  it("'Boa noite' não gera itens", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "Boa noite");
    expect(s.rascunhoAtendimento?.itens ?? []).toHaveLength(0);
  });

  it("'oi tudo bem?' não gera itens nem endereço nem pagamento", () => {
    const s = atualizarRascunhoAtendimentoTempoReal(nova(), "oi tudo bem?");
    const r = s.rascunhoAtendimento;
    expect(r?.itens ?? []).toHaveLength(0);
    expect(r?.endereco).toBeUndefined();
    expect(r?.pagamento).toBeUndefined();
  });
});

// ─── 10. Resumo usa rascunho quando cart oficial está vazio ──────────────────

describe("10. resumo usa rascunho quando session.cart está vazio", () => {
  it("itens do rascunho aparecem no resumo quando não há carrinho oficial", () => {
    let s = nova(); // cart vazio
    s = atualizarRascunhoAtendimentoTempoReal(s, "pizza familia de calabresa e frango");
    const resumo = calcularResumoAtendimentoHumano(s);
    expect(s.cart).toHaveLength(0);
    expect(resumo.itens).toContain("Pizza Família Calabresa/Frango");
  });
});

// ─── 11. Resumo prefere dados oficiais quando cart está preenchido ───────────

describe("11. resumo prefere o carrinho oficial quando preenchido", () => {
  it("itens oficiais prevalecem sobre os do rascunho", () => {
    let s = nova();
    s.cart = [{ category: "pizza", name: "Pizza", size: "G", flavor: "Portuguesa", border: "Sem borda", price: 50 }];
    s = atualizarRascunhoAtendimentoTempoReal(s, "pizza familia de calabresa e frango");
    const resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.itens).toEqual(["Pizza G Portuguesa"]);
    expect(resumo.itens).not.toContain("Pizza Família Calabresa/Frango");
  });
});

// ─── 12. Sequência real monta resumo progressivamente ────────────────────────

describe("12. sequência real completa monta resumo progressivamente", () => {
  it("boa noite → pizza → endereço → dinheiro", () => {
    let s = nova();

    // "Boa noite" — nada detectado ainda
    s = atualizarRascunhoAtendimentoTempoReal(s, "Boa noite");
    let resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.itens).toHaveLength(0);

    // Pizza família calabresa e frango
    s = atualizarRascunhoAtendimentoTempoReal(s, "queria uma pizza familia de calabresa e frango");
    resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.itens).toContain("Pizza Família Calabresa/Frango");
    expect(resumo.pendencias).toContain("Confirmar forma de pagamento");

    // Endereço + bairro
    s = atualizarRascunhoAtendimentoTempoReal(s, "rua do caju, 24, bairro tucum");
    resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.tipoEntrega).toBe("delivery");
    expect(resumo.endereco).toBe("Rua do caju, 24");
    expect(resumo.bairro).toBe("Tucum");
    expect(resumo.pendencias).not.toContain("Confirmar bairro");
    expect(resumo.pendencias).not.toContain("Confirmar endereço");

    // Pagamento dinheiro → pendência de troco
    s = atualizarRascunhoAtendimentoTempoReal(s, "dinheiro");
    resumo = calcularResumoAtendimentoHumano(s);
    expect(resumo.pagamento).toBe("Dinheiro");
    expect(resumo.pendencias).toContain("Confirmar troco");
  });
});

// ─── 13. Helper não muta a sessão original ───────────────────────────────────

describe("13. helper não muta a sessão original", () => {
  it("a sessão passada não é alterada (retorna nova referência)", () => {
    const s = nova();
    const antes = JSON.stringify(s);
    const novo = atualizarRascunhoAtendimentoTempoReal(s, "pizza familia de calabresa e frango");
    expect(JSON.stringify(s)).toBe(antes); // original intacto
    expect(novo).not.toBe(s); // nova referência
    expect(novo.rascunhoAtendimento).toBeDefined();
  });

  it("texto vazio devolve a mesma sessão sem alterações", () => {
    const s = nova();
    const novo = atualizarRascunhoAtendimentoTempoReal(s, "   ");
    expect(novo).toBe(s);
  });

  it("itens acumulam ao longo de várias mensagens", () => {
    let s = nova();
    s = atualizarRascunhoAtendimentoTempoReal(s, "pizza grande calabresa");
    s = atualizarRascunhoAtendimentoTempoReal(s, "e um refrigerante");
    expect(s.rascunhoAtendimento?.itens).toEqual(["Pizza G Calabresa", "Refrigerante"]);
  });
});

// ─── 14. Detecção de nome contextual (step "name" / "pedindo_nome") ───────────

describe("14. nome detectado quando o bot está aguardando o nome do cliente", () => {
  it("step 'name' + 'lucas' → nome 'Lucas'", () => {
    const s = { ...nova(), step: "name" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas");
    expect(r.rascunhoAtendimento?.nome).toBe("Lucas");
  });

  it("step 'pedindo_nome' + 'lucas brito' → nome 'Lucas Brito'", () => {
    const s = { ...nova(), step: "pedindo_nome" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas brito");
    expect(r.rascunhoAtendimento?.nome).toBe("Lucas Brito");
  });

  it("step diferente de 'name'/'pedindo_nome' NÃO captura nome simples", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas");
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'dinheiro' no step 'name' NÃO é capturado como nome", () => {
    const s = { ...nova(), step: "name" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "dinheiro");
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'pix' no step 'name' NÃO é capturado como nome", () => {
    const s = { ...nova(), step: "name" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "pix");
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'pizza' no step 'pedindo_nome' NÃO é capturado como nome", () => {
    const s = { ...nova(), step: "pedindo_nome" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "pizza");
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("oficial session.customerName impede sobrescrita pelo contextual", () => {
    const s = { ...nova(), step: "name" as const, customerName: "Maria" };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas");
    // rascunho.nome não é preenchido porque oficial já existe
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("nome detectado remove 'Confirmar nome do cliente' das pendências", () => {
    const s = { ...nova(), step: "name" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas");
    const resumo = calcularResumoAtendimentoHumano(r);
    expect(resumo.cliente).toBe("Lucas");
    expect(resumo.pendencias).not.toContain("Confirmar nome do cliente");
  });
});

// ─── 15. Detecção de nome por contexto da atendente ──────────────────────────

describe("15. nome capturado quando atendente perguntou (step diferente de name)", () => {
  it("1. 'qual o seu nome?' + 'lucas' → 'Lucas' (step category)", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas", {
      ultimaMensagemAtendente: "qual o seu nome?",
    });
    expect(r.rascunhoAtendimento?.nome).toBe("Lucas");
  });

  it("2. 'nome?' + 'lucas brito' → 'Lucas Brito' (step escalado)", () => {
    const s = { ...nova(), step: "escalado" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas brito", {
      ultimaMensagemAtendente: "nome?",
    });
    expect(r.rascunhoAtendimento?.nome).toBe("Lucas Brito");
  });

  it("3. última mensagem da atendente NÃO perguntou nome → não captura", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas", {
      ultimaMensagemAtendente: "tudo bem?",
    });
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("4. atendente perguntou nome + cliente 'dinheiro' → NÃO captura", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "dinheiro", {
      ultimaMensagemAtendente: "qual o seu nome?",
    });
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("5. atendente perguntou nome + cliente 'pizza calabresa' → NÃO captura", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "pizza calabresa", {
      ultimaMensagemAtendente: "me diga seu nome",
    });
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("6. customerName oficial existe → não sobrescreve mesmo com contexto", () => {
    const s = { ...nova(), step: "category" as const, customerName: "Maria" };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas", {
      ultimaMensagemAtendente: "qual o seu nome?",
    });
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("7. rascunho.nome já existe → não sobrescreve com contextual", () => {
    const s = {
      ...nova(),
      step: "category" as const,
      rascunhoAtendimento: { itens: [], nome: "Ana" },
    };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas", {
      ultimaMensagemAtendente: "qual o seu nome?",
    });
    expect(r.rascunhoAtendimento?.nome).toBe("Ana");
  });

  it("8. caso real: atendente pergunta → cliente responde → resumo correto", () => {
    const s = { ...nova(), step: "escalado" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas", {
      ultimaMensagemAtendente: "qual o seu nome?",
    });
    const resumo = calcularResumoAtendimentoHumano(r);
    expect(resumo.cliente).toBe("Lucas");
    expect(resumo.pendencias).not.toContain("Confirmar nome do cliente");
  });

  it("variantes de pergunta: 'como você se chama?' → captura nome", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "joao silva", {
      ultimaMensagemAtendente: "como você se chama?",
    });
    expect(r.rascunhoAtendimento?.nome).toBe("Joao Silva");
  });

  it("variante: 'seu nome por favor' → captura nome", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "fernanda", {
      ultimaMensagemAtendente: "seu nome por favor",
    });
    expect(r.rascunhoAtendimento?.nome).toBe("Fernanda");
  });

  it("sem contexto (undefined) → comportamento igual ao anterior", () => {
    const s = { ...nova(), step: "category" as const };
    const r = atualizarRascunhoAtendimentoTempoReal(s, "lucas");
    expect(r.rascunhoAtendimento?.nome).toBeUndefined();
  });
});

// ─── 16. Termos de cardápio não viram nome mesmo com contexto de atendente ────

describe("16. sabores e itens de cardápio não são capturados como nome", () => {
  const ctx = { ultimaMensagemAtendente: "qual o seu nome?" };

  it("'calabresa' → NÃO captura nome", () => {
    const s = { ...nova(), step: "category" as const };
    expect(atualizarRascunhoAtendimentoTempoReal(s, "calabresa", ctx).rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'frango' → NÃO captura nome", () => {
    const s = { ...nova(), step: "category" as const };
    expect(atualizarRascunhoAtendimentoTempoReal(s, "frango", ctx).rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'portuguesa' → NÃO captura nome", () => {
    const s = { ...nova(), step: "category" as const };
    expect(atualizarRascunhoAtendimentoTempoReal(s, "portuguesa", ctx).rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'bacon' → NÃO captura nome", () => {
    const s = { ...nova(), step: "category" as const };
    expect(atualizarRascunhoAtendimentoTempoReal(s, "bacon", ctx).rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'chocolate' → NÃO captura nome", () => {
    const s = { ...nova(), step: "category" as const };
    expect(atualizarRascunhoAtendimentoTempoReal(s, "chocolate", ctx).rascunhoAtendimento?.nome).toBeUndefined();
  });

  it("'lucas' continua sendo capturado como nome", () => {
    const s = { ...nova(), step: "category" as const };
    expect(atualizarRascunhoAtendimentoTempoReal(s, "lucas", ctx).rascunhoAtendimento?.nome).toBe("Lucas");
  });

  it("'lucas brito' continua sendo capturado como nome", () => {
    const s = { ...nova(), step: "category" as const };
    expect(atualizarRascunhoAtendimentoTempoReal(s, "lucas brito", ctx).rascunhoAtendimento?.nome).toBe("Lucas Brito");
  });
});
