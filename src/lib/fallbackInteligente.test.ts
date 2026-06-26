import { vi, describe, it, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import {
  resolverFallbackInteligente,
  pareceFallbackSeco,
  ehMensagemSocial,
  fallbackDeterministicoMelhorado,
  avaliarHandoffPorConfusao,
  deveMarcarPrioridadePosPedido,
  houveAvancoReal,
} from "./fallbackInteligente";
import { processMessage, createInitialSession, type BotSession } from "./bot";

// As 5 respostas "secas" reais do bot (RESPOSTAS_INVALIDAS).
const FALLBACKS_SECOS = [
  "Eita, não entendi não! Pode escolher uma dessas opções:",
  "Hmm, essa não tá na lista não. Olha só:",
  "Ops, não achei essa opção aqui! As disponíveis são:",
  "Opa, acho que não tem isso não haha! Dá uma olhada:",
  "Não peguei essa, mas sem estresse! Escolhe uma daqui:",
];

function sessaoCategoria(over: Partial<BotSession> = {}): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Ana", cart: [], deliveryFee: 0, ...over };
}
function sessaoPagamento(over: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(), step: "payment", customerName: "Ana",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryType: "delivery", neighborhood: "Centro", deliveryFee: 3, bairroConfirmado: true, address: "Rua A, 10",
    ...over,
  };
}

const iaNatural = vi.fn(async () => "Boa noite! 😊 Você quer pizza, lanche, bebida ou suco?");
const iaFalha = vi.fn(async () => null);
const iaComPreco = vi.fn(async () => "Boa noite! Sua pizza sai por R$ 50, pode confirmar?");

// ─── pareceFallbackSeco ───────────────────────────────────────────────────────
describe("pareceFallbackSeco", () => {
  it("detecta as 5 respostas secas reais do bot", () => {
    for (const m of FALLBACKS_SECOS) expect(pareceFallbackSeco([m])).toBe(true);
  });
  it("detecta variações pedidas (opção válida / não encontrei / não consegui identificar)", () => {
    expect(pareceFallbackSeco(["Escolha uma opção válida"])).toBe(true);
    expect(pareceFallbackSeco(["Não encontrei essa opção"])).toBe(true);
    expect(pareceFallbackSeco(["Não consegui identificar"])).toBe(true);
  });
  it("NÃO marca respostas normais do fluxo", () => {
    expect(pareceFallbackSeco(["Qual o tamanho da pizza?"])).toBe(false);
    expect(pareceFallbackSeco(["Boa noite! 😊 Você quer pizza, lanche, bebida ou suco?"])).toBe(false);
    expect(pareceFallbackSeco(["Opa, Ana! Que bom te ver de novo 🍕"])).toBe(false); // saudação não é fallback
  });
});

// ─── deveMarcarPrioridadePosPedido ───────────────────────────────────────────
describe("deveMarcarPrioridadePosPedido", () => {
  it("pedido finalizado (step done) + msg qualquer → marca prioridade pós-pedido", () => {
    expect(deveMarcarPrioridadePosPedido("done")).toBe(true);
  });

  it("pedido finalizado + saudação TAMBÉM marca (Kellyne precisa ver qualquer msg pós-pedido)", () => {
    // Qualquer mensagem quando step='done' deve aparecer no Tempo Real como pós-pedido.
    expect(deveMarcarPrioridadePosPedido("done")).toBe(true);
  });

  it("prioridade pós-pedido NÃO ativa manual (função não seta manual — só sinaliza)", () => {
    // A função retorna true/false; é o chamador do webhook que decide o que fazer.
    // manual=true só acontece via clique em Atender (/api/assumir).
    const resultado = deveMarcarPrioridadePosPedido("done");
    expect(resultado).toBe(true);
  });

  it("conversa normal (step category) NÃO marca prioridade", () => {
    expect(deveMarcarPrioridadePosPedido("category")).toBe(false);
  });

  it("step undefined (sessão nova) NÃO marca prioridade", () => {
    expect(deveMarcarPrioridadePosPedido(undefined)).toBe(false);
  });

  it("step welcome NÃO marca prioridade", () => {
    expect(deveMarcarPrioridadePosPedido("welcome")).toBe(false);
  });
});

