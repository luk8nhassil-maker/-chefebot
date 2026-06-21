import { vi, describe, it, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import {
  retomarFluxoAposHandoff,
  prepararRetomadaSilenciosa,
  proximaPerguntaPorEstado,
  createInitialSession,
  type BotSession,
  type MensagemRelevante,
} from "./bot";

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

// ─── 1. Devolver para o bot é SILENCIOSO ──────────────────────────────────────
describe("1. devolver para o bot não envia mensagem (silencioso)", () => {
  it("prepararRetomadaSilenciosa devolve só a sessão, sem mensagens", () => {
    const sess = sessaoEntregaPagamento({ step: "escalado", escalado: true, stepAnteriorEscalado: "payment" });
    const nova = prepararRetomadaSilenciosa(sess);
    // A função não tem canal de mensagens: o bot não fala ao ser devolvido.
    expect(nova.escalado).toBe(false);
    expect(nova.step).toBe("payment"); // restaura o step anterior
    expect(nova.aguardandoRetomada).toBe(true);
  });

  it("não toca no carrinho, taxa nem bairro ao devolver", () => {
    const sess = sessaoEntregaPagamento({ step: "escalado", escalado: true, stepAnteriorEscalado: "payment" });
    const nova = prepararRetomadaSilenciosa(sess);
    expect(nova.cart).toEqual(sess.cart);
    expect(nova.deliveryFee).toBe(3);
    expect(nova.neighborhood).toBe("Centro");
  });

  it("restaura um step seguro quando não há stepAnteriorEscalado", () => {
    const sess = sessaoEntregaPagamento({ step: "escalado", escalado: true, stepAnteriorEscalado: undefined });
    const nova = prepararRetomadaSilenciosa(sess);
    expect(nova.step).not.toBe("escalado");
  });
});

// ─── 2. Nova mensagem da cliente após devolução aciona a retomada ─────────────
describe("2. nova mensagem da cliente após devolução aciona retomada", () => {
  it("produz uma resposta (não fica em silêncio)", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true });
    const r = retomarFluxoAposHandoff({ session: sess, novaMensagem: "oi", intervencaoHumanaRecente: true });
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages[0].length).toBeGreaterThan(0);
  });
});

// ─── 3. Retomada lê as duas últimas mensagens relevantes ──────────────────────
describe("3. retomada lê as duas últimas mensagens relevantes", () => {
  it("inclui autor e texto das duas últimas no contexto da IA", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true });
    const ultimas: MensagemRelevante[] = [
      { autor: "cliente", texto: "quero uma pizza grande de calabresa" },
      { autor: "atendente", texto: "oi, sou a Kellyne, ja te ajudo" },
    ];
    const r = retomarFluxoAposHandoff({
      session: sess,
      novaMensagem: "oi",
      ultimasMensagens: ultimas,
      intervencaoHumanaRecente: true,
    });
    expect(r.tipo).toBe("ia");
    expect(r.promptContexto).toContain("quero uma pizza grande de calabresa");
    expect(r.promptContexto).toContain("oi, sou a Kellyne");
    expect(r.promptContexto).toContain("Atendente humano");
    expect(r.promptContexto).toContain("Cliente");
  });
});

// ─── 4. Retomada NÃO reprocessa mensagem antiga ───────────────────────────────
describe("4. retomada não reprocessa a última mensagem antiga", () => {
  it("mensagem antiga no histórico não altera carrinho nem step", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true }); // 1 pizza no carrinho
    const ultimas: MensagemRelevante[] = [
      { autor: "cliente", texto: "quero 5 pizzas" }, // se reprocessada, mudaria o carrinho
      { autor: "atendente", texto: "resolvido, devolvendo pro robô" },
    ];
    const r = retomarFluxoAposHandoff({
      session: sess,
      novaMensagem: "oi",
      ultimasMensagens: ultimas,
      intervencaoHumanaRecente: true,
    });
    expect(r.session.cart).toHaveLength(1);
    expect(r.session.cart).toEqual(sess.cart);
  });
});

// ─── 5. Conversa ambígua pós-handoff recomenda a IA ───────────────────────────
describe("5. conversa ambígua pós-handoff chama a API de IA", () => {
  it("abertura vaga ('oi') após intervenção humana → tipo ia + contexto", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true });
    const r = retomarFluxoAposHandoff({ session: sess, novaMensagem: "oi", intervencaoHumanaRecente: true });
    expect(r.tipo).toBe("ia");
    expect(r.promptContexto).toBeTruthy();
  });

  it("mensagem vaga/interrompida ('???') → tipo ia", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true });
    const r = retomarFluxoAposHandoff({ session: sess, novaMensagem: "???", intervencaoHumanaRecente: true });
    expect(r.tipo).toBe("ia");
  });

  it("detecta intervenção humana pelo autor das mensagens recentes", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true });
    const r = retomarFluxoAposHandoff({
      session: sess,
      novaMensagem: "e aí",
      ultimasMensagens: [{ autor: "atendente", texto: "te ajudei por aqui" }],
    });
    expect(r.tipo).toBe("ia");
  });
});

