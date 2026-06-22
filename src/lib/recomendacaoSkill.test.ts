import { vi, describe, it, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import {
  detectarIntencaoRecomendacao,
  gerarRecomendacaoLocal,
} from "./recomendacaoSkill";
import { createInitialSession, type BotSession } from "./bot";

function sessaoCategoria(over: Partial<BotSession> = {}): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Ana", cart: [], deliveryFee: 0, ...over };
}
function sessaoAddMore(over: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(), step: "add_more", customerName: "Ana",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryFee: 0, ...over,
  };
}
function sessaoPagamento(over: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(), step: "payment", customerName: "Ana",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryType: "delivery", neighborhood: "Centro", deliveryFee: 3, bairroConfirmado: true, address: "Rua A, 10",
    ...over,
  };
}

// ─── detectarIntencaoRecomendacao ─────────────────────────────────────────────

describe("detectarIntencaoRecomendacao — detecta intenções de recomendação", () => {
  it.each([
    ["o que você me sugere?", "sugestao"],
    ["o que você sugere?", "sugestao"],
    ["me sugere alguma coisa", "sugestao"],
    ["qual você indica?", "sugestao"],
    ["me indica uma coisa boa", "sugestao"],
    ["me recomenda algo", "sugestao"],
  ])("'%s' → '%s'", (msg, esperado) => {
    expect(detectarIntencaoRecomendacao(msg)).toBe(esperado);
  });

  it.each([
    ["não sei o que pedir", "indecisao"],
    ["nao sei o que pedir", "indecisao"],
    ["não sei escolher", "indecisao"],
    ["tô em dúvida", "indecisao"],
    ["estou em dúvida", "indecisao"],
    ["sem ideia do que pedir", "indecisao"],
  ])("'%s' → 'indecisao'", (msg) => {
    expect(detectarIntencaoRecomendacao(msg)).toBe("indecisao");
  });

  it.each([
    ["quero algo barato", "barato"],
    ["o mais barato", "barato"],
    ["mais em conta", "barato"],
    ["quero algo econômico", "barato"],
    ["custo beneficio", "barato"],
  ])("'%s' → 'barato'", (msg) => {
    expect(detectarIntencaoRecomendacao(msg)).toBe("barato");
  });

  it.each([
    ["qual mais pedido?", "popular"],
    ["o que sai mais?", "popular"],
    ["algo bom aí?", "popular"],
    ["o que tem de bom?", "popular"],
    ["o melhor de vocês", "popular"],
  ])("'%s' → 'popular'", (msg) => {
    expect(detectarIntencaoRecomendacao(msg)).toBe("popular");
  });

  it.each([
    ["tô com fome", "fome"],
    ["morrendo de fome", "fome"],
    ["quero comer bem", "fome"],
    ["surpreende aí", "fome"],
    ["me surpreende", "fome"],
  ])("'%s' → 'fome'", (msg) => {
    expect(detectarIntencaoRecomendacao(msg)).toBe("fome");
  });
});

describe("detectarIntencaoRecomendacao — NÃO detecta mensagens fora do escopo", () => {
  it.each([
    "quero uma pizza",
    "pizza",
    "pix",
    "1",
    "2",
    "sim",
    "boa noite",
    "bom dia",
    "oi",
    "cancelar",
    "entrega",
    "quanto custa",
    "Centro",
    "Rua das Flores",
  ])("'%s' → null", (msg) => {
    expect(detectarIntencaoRecomendacao(msg)).toBeNull();
  });
});

// ─── gerarRecomendacaoLocal — scope guard ────────────────────────────────────

describe("gerarRecomendacaoLocal — só age em category ou add_more", () => {
  const STEPS_FORA = [
    "welcome", "name", "size", "flavor", "payment",
    "neighborhood", "address", "confirm", "aguardando_pix", "done", "escalado",
  ] as BotSession["step"][];

  for (const step of STEPS_FORA) {
    it(`retorna null em step "${step}"`, () => {
      const session = { ...sessaoCategoria(), step };
      expect(gerarRecomendacaoLocal(session, "o que você me sugere?")).toBeNull();
    });
  }

  it("retorna null se a intenção não for de recomendação (ex: 'pizza')", () => {
    expect(gerarRecomendacaoLocal(sessaoCategoria(), "pizza")).toBeNull();
    expect(gerarRecomendacaoLocal(sessaoCategoria(), "pix")).toBeNull();
    expect(gerarRecomendacaoLocal(sessaoCategoria(), "1")).toBeNull();
  });
});

// ─── gerarRecomendacaoLocal — segurança do conteúdo ─────────────────────────

describe("gerarRecomendacaoLocal — resposta é segura", () => {
  const MENSAGENS_RECOMENDACAO = [
    "o que você me sugere?",
    "não sei o que pedir",
    "me indica uma coisa boa",
    "quero algo barato",
    "qual mais pedido?",
    "tô com fome",
  ];

  for (const msg of MENSAGENS_RECOMENDACAO) {
    it(`"${msg}" → resposta não contém R$`, () => {
      const r = gerarRecomendacaoLocal(sessaoCategoria(), msg);
      expect(r).not.toBeNull();
      expect(r).not.toMatch(/r\$|\breais\b|\breal\b/i);
    });

    it(`"${msg}" → resposta não confirma pedido`, () => {
      const r = gerarRecomendacaoLocal(sessaoCategoria(), msg);
      expect(r).not.toMatch(/pedido confirmado|pedido fechado|foi pra cozinha|pix confirmado|confirmar/i);
    });

    it(`"${msg}" → resposta conduz a uma categoria (pizza/lanche/bebida/suco)`, () => {
      const r = gerarRecomendacaoLocal(sessaoCategoria(), msg);
      expect(r!.toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
    });
  }
});

// ─── gerarRecomendacaoLocal — step add_more ───────────────────────────────────

describe("gerarRecomendacaoLocal — step add_more", () => {
  it("retorna resposta no add_more com intenção de sugestão", () => {
    const r = gerarRecomendacaoLocal(sessaoAddMore(), "o que você me sugere?");
    expect(r).not.toBeNull();
    expect(r).not.toMatch(/r\$|\breais\b/i);
    expect(r!.toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });

  it("retorna resposta no add_more com intenção de indecisão", () => {
    const r = gerarRecomendacaoLocal(sessaoAddMore(), "não sei o que pedir");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });
});

// ─── gerarRecomendacaoLocal — não altera session ─────────────────────────────

describe("gerarRecomendacaoLocal — não altera session", () => {
  it("session permanece intacta após a chamada", () => {
    const session = sessaoCategoria();
    const snap = JSON.parse(JSON.stringify(session));
    gerarRecomendacaoLocal(session, "o que você me sugere?");
    expect(session).toEqual(snap);
  });

  it("session de pagamento permanece intacta (step fora do escopo)", () => {
    const session = sessaoPagamento();
    const snap = JSON.parse(JSON.stringify(session));
    gerarRecomendacaoLocal(session, "o que você me sugere?");
    expect(session).toEqual(snap);
  });
});