// ─── avaliarHandoffPorConfusao (sistema de 3 níveis) ─────────────────────────
describe("avaliarHandoffPorConfusao", () => {
  const confuso = (m: string) => pareceFallbackSeco([m]);
  const VALIDA = "Qual o tamanho da pizza?";

  it("1ª mensagem confusa → nivel 'none', bot ainda conduz (contador=1)", () => {
    const r = avaliarHandoffPorConfusao(0, confuso(FALLBACKS_SECOS[0]));
    expect(r.nivel).toBe('none');
    expect(r.novoContador).toBe(1);
  });

  it("2ª mensagem confusa → nivel 'alert', painel destaca mas bot conduz (contador=2)", () => {
    const r = avaliarHandoffPorConfusao(1, confuso(FALLBACKS_SECOS[2]));
    expect(r.nivel).toBe('alert');
    expect(r.novoContador).toBe(2);
  });

  it("3ª mensagem confusa → nivel 'urgent', bot para e Assumir agora aparece (contador=0)", () => {
    const r = avaliarHandoffPorConfusao(2, confuso(FALLBACKS_SECOS[4]));
    expect(r.nivel).toBe('urgent');
    expect(r.novoContador).toBe(0);
  });

  it("resposta válida entre confusas zera contador e retorna nivel 'none'", () => {
    // confusa → 1
    let c = avaliarHandoffPorConfusao(0, confuso(FALLBACKS_SECOS[0])).novoContador;
    expect(c).toBe(1);
    // válida → zera
    const meio = avaliarHandoffPorConfusao(c, confuso(VALIDA));
    expect(meio.nivel).toBe('none');
    expect(meio.novoContador).toBe(0);
    c = meio.novoContador;
    // próxima confusa volta a ser a 1ª (nivel 'none', não 'alert')
    const depois = avaliarHandoffPorConfusao(c, confuso(FALLBACKS_SECOS[1]));
    expect(depois.nivel).toBe('none');
    expect(depois.novoContador).toBe(1);
  });

  it("fluxo normal de pedido (sem confusão) nunca passa de 'none'", () => {
    let c = 0;
    for (const m of ["Você quer pizza, lanche, bebida ou suco?", "Qual o tamanho?", "Pedido confirmado! 🍕"]) {
      const r = avaliarHandoffPorConfusao(c, confuso(m));
      expect(r.nivel).toBe('none');
      c = r.novoContador;
    }
    expect(c).toBe(0);
  });

  it("resposta válida em nivel 'alert' reseta sem apagar dados (função pura, só retorna)", () => {
    // Simula: estava em alert (contador=2), cliente manda mensagem válida
    const r = avaliarHandoffPorConfusao(2, false);
    expect(r.nivel).toBe('none');
    expect(r.novoContador).toBe(0);
  });
});

