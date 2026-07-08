import { vi, describe, it, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import {
  processMessage,
  createInitialSession,
  createReturningSession,
  montarSaudacaoRetorno,
  garantirLinkCardapioEmMensagemDePedido,
  garantirLinkCardapioEmMensagens,
  LINK_CARDAPIO_DIGITAL,
  type BotSession,
  type ClienteHistorico,
} from "./bot";
import { resolverFallbackInteligente } from "./fallbackInteligente";

const TEXTO_LINK =
  "Se preferir ver o cardápio digital, é só acessar:\nhttps://chefebot-pjif.vercel.app/cardapio";

function historicoFake(over: Partial<ClienteHistorico> = {}): ClienteHistorico {
  return {
    nome: "Ana Silva",
    ultimoPedido: ["Pizza Calabresa G"],
    ultimoTotal: 50,
    totalPedidos: 2,
    ultimaVisita: Date.now() - 1000 * 60 * 60,
    ...over,
  };
}

// ─── Casos 1-3: as mensagens EXATAS dos testes reais no WhatsApp ─────────────

describe("gate central: mensagens reais do teste no WhatsApp recebem o link", () => {
  it("caso 1: 'Boa noite! 😊 Vamos montar seu pedido?...' recebe o link", () => {
    const msg = "Boa noite! 😊 Vamos montar seu pedido? O que vai ser: Pizza, Lanches, Bebidas ou Sucos e Vitaminas?";
    const out = garantirLinkCardapioEmMensagemDePedido(msg, "category");
    expect(out).toContain(TEXTO_LINK);
  });

  it("caso 2: 'Oi! 😊 O que vai ser hoje?...' recebe o link", () => {
    const msg = "Oi! 😊 O que vai ser hoje? Pizza, Lanches, Bebidas ou Sucos e Vitaminas?";
    const out = garantirLinkCardapioEmMensagemDePedido(msg, "category");
    expect(out).toContain(TEXTO_LINK);
  });

  it("caso 3: 'Voltei por aqui! 😊 O que vai ser hoje? Temos pizza...' recebe o link", () => {
    const msg = "Voltei por aqui! 😊 O que vai ser hoje? Temos pizza, lanches, bebidas, sucos e vitaminas!";
    const out = garantirLinkCardapioEmMensagemDePedido(msg, "category");
    expect(out).toContain(TEXTO_LINK);
  });

  it("caso 3 (sem step, como na retomada pós-handoff/IA): também recebe o link", () => {
    const msg = "Voltei por aqui! 😊 O que vai ser hoje? Temos pizza, lanches, bebidas, sucos e vitaminas!";
    const out = garantirLinkCardapioEmMensagemDePedido(msg);
    expect(out).toContain(TEXTO_LINK);
  });
});

// ─── Casos 4-5: cliente novo e cliente retornando ────────────────────────────

describe("gate central: entradas de pedido pelo fluxo determinístico", () => {
  it("caso 4: cliente novo ('oi' em sessão welcome) recebe o link", () => {
    const res = processMessage("oi", createInitialSession());
    expect(res.messages.join("\n")).toContain(TEXTO_LINK);
  });

  it("caso 5: cliente retornando recebe o link (saudação de retorno)", () => {
    expect(montarSaudacaoRetorno(historicoFake())).toContain(TEXTO_LINK);
  });

  it("caso 5b: sessão 'returning' sem match direto responde com link", () => {
    const sess = createReturningSession(historicoFake());
    const res = processMessage("hmmmm", sess);
    // resposta de retorno é convite de pedido -> deve ter link
    expect(res.messages.join("\n")).toContain(LINK_CARDAPIO_DIGITAL);
  });

  it("sessão 'done' reiniciando atendimento (novo pedido) recebe o link", () => {
    const sess: BotSession = { step: "done", cart: [], deliveryFee: 0, tentativasInvalidas: 0 };
    const res = processMessage("quero pedir de novo", sess);
    expect(res.messages.join("\n")).toContain(TEXTO_LINK);
    expect(res.session.step).toBe("category");
  });
});

// ─── Caso 6: fallback inteligente (IA e curto-circuitos locais) ──────────────

describe("gate central: fallback inteligente universal", () => {
  const FALLBACK_SECO = ["Ops, não achei essa opção aqui! As disponíveis são:"];
  const sessaoCategoria = (): BotSession =>
    ({ ...createInitialSession(), step: "category", customerName: "Ana" });

  it("caso 6a: resposta da IA com convite de pedido recebe o link", async () => {
    const ia = vi.fn(async () => "Boa noite! 😊 Vamos montar seu pedido? O que vai ser: Pizza, Lanches, Bebidas ou Sucos e Vitaminas?");
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: sessaoCategoria(), mensagensFallback: FALLBACK_SECO, chamarIA: ia,
    });
    expect(fb.messages[0]).toContain(TEXTO_LINK);
  });

  it("caso 6b: curto-circuito de contexto humano (ex.: piada) recebe o link", async () => {
    const ia = vi.fn(async () => null);
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "me conta uma piada", session: sessaoCategoria(), mensagensFallback: FALLBACK_SECO, chamarIA: ia,
    });
    // Template local convida para pizza/lanche/bebida/suco -> precisa do link
    expect(fb.messages[0]).toContain(LINK_CARDAPIO_DIGITAL);
  });

  it("caso 6c: fallback determinístico humanizado recebe o link", async () => {
    const ia = vi.fn(async () => null);
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite", session: sessaoCategoria(), mensagensFallback: FALLBACK_SECO, chamarIA: ia,
    });
    expect(fb.messages[0]).toContain(LINK_CARDAPIO_DIGITAL);
  });
});

