import { describe, it, expect } from "vitest";
import { detectarContextoHumano, gerarRespostaContextoHumano } from "./contextoHumanoSkill";
import type { BotSession } from "./bot";

function sessao(step: BotSession["step"], extra: Partial<BotSession> = {}): BotSession {
  return {
    step,
    cart: [],
    deliveryFee: 0,
    customerName: "Ana",
    tentativasInvalidas: 0,
    ...extra,
  } as BotSession;
}

// ─── detectarContextoHumano ───────────────────────────────────────────────────

describe("detectarContextoHumano — grupos detectados", () => {
  it("detecta 'me conta uma piada' → humor", () => {
    expect(detectarContextoHumano("me conta uma piada")).toBe("humor");
  });
  it("detecta 'você é humano?' → humor", () => {
    expect(detectarContextoHumano("você é humano?")).toBe("humor");
  });
  it("detecta 'você é robô?' → humor", () => {
    expect(detectarContextoHumano("você é robô?")).toBe("humor");
  });
  it("detecta 'kkkk' → humor", () => {
    expect(detectarContextoHumano("kkkk")).toBe("humor");
  });
  it("detecta 'kkk' → humor", () => {
    expect(detectarContextoHumano("kkk")).toBe("humor");
  });
  it("detecta 'hahaha' → humor", () => {
    expect(detectarContextoHumano("hahaha")).toBe("humor");
  });
  it("detecta 'qual seu nome?' → humor", () => {
    expect(detectarContextoHumano("qual seu nome?")).toBe("humor");
  });
  it("detecta 'você gosta de pizza?' → humor", () => {
    expect(detectarContextoHumano("você gosta de pizza?")).toBe("humor");
  });

  it("detecta 'hoje foi um dia cansativo' → emocao", () => {
    expect(detectarContextoHumano("hoje foi um dia cansativo")).toBe("emocao");
  });
  it("detecta 'tô cansado' → emocao", () => {
    expect(detectarContextoHumano("tô cansado")).toBe("emocao");
  });
  it("detecta 'dia puxado' → emocao", () => {
    expect(detectarContextoHumano("dia puxado")).toBe("emocao");
  });
  it("detecta 'tô com fome' → emocao", () => {
    expect(detectarContextoHumano("tô com fome")).toBe("emocao");
  });
  it("detecta 'morrendo de fome' → emocao", () => {
    expect(detectarContextoHumano("morrendo de fome")).toBe("emocao");
  });

  it("detecta 'tô sem ideia' → indecisao", () => {
    expect(detectarContextoHumano("tô sem ideia")).toBe("indecisao");
  });
  it("detecta 'tanto faz' → indecisao", () => {
    expect(detectarContextoHumano("tanto faz")).toBe("indecisao");
  });
  it("detecta 'me surpreende' → indecisao", () => {
    expect(detectarContextoHumano("me surpreende")).toBe("indecisao");
  });
  it("detecta 'escolhe pra mim' → indecisao", () => {
    expect(detectarContextoHumano("escolhe pra mim")).toBe("indecisao");
  });

  it("detecta 'bora' → retomada", () => {
    expect(detectarContextoHumano("bora")).toBe("retomada");
  });
  it("detecta 'vamos lá' → retomada", () => {
    expect(detectarContextoHumano("vamos lá")).toBe("retomada");
  });
  it("detecta 'me salva' → retomada", () => {
    expect(detectarContextoHumano("me salva")).toBe("retomada");
  });
});

describe("detectarContextoHumano — NÃO detecta pedidos, pagamentos e números", () => {
  it("'quero uma pizza' → null", () => {
    expect(detectarContextoHumano("quero uma pizza")).toBeNull();
  });
  it("'quero um lanche' → null", () => {
    expect(detectarContextoHumano("quero um lanche")).toBeNull();
  });
  it("'pix' → null", () => {
    expect(detectarContextoHumano("pix")).toBeNull();
  });
  it("'dinheiro' → null", () => {
    expect(detectarContextoHumano("dinheiro")).toBeNull();
  });
  it("'1' → null", () => {
    expect(detectarContextoHumano("1")).toBeNull();
  });
  it("'42' → null", () => {
    expect(detectarContextoHumano("42")).toBeNull();
  });
});