// ─── houveAvancoReal ──────────────────────────────────────────────────────────
describe("houveAvancoReal", () => {
  const cartVazio: BotSession['cart'] = [];
  const cartComItem: BotSession['cart'] = [
    { category: 'pizza', name: 'Pizza', size: 'G', flavor: 'Calabresa', border: 'Sem borda', price: 50 },
  ];

  it("step 'escalado' → sempre true (sessão travada não acumula alerta)", () => {
    const s = { ...createInitialSession(), step: 'escalado' as any, cart: cartVazio };
    expect(houveAvancoReal(s, s)).toBe(true);
  });

  it("step mudou → true", () => {
    const antes = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const depois = { ...createInitialSession(), step: 'category' as any, cart: cartVazio };
    expect(houveAvancoReal(antes, depois)).toBe(true);
  });

  it("item adicionado ao carrinho → true", () => {
    const antes = { ...createInitialSession(), step: 'size' as any, cart: cartVazio };
    const depois = { ...createInitialSession(), step: 'size' as any, cart: cartComItem };
    expect(houveAvancoReal(antes, depois)).toBe(true);
  });

  it("deliveryType preenchido → true", () => {
    const antes = { ...createInitialSession(), step: 'delivery_type' as any, cart: cartVazio };
    const depois = { ...antes, deliveryType: 'delivery' as any };
    expect(houveAvancoReal(antes, depois)).toBe(true);
  });

  it("neighborhood preenchido → true", () => {
    const antes = { ...createInitialSession(), step: 'neighborhood' as any, cart: cartVazio };
    const depois = { ...antes, neighborhood: 'Centro' };
    expect(houveAvancoReal(antes, depois)).toBe(true);
  });

  it("deliveryFee preenchido → true", () => {
    const antes = { ...createInitialSession(), step: 'neighborhood' as any, cart: cartVazio, deliveryFee: 0 };
    const depois = { ...antes, deliveryFee: 5 };
    expect(houveAvancoReal(antes, depois)).toBe(true);
  });

  it("paymentMethod preenchido → true", () => {
    const antes = { ...createInitialSession(), step: 'payment' as any, cart: cartComItem };
    const depois = { ...antes, paymentMethod: 'Pix' as any };
    expect(houveAvancoReal(antes, depois)).toBe(true);
  });

  it("customerName preenchido → true", () => {
    const antes = { ...createInitialSession(), step: 'name' as any, cart: cartVazio };
    const depois = { ...antes, customerName: 'Lucas' };
    expect(houveAvancoReal(antes, depois)).toBe(true);
  });

  it("step igual, sem mudança de campo → false (sem avanço real)", () => {
    const s = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    expect(houveAvancoReal(s, s)).toBe(false);
  });

  // ── Cenários do bug: "Jjj" repetido em 'returning' ──────────────────────────

  it("1ª repetição sem avanço em 'returning' → semAvancoProblematico=true → nivel 'none', contador=1", () => {
    const antes = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const depois = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const semAvancoProblematico = antes.step !== 'escalado' && !houveAvancoReal(antes, depois);
    expect(semAvancoProblematico).toBe(true);
    const r = avaliarHandoffPorConfusao(0, semAvancoProblematico);
    expect(r.nivel).toBe('none');
    expect(r.novoContador).toBe(1);
  });

  it("2ª repetição sem avanço em 'returning' → nivel 'alert'", () => {
    const antes = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const depois = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const semAvancoProblematico = antes.step !== 'escalado' && !houveAvancoReal(antes, depois);
    const r = avaliarHandoffPorConfusao(1, semAvancoProblematico);
    expect(r.nivel).toBe('alert');
    expect(r.novoContador).toBe(2);
  });

  it("3ª repetição sem avanço em 'returning' → nivel 'urgent'", () => {
    const antes = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const depois = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const semAvancoProblematico = antes.step !== 'escalado' && !houveAvancoReal(antes, depois);
    const r = avaliarHandoffPorConfusao(2, semAvancoProblematico);
    expect(r.nivel).toBe('urgent');
    expect(r.novoContador).toBe(0);
  });

  it("entrada válida em 'returning' que avança step → houveAvancoReal=true → não conta dificuldade", () => {
    const antes = { ...createInitialSession(), step: 'returning' as any, cart: cartVazio };
    const depois = { ...createInitialSession(), step: 'category' as any, cart: cartVazio };
    expect(houveAvancoReal(antes, depois)).toBe(true);
    // Mesmo com contador alto, avanço real reseta tudo
    const r = avaliarHandoffPorConfusao(2, false);
    expect(r.nivel).toBe('none');
    expect(r.novoContador).toBe(0);
  });

  it("avanço real preserva carrinho e dados da sessão (função pura)", () => {
    const antes = { ...createInitialSession(), step: 'returning' as any, cart: cartComItem, customerName: 'Lucas' };
    const depois = { ...antes, step: 'category' as any };
    expect(houveAvancoReal(antes, depois)).toBe(true);
    // Dados não foram apagados — função só lê, não altera
    expect(antes.cart).toEqual(cartComItem);
    expect(antes.customerName).toBe('Lucas');
    expect(depois.cart).toEqual(cartComItem);
  });
});

// ─── ehMensagemSocial ─────────────────────────────────────────────────────────
describe("ehMensagemSocial", () => {
  it.each(["boa noite", "bom dia", "boa tarde", "oi", "olá", "opa", "tudo bem?", "beleza?", "e aí"])(
    "'%s' é social", (m) => expect(ehMensagemSocial(m)).toBe(true),
  );
  it("não classifica pedido como social", () => {
    expect(ehMensagemSocial("quero uma pizza grande")).toBe(false);
    expect(ehMensagemSocial("pix")).toBe(false);
  });
});

// ─── Regra principal: saudações nunca recebem "Ops" ───────────────────────────
describe("saudações/sociais nunca recebem fallback seco", () => {
  it.each(["boa noite", "bom dia", "boa tarde", "oi", "olá", "tudo bem?", "beleza?"])(
    "'%s' (sem IA) → resposta natural, sem 'Ops'/'não entendi'", async (msg) => {
      const r = processMessage(msg, sessaoCategoria());
      const fb = await resolverFallbackInteligente({
        mensagemAtual: msg, session: r.session, mensagensFallback: r.messages, jaEscalou: r.escalar, chamarIA: iaFalha,
      });
      expect(fb.messages[0]).not.toMatch(/ops,|não achei|nao achei|não entendi|nao entendi|opção válida/i);
      // conduz ao próximo passo (cardápio) com saudação
      expect(fb.messages[0].toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
    },
  );

  it("mensagem social em 'category' recebe resposta natural com saudação", async () => {
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: sessaoCategoria(),
      mensagensFallback: ["Ops, não achei essa opção aqui! As disponíveis são:"], chamarIA: iaFalha,
    });
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0]).toMatch(/boa noite/i);
    expect(fb.messages[0]).toMatch(/pizza|lanche|bebida|suco/i);
  });
});