// ─── Casos 7-11: exceções que NUNCA recebem o link ───────────────────────────

describe("gate central: exceções (pós-pedido/pagamento/humano) nunca recebem link", () => {
  it("caso 7: mensagem de atendimento humano/escalado NÃO recebe link", () => {
    expect(garantirLinkCardapioEmMensagemDePedido("Já chamo alguém pra te ajudar! Nossa equipe vem aí. 😊", "escalado"))
      .not.toContain(LINK_CARDAPIO_DIGITAL);
    // mesmo sem step, conteúdo de equipe/atendente bloqueia
    expect(garantirLinkCardapioEmMensagemDePedido("Nossa equipe vai te ajudar a finalizar o pedido de pizza! Um instante."))
      .not.toContain(LINK_CARDAPIO_DIGITAL);
  });

  it("caso 8: mensagem de pedido entregue NÃO recebe link", () => {
    expect(garantirLinkCardapioEmMensagemDePedido("Sua pizza foi entregue! Bom apetite! 🍕"))
      .not.toContain(LINK_CARDAPIO_DIGITAL);
  });

  it("caso 9: mensagem de pedido cancelado NÃO recebe link", () => {
    expect(garantirLinkCardapioEmMensagemDePedido("Tudo bem, seu pedido de pizza foi cancelado! Se mudar de ideia é só chamar."))
      .not.toContain(LINK_CARDAPIO_DIGITAL);
  });

  it("caso 10: mensagem de avaliação NÃO recebe link", () => {
    expect(garantirLinkCardapioEmMensagemDePedido("Obrigado pela avaliação! De 1 a 5, que nota você dá pra pizza?"))
      .not.toContain(LINK_CARDAPIO_DIGITAL);
  });

  it("caso 11: mensagem de Pix/pagamento NÃO recebe link", () => {
    expect(garantirLinkCardapioEmMensagemDePedido("Qual a forma de pagamento? 💸\n\n  1. Pix 💸\n  2. Dinheiro\n  3. Cartão"))
      .not.toContain(LINK_CARDAPIO_DIGITAL);
    expect(garantirLinkCardapioEmMensagemDePedido("Só me manda o comprovante do Pix pra confirmar o pedido de pizza! 📄", "aguardando_pix"))
      .not.toContain(LINK_CARDAPIO_DIGITAL);
  });

  it("steps de pagamento/confirmação bloqueiam mesmo com termos de pedido", () => {
    for (const step of ["payment", "payment_hibrido_valor", "payment_hibrido_complemento", "troco", "confirm", "done", "aguardando_pix", "escalado"]) {
      expect(garantirLinkCardapioEmMensagemDePedido("Sua pizza grande de calabresa está anotada!", step))
        .not.toContain(LINK_CARDAPIO_DIGITAL);
    }
  });

  it("confirmação de pedido (fecha em done) NÃO recebe link no fluxo real", () => {
    const sess: BotSession = {
      ...createInitialSession(), step: "confirm", customerName: "Ana",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "pickup", deliveryFee: 0, paymentMethod: "Dinheiro",
    };
    const res = processMessage("1", sess);
    expect(res.session.step).toBe("done");
    expect(res.messages.join("\n")).not.toContain(LINK_CARDAPIO_DIGITAL);
  });
});