// ─── 6. Conversa clara continua pelo fluxo determinístico ─────────────────────
describe("6. conversa clara continua pelo fluxo normal (determinístico)", () => {
  it("resposta clara no pagamento ('pix') → determinístico e avança", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true }); // falta pagamento
    const r = retomarFluxoAposHandoff({ session: sess, novaMensagem: "pix", intervencaoHumanaRecente: true });
    expect(r.tipo).toBe("deterministico");
    expect(r.session.paymentMethod).toBeTruthy();
  });

  it("bairro claro ('Centro') no step neighborhood → determinístico aplica taxa", () => {
    const sess: BotSession = {
      ...createInitialSession(),
      step: "neighborhood",
      customerName: "Ana",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "delivery",
      deliveryFee: 0,
      bairroConfirmado: false,
      aguardandoRetomada: true,
    };
    const r = retomarFluxoAposHandoff({ session: sess, novaMensagem: "Centro", intervencaoHumanaRecente: true });
    expect(r.tipo).toBe("deterministico");
    expect(r.session.neighborhood).toBe("Centro");
    expect(r.session.deliveryFee).toBe(3);
    expect(r.session.bairroConfirmado).toBe(true);
  });
});

// ─── 7. IA não altera preço, taxa ou carrinho sem confirmação clara ───────────
describe("7. IA não altera preço, taxa ou carrinho sem confirmação clara", () => {
  it("no caminho IA, carrinho/taxa/bairro permanecem intactos e nada é inventado", () => {
    const sess = sessaoEntregaPagamento({ aguardandoRetomada: true });
    const r = retomarFluxoAposHandoff({ session: sess, novaMensagem: "oi", intervencaoHumanaRecente: true });
    expect(r.tipo).toBe("ia");
    expect(r.session.cart).toEqual(sess.cart);
    expect(r.session.deliveryFee).toBe(3);
    expect(r.session.neighborhood).toBe("Centro");
    // pagamento ainda não informado — a camada de retomada não inventa
    expect(r.session.paymentMethod).toBeFalsy();
  });
});

// ─── 8. Se faltar bairro, a resposta pede bairro ──────────────────────────────
describe("8. se faltar bairro, a resposta pede bairro", () => {
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

  it("proximaPerguntaPorEstado pede o bairro", () => {
    const prox = proximaPerguntaPorEstado(sessaoSemBairro());
    expect(prox.session.step).toBe("neighborhood");
    expect(prox.messages[0].toLowerCase()).toContain("bairro");
  });

  it("retomada ambígua usa o fallback que pede bairro", () => {
    const r = retomarFluxoAposHandoff({
      session: sessaoSemBairro({ aguardandoRetomada: true }),
      novaMensagem: "oi",
      intervencaoHumanaRecente: true,
    });
    expect(r.messages[0].toLowerCase()).toContain("bairro");
  });
});

// ─── 9. Se faltar pagamento, a resposta pede pagamento ────────────────────────
describe("9. se faltar pagamento, a resposta pede pagamento", () => {
  it("tudo definido menos pagamento → próxima pergunta é pagamento", () => {
    const prox = proximaPerguntaPorEstado(sessaoEntregaPagamento());
    expect(prox.session.step).toBe("payment");
    expect(prox.messages[0].toLowerCase()).toContain("pagamento");
  });
});

// ─── 10. Se o pedido já estiver completo, segue para a confirmação ────────────
describe("10. pedido completo segue para confirmação", () => {
  it("carrinho + retirada + pagamento → próxima etapa é confirm", () => {
    const sess: BotSession = {
      ...createInitialSession(),
      step: "confirm",
      customerName: "Ana",
      cart: [{ category: "lanche", name: "X-Burguer", price: 18 }],
      deliveryType: "pickup",
      deliveryFee: 0,
      paymentMethod: "Dinheiro",
    };
    const prox = proximaPerguntaPorEstado(sess);
    expect(prox.session.step).toBe("confirm");
    expect(prox.messages[0].toLowerCase()).toContain("confirmar");
  });
});