// ─── Chama Guardião/IA antes de responder fallback seco ───────────────────────
describe("aciona a IA antes de mandar fallback seco", () => {
  it("fallback 'Ops...' chama a IA e usa a resposta validada", async () => {
    const spy = vi.fn(async () => "Boa noite! 😊 Quer pizza, lanche, bebida ou suco?");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: sessaoCategoria(),
      mensagensFallback: ["Ops, não achei essa opção aqui! As disponíveis são:"], chamarIA: spy,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fb.usouIA).toBe(true);
    expect(fb.intervencao).toBe("ia");
    expect(fb.messages[0]).toContain("Boa noite");
  });

  it("NÃO chama a IA quando a resposta não é seca", async () => {
    const spy = vi.fn(async () => "qualquer coisa");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "1", session: sessaoCategoria(),
      mensagensFallback: ["Qual o tamanho da pizza?"], chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.intervencao).toBe("nenhuma");
    expect(fb.messages).toEqual(["Qual o tamanho da pizza?"]);
  });
});

// ─── IA falha → fallback determinístico humanizado (não o texto seco) ─────────
describe("IA indisponível → fallback humanizado", () => {
  it("saudação: usa saudação + próximo passo", async () => {
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: sessaoCategoria(),
      mensagensFallback: ["Ops, não achei essa opção aqui!"], chamarIA: iaFalha,
    });
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0]).not.toMatch(/ops|não achei/i);
  });

  it("mensagem confusa: oferece pedido / cardápio / atendente", async () => {
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "xyz blá blá", session: sessaoCategoria(),
      mensagensFallback: ["Ops, não achei essa opção aqui!"], chamarIA: iaFalha,
    });
    expect(fb.messages[0]).toMatch(/pedido|cardápio|cardapio|atendente/i);
    expect(fb.messages[0]).not.toMatch(/ops|não achei/i);
  });
});

// ─── Segurança: IA não altera preço/carrinho/taxa/bairro/pagamento/total ──────
describe("segurança da IA", () => {
  it("resposta da IA com preço é REPROVADA → cai no fallback humanizado", async () => {
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: sessaoPagamento(),
      mensagensFallback: ["Ops, não achei essa opção aqui!"], chamarIA: iaComPreco,
    });
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0]).not.toMatch(/r\$|reais|50/i);
  });

  it("não altera a sessão (carrinho/taxa/bairro/pagamento intactos)", async () => {
    const session = sessaoPagamento();
    const snap = JSON.parse(JSON.stringify(session));
    await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session, mensagensFallback: ["Ops, não achei essa opção aqui!"], chamarIA: iaNatural,
    });
    expect(session).toEqual(snap);
  });
});

// ─── Funciona nos dois caminhos (/api/bot e /api/whatsapp) ────────────────────
describe("funciona em /api/bot e /api/whatsapp (mesma função central)", () => {
  it("/api/bot: processMessage + resolver → resposta natural", async () => {
    const r = processMessage("boa noite", sessaoCategoria()); // simula /api/bot
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: r.session, mensagensFallback: r.messages, jaEscalou: r.escalar, chamarIA: iaFalha,
    });
    expect(fb.messages[0]).not.toMatch(/ops,|não entendi/i);
  });

  it("/api/whatsapp: com últimas mensagens de contexto → resposta natural", async () => {
    const r = processMessage("boa noite", sessaoCategoria()); // simula /api/whatsapp
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: r.session, mensagensFallback: r.messages,
      ultimasMensagens: [{ autor: "bot", texto: "O que vai ser hoje?" }], jaEscalou: r.escalar, chamarIA: iaNatural,
    });
    expect(fb.messages[0]).not.toMatch(/ops,|não entendi/i);
  });

  it("escalonamento NÃO sofre intervenção do fallback", async () => {
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "quero falar com atendente", session: sessaoCategoria(),
      mensagensFallback: ["Já chamo alguém pra te ajudar! Aguarda um instantinho 😊"], jaEscalou: true, chamarIA: iaNatural,
    });
    expect(fb.intervencao).toBe("nenhuma");
  });
});