describe("detectarContextoHumano — casos sensíveis retornam null", () => {
  it("'reclamação' → null", () => {
    expect(detectarContextoHumano("tenho uma reclamação")).toBeNull();
  });
  it("'demorou' → null", () => {
    expect(detectarContextoHumano("demorou demais")).toBeNull();
  });
  it("'pedido errado' → null", () => {
    expect(detectarContextoHumano("meu pedido veio errado")).toBeNull();
  });
  it("'alergia' → null", () => {
    expect(detectarContextoHumano("tenho alergia")).toBeNull();
  });
  it("'passei mal' → null", () => {
    expect(detectarContextoHumano("passei mal com o pedido")).toBeNull();
  });
  it("'paguei' → null", () => {
    expect(detectarContextoHumano("já paguei o pix")).toBeNull();
  });
  it("'cobrou errado' → null", () => {
    expect(detectarContextoHumano("cobrou errado")).toBeNull();
  });
  it("'processo' → null", () => {
    expect(detectarContextoHumano("vou abrir um processo")).toBeNull();
  });
  it("'procon' → null", () => {
    expect(detectarContextoHumano("vou no procon")).toBeNull();
  });
  it("'polícia' → null", () => {
    expect(detectarContextoHumano("vou chamar a polícia")).toBeNull();
  });
});

// ─── gerarRespostaContextoHumano ─────────────────────────────────────────────

describe("gerarRespostaContextoHumano — steps inválidos retornam null", () => {
  const stepsInvalidos: BotSession["step"][] = [
    "payment", "confirm", "delivery_type", "neighborhood", "address", "aguardando_pix",
  ];
  it.each(stepsInvalidos)("step '%s' → null", (step) => {
    expect(gerarRespostaContextoHumano(sessao(step), "me conta uma piada")).toBeNull();
  });
});

describe("gerarRespostaContextoHumano — resposta em steps válidos", () => {
  it("'me conta uma piada' em category → não null", () => {
    const r = gerarRespostaContextoHumano(sessao("category"), "me conta uma piada");
    expect(r).not.toBeNull();
  });
  it("'kkk' em category → não null", () => {
    const r = gerarRespostaContextoHumano(sessao("category"), "kkk");
    expect(r).not.toBeNull();
  });
  it("'tô sem ideia' em category → não null", () => {
    const r = gerarRespostaContextoHumano(sessao("category"), "tô sem ideia");
    expect(r).not.toBeNull();
  });
  it("'bora' em category → não null", () => {
    const r = gerarRespostaContextoHumano(sessao("category"), "bora");
    expect(r).not.toBeNull();
  });
  it("'me conta uma piada' em add_more → não null", () => {
    const r = gerarRespostaContextoHumano(sessao("add_more"), "me conta uma piada");
    expect(r).not.toBeNull();
  });
  it("'hoje foi um dia cansativo' em name → não null", () => {
    const r = gerarRespostaContextoHumano(sessao("name"), "hoje foi um dia cansativo");
    expect(r).not.toBeNull();
  });
});

describe("gerarRespostaContextoHumano — invariantes de segurança", () => {
  const casosHumor = ["me conta uma piada", "kkk", "você é humano?", "kkkk"];
  const casosEmocao = ["hoje foi um dia cansativo", "tô com fome", "morrendo de fome"];
  const casosIndecisao = ["tô sem ideia", "tanto faz", "me surpreende", "escolhe pra mim"];
  const casosRetomada = ["bora", "vamos lá", "me salva"];
  const todosCasos = [...casosHumor, ...casosEmocao, ...casosIndecisao, ...casosRetomada];

  it.each(todosCasos)("'%s' em category: resposta não contém R$", (msg) => {
    const r = gerarRespostaContextoHumano(sessao("category"), msg);
    expect(r).not.toMatch(/r\$|reais/i);
  });

  it.each(todosCasos)("'%s' em category: resposta não confirma pedido", (msg) => {
    const r = gerarRespostaContextoHumano(sessao("category"), msg);
    expect(r).not.toMatch(/pedido confirmado|pedido fechado|confirmado|pix confirmado|ja vai sair/i);
  });

  it.each(todosCasos)("'%s' em category: resposta conduz para pizza, lanche, bebida ou suco", (msg) => {
    const r = gerarRespostaContextoHumano(sessao("category"), msg);
    expect(r?.toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });

  it.each(todosCasos)("'%s' em add_more: resposta conduz para bebida, suco, lanche ou pizza", (msg) => {
    const r = gerarRespostaContextoHumano(sessao("add_more"), msg);
    expect(r?.toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });
});

describe("gerarRespostaContextoHumano — casos sensíveis retornam null", () => {
  it("reclamação → null em category", () => {
    expect(gerarRespostaContextoHumano(sessao("category"), "meu pedido demorou")).toBeNull();
  });
  it("alergia → null em category", () => {
    expect(gerarRespostaContextoHumano(sessao("category"), "tenho alergia")).toBeNull();
  });
  it("processo → null em category", () => {
    expect(gerarRespostaContextoHumano(sessao("category"), "vou abrir um processo")).toBeNull();
  });
});