// ─── Caso 12: sem duplicação ─────────────────────────────────────────────────

describe("gate central: nunca duplica o link", () => {
  it("caso 12: mensagem que já tem o link fica intacta", () => {
    const msg = `Oi! O que vai ser hoje? Pizza ou lanche?\n\n${TEXTO_LINK}`;
    const out = garantirLinkCardapioEmMensagemDePedido(msg, "category");
    expect(out).toBe(msg);
    expect(out.split(LINK_CARDAPIO_DIGITAL).length - 1).toBe(1);
  });

  it("resposta com várias bolhas recebe o link no máximo uma vez", () => {
    const msgs = [
      "Boa, Ana! 😋 Anotei o seu de sempre:",
      "🛒 Itens: Pizza Calabresa G\n\nO que vai ser hoje? Pizza, lanche, bebida ou suco?",
    ];
    const out = garantirLinkCardapioEmMensagens(msgs, "category");
    const total = out.join("\n").split(LINK_CARDAPIO_DIGITAL).length - 1;
    expect(total).toBe(1);
  });

  it("gate aplicado duas vezes (bot + rota) não duplica", () => {
    const uma = garantirLinkCardapioEmMensagens(["Oi! O que vai ser hoje? Pizza ou lanche?"], "category");
    const duas = garantirLinkCardapioEmMensagens(uma, "category");
    expect(duas.join("\n").split(LINK_CARDAPIO_DIGITAL).length - 1).toBe(1);
  });
});

// ─── Caso 13: fluxo normal continua funcionando ──────────────────────────────

describe("gate central: fluxo do pedido continua normal", () => {
  it("caso 13: saudação com link -> pedido de pizza segue o fluxo", () => {
    let sess = createInitialSession();
    const saudacao = processMessage("oi", sess);
    expect(saudacao.messages.join("\n")).toContain(LINK_CARDAPIO_DIGITAL);
    expect(saudacao.session.step).toBe("category");

    const pedido = processMessage("pizza calabresa", saudacao.session);
    expect(pedido.session.step).not.toBe("welcome");
    expect(pedido.session.step).not.toBe("category");
  });
});

// ─── Caso 14: simulador /api/bot usa o mesmo processMessage + fallback ───────

describe("gate central: consistência simulador x WhatsApp real", () => {
  it("caso 14: o mesmo processMessage serve /api/bot e /api/whatsapp — saudação sai com link", () => {
    // /api/bot chama processMessage + resolverFallbackInteligente, ambos com o
    // gate central embutido; este teste trava a garantia no nível compartilhado.
    const res = processMessage("oi", createInitialSession());
    expect(res.messages.join("\n")).toContain(LINK_CARDAPIO_DIGITAL);
  });
});
