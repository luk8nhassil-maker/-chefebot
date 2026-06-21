import { vi, describe, it, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import {
  analisarConversaParaRetomada,
  classificarCaminho,
  validarRespostaIA,
  botParecePerdido,
} from "./conversationBrain";
import { prepararRetomadaSilenciosa, createInitialSession, type BotSession } from "./bot";

// Pedido com pizza, entrega + bairro confirmado + endereço, FALTANDO pagamento.
function sessaoEntregaPagamento(over: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(),
    step: "payment",
    customerName: "Ana",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryType: "delivery",
    neighborhood: "Centro",
    deliveryFee: 3,
    bairroConfirmado: true,
    address: "Rua A, 10",
    ...over,
  };
}

// Entrega sem bairro confirmado.
function sessaoSemBairro(over: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(),
    step: "neighborhood",
    customerName: "Ana",
    cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    deliveryType: "delivery",
    deliveryFee: 0,
    bairroConfirmado: false,
    ...over,
  };
}

// Pedido completo (retirada + pagamento).
function sessaoCompleta(over: Partial<BotSession> = {}): BotSession {
  return {
    ...createInitialSession(),
    step: "confirm",
    customerName: "Ana",
    cart: [{ category: "lanche", name: "X-Burguer", price: 18 }],
    deliveryType: "pickup",
    deliveryFee: 0,
    paymentMethod: "Dinheiro",
    ...over,
  };
}

// ─── Classificador: os três caminhos ──────────────────────────────────────────
describe("classificador de caminho", () => {
  it("cliente no caminho certo → CAMINHO_CERTO, sem IA", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "pix" });
    expect(d.path).toBe("CAMINHO_CERTO");
    expect(d.shouldUseAI).toBe(false);
    expect(d.recommendedAction).toBe("FOLLOW_NORMAL_FLOW");
  });

  it("cliente confuso → BECO + IA (pergunta de reorganização)", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "não entendi, como assim?" });
    expect(d.path).toBe("BECO");
    expect(d.shouldUseAI).toBe(true);
    expect(d.recommendedAction).toBe("ASK_CLARIFYING_QUESTION");
    expect(d.promptContexto).toBeTruthy();
  });

  it("sinal de desistência → SAIDA + IA (recuperação de venda)", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "deixa pra lá" });
    expect(d.path).toBe("SAIDA");
    expect(d.shouldUseAI).toBe(true);
    expect(d.recommendedAction).toBe("RECOVER_SALE");
  });

  it("bot perdido sem palavra de confusão (fluxoPerdido) → BECO + IA", () => {
    // Mensagem neutra que o fluxo rígido não entendeu — "algo fora do esperado".
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "abacaxi roxo", fluxoPerdido: true });
    expect(d.path).toBe("BECO");
    expect(d.shouldUseAI).toBe(true);
    expect(d.reason).toBe("fluxo_perdido");
  });

  it("fluxoPerdido NÃO sobrepõe um sinal de SAIDA", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "deixa pra lá", fluxoPerdido: true });
    expect(d.path).toBe("SAIDA");
  });

  it("sem fluxoPerdido, mensagem neutra segue CAMINHO_CERTO (sem IA)", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "abacaxi roxo" });
    expect(d.path).toBe("CAMINHO_CERTO");
    expect(d.shouldUseAI).toBe(false);
  });

  it("demora longa após etapa crítica → SAIDA", () => {
    const c = classificarCaminho("ok", sessaoEntregaPagamento(), { ultimaInteracaoTs: 0, agoraTs: 16 * 60 * 1000 });
    expect(c.path).toBe("SAIDA");
    expect(c.reason).toBe("demora_longa_etapa_critica");
  });

  it("vários exemplos de BECO e SAIDA do enunciado", () => {
    for (const m of ["e agora?", "tá confuso", "como assim?"]) {
      expect(classificarCaminho(m, sessaoEntregaPagamento()).path).toBe("BECO");
    }
    for (const m of ["vou ver", "depois eu peço", "tá demorando", "cancela", "vou pedir em outro canto"]) {
      expect(classificarCaminho(m, sessaoEntregaPagamento()).path).toBe("SAIDA");
    }
  });
});