// ─── Skill de Recomendação: curto-circuito sem chamar IA ─────────────────────
describe("skill de recomendação não chama a IA", () => {
  it('"o que você me sugere?" em category → chamarIA NÃO é chamada', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "o que você me sugere?",
      session: sessaoCategoria(),
      mensagensFallback: ["Ops, não achei essa opção aqui! As disponíveis são:"],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0].toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });

  it('"quero algo barato" em category → chamarIA NÃO é chamada', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "quero algo barato",
      session: sessaoCategoria(),
      mensagensFallback: ["Eita, não entendi não! Pode escolher uma dessas opções:"],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
  });

  it('"não sei o que pedir" em category → chamarIA NÃO é chamada', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "não sei o que pedir",
      session: sessaoCategoria(),
      mensagensFallback: ["Ops, não achei essa opção aqui! As disponíveis são:"],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0]).not.toMatch(/r\$|reais/i);
  });

  it("recomendação em step 'payment' não curto-circuita → chamarIA é chamada normalmente", async () => {
    const spy = vi.fn(async () => "Tudo certo! Como você prefere pagar?");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "o que você me sugere?",
      session: sessaoPagamento(),
      mensagensFallback: ["Ops, não achei essa opção aqui!"],
      chamarIA: spy,
    });
    // Fora do escopo da skill → vai para o brain/IA normalmente
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ─── Skill de Contexto Humano: curto-circuito sem chamar IA ──────────────────
describe("skill de contexto humano não chama a IA", () => {
  const FALLBACK_SECO = "Ops, não achei essa opção aqui! As disponíveis são:";

  it('"me conta uma piada" em category → chamarIA NÃO é chamada', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "me conta uma piada",
      session: sessaoCategoria(),
      mensagensFallback: [FALLBACK_SECO],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0].toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });

  it('"você é humano?" em category → chamarIA NÃO é chamada', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "você é humano?",
      session: sessaoCategoria(),
      mensagensFallback: [FALLBACK_SECO],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
  });

  it('"hoje foi um dia cansativo" em category → chamarIA NÃO é chamada', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "hoje foi um dia cansativo",
      session: sessaoCategoria(),
      mensagensFallback: [FALLBACK_SECO],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0].toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });

  it('"kkk" em category → chamarIA NÃO é chamada, usouIA: false', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "kkk",
      session: sessaoCategoria(),
      mensagensFallback: [FALLBACK_SECO],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
  });

  it('"tô sem ideia" em category → intervencao: "fallback_melhorado"', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "tô sem ideia",
      session: sessaoCategoria(),
      mensagensFallback: [FALLBACK_SECO],
      chamarIA: spy,
    });
    // recomendacaoSkill tem "sem ideia" no grupo INDECISAO — a resposta vem de lá,
    // mas o invariante é o mesmo: sem chamar a IA.
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
  });

  it('"bora" em category → chamarIA NÃO é chamada', async () => {
    const spy = vi.fn(async () => "qualquer resposta da IA");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "bora",
      session: sessaoCategoria(),
      mensagensFallback: [FALLBACK_SECO],
      chamarIA: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fb.usouIA).toBe(false);
    expect(fb.intervencao).toBe("fallback_melhorado");
    expect(fb.messages[0].toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });

  it("contexto humano em step payment NÃO curto-circuita → chamarIA é chamada", async () => {
    const spy = vi.fn(async () => "Tudo certo! Como você prefere pagar?");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "me conta uma piada",
      session: sessaoPagamento(),
      mensagensFallback: [FALLBACK_SECO],
      chamarIA: spy,
    });
    // Fora do escopo da skill (step payment) → vai para brain/IA normalmente
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ─── fallbackDeterministicoMelhorado é step-aware (não reseta o pedido) ────────
describe("fallback humanizado é consciente do estado", () => {
  it("no pagamento, pede pagamento (não volta pro cardápio)", () => {
    const msg = fallbackDeterministicoMelhorado(sessaoPagamento(), "oi");
    expect(msg.toLowerCase()).toMatch(/pix|dinheiro|cartão|cartao|pagar/);
  });
  it("com carrinho vazio, oferece o cardápio", () => {
    const msg = fallbackDeterministicoMelhorado(sessaoCategoria(), "boa noite");
    expect(msg.toLowerCase()).toMatch(/pizza|lanche|bebida|suco/);
  });
});