// ─── Pós-handoff usa a análise de contexto ────────────────────────────────────
describe("retomada pós-handoff", () => {
  it("nova mensagem ambígua pós-handoff → IA + ação RESUME_AFTER_HANDOFF", () => {
    const d = analisarConversaParaRetomada({
      session: sessaoEntregaPagamento(),
      mensagemAtual: "oi",
      voltouDoHandoff: true,
      ultimasMensagens: [{ autor: "atendente", texto: "oi, te ajudei por aqui" }],
    });
    expect(d.recommendedAction).toBe("RESUME_AFTER_HANDOFF");
    expect(d.shouldUseAI).toBe(true);
    expect(d.promptContexto).toContain("oi, te ajudei por aqui");
  });

  it("resposta clara pós-handoff → resolve sem IA", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "pix", voltouDoHandoff: true });
    expect(d.recommendedAction).toBe("RESUME_AFTER_HANDOFF");
    expect(d.shouldUseAI).toBe(false);
  });

  it("devolver para o bot é silencioso (só ajusta a sessão, sem mensagem)", () => {
    const sess = sessaoEntregaPagamento({ step: "escalado", escalado: true, stepAnteriorEscalado: "payment" });
    const nova = prepararRetomadaSilenciosa(sess);
    expect(nova.aguardandoRetomada).toBe(true);
    expect(nova.escalado).toBe(false);
    expect(nova.step).toBe("payment");
  });
});

// ─── Validação da resposta da IA (segurança) ──────────────────────────────────
describe("validarRespostaIA", () => {
  it("rejeita resposta que inventa preço/valor em reais", () => {
    expect(validarRespostaIA("Fica R$ 50, pode confirmar?", sessaoEntregaPagamento())).toBe(false);
    expect(validarRespostaIA("São 50 reais no total", sessaoEntregaPagamento())).toBe(false);
  });

  it("rejeita confirmação de pedido incompleto", () => {
    expect(validarRespostaIA("Pedido confirmado! Já foi pra cozinha 🍕", sessaoEntregaPagamento())).toBe(false);
    expect(validarRespostaIA("Pagamento confirmado, sua pizza saiu pra entrega", sessaoEntregaPagamento())).toBe(false);
  });

  it("aceita pergunta segura que dá continuidade", () => {
    expect(validarRespostaIA("Qual a forma de pagamento? Pix, dinheiro ou cartão?", sessaoEntregaPagamento())).toBe(true);
  });

  it("permite confirmar quando o pedido está completo", () => {
    expect(validarRespostaIA("Tudo certo, posso confirmar o pedido?", sessaoCompleta())).toBe(true);
    expect(validarRespostaIA("Pedido confirmado, obrigada!", sessaoCompleta())).toBe(true);
  });

  it("rejeita resposta vazia", () => {
    expect(validarRespostaIA("", sessaoEntregaPagamento())).toBe(false);
    expect(validarRespostaIA(null, sessaoEntregaPagamento())).toBe(false);
  });
});

// ─── safeReply respeita o que falta no pedido ─────────────────────────────────
describe("resposta segura (fallback) respeita o fluxo", () => {
  it("se faltar bairro, o fallback pede bairro", () => {
    const d = analisarConversaParaRetomada({ session: sessaoSemBairro(), mensagemAtual: "oi", voltouDoHandoff: true });
    expect(d.safeReply?.toLowerCase()).toContain("bairro");
  });

  it("se faltar pagamento, o fallback pede pagamento", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "tá confuso" });
    expect(d.path).toBe("BECO");
    expect(d.safeReply?.toLowerCase()).toContain("pagamento");
  });
});

// ─── A IA não é chamada quando o fluxo resolve ────────────────────────────────
describe("eficiência: IA só quando necessário", () => {
  it("mensagem que o fluxo resolve não aciona IA", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "dinheiro" });
    expect(d.shouldUseAI).toBe(false);
    expect(d.path).toBe("CAMINHO_CERTO");
  });

  it("em atendimento humano ativo → Guardião não age (sem IA)", () => {
    const d = analisarConversaParaRetomada({ session: sessaoEntregaPagamento(), mensagemAtual: "oi", emAtendimentoHumano: true });
    expect(d.shouldUseAI).toBe(false);
    expect(d.recommendedAction).toBe("ESCALATE_TO_HUMAN");
  });
});

// ─── botParecePerdido (gatilho do fallback no webhook) ─────────────────────────
describe("botParecePerdido", () => {
  it("detecta resposta de confusão do bot", () => {
    expect(botParecePerdido(["Eita, não entendi não! Pode escolher uma dessas opções:"])).toBe(true);
  });
  it("não dispara em resposta normal do fluxo", () => {
    expect(botParecePerdido(["Qual o tamanho da pizza?"])).toBe(false);
  });
});
