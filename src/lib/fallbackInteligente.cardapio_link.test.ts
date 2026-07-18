import { vi, describe, it, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { resolverFallbackInteligente } from "./fallbackInteligente";
import { processMessage, createInitialSession, type BotSession } from "./bot";

const LINK_CARDAPIO = "https://chefedapizza.com.br/cardapio";
const TEXTO_LINK_OBRIGATORIO =
  "Se preferir ver o cardápio digital, é só acessar:\nhttps://chefedapizza.com.br/cardapio";

function sessaoCategoria(over: Partial<BotSession> = {}): BotSession {
  return { ...createInitialSession(), step: "category", customerName: "Ana", cart: [], deliveryFee: 0, ...over };
}

const FALLBACK_SECO = ["Ops, não achei essa opção aqui! As disponíveis são:"];

describe("bug real: fallback inteligente (IA/humanizado) também precisa do link do cardápio", () => {
  it("'Boa noite' com resposta da IA (texto real reportado) recebe o link do cardápio", async () => {
    const iaReal = vi.fn(async () => "Boa noite! 😊 Vamos montar seu pedido? O que vai ser: Pizza, Lanches, Bebidas ou Sucos e Vitaminas?");
    const r = processMessage("boa noite", sessaoCategoria());
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite",
      session: r.session,
      mensagensFallback: FALLBACK_SECO,
      chamarIA: iaReal,
    });
    expect(fb.messages[0]).toContain(TEXTO_LINK_OBRIGATORIO);
    expect(fb.messages[0]).toContain(LINK_CARDAPIO);
  });

  it("'oi' com resposta da IA (texto real reportado) recebe o link do cardápio", async () => {
    const iaReal = vi.fn(async () => "Oi! 😊 O que vai ser hoje? Pizza, Lanches, Bebidas ou Sucos e Vitaminas?");
    const r = processMessage("oi", sessaoCategoria());
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "oi",
      session: r.session,
      mensagensFallback: FALLBACK_SECO,
      chamarIA: iaReal,
    });
    expect(fb.messages[0]).toContain(TEXTO_LINK_OBRIGATORIO);
  });

  it("sem IA disponível (fallback determinístico humanizado) também recebe o link", async () => {
    const iaFalha = vi.fn(async () => null);
    const r = processMessage("boa noite", sessaoCategoria());
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite",
      session: r.session,
      mensagensFallback: FALLBACK_SECO,
      chamarIA: iaFalha,
    });
    expect(fb.messages[0]).toContain(TEXTO_LINK_OBRIGATORIO);
  });

  it("fluxo normal do WhatsApp continua funcionando após a saudação com link", () => {
    let sess = createInitialSession();
    const saudacao = processMessage("oi", sess);
    expect(saudacao.session.step).toBe("category");
    sess = saudacao.session;
    const pedido = processMessage("pizza calabresa", sess);
    expect(pedido.session.step).not.toBe("welcome");
  });

  it.each([
    ["done", { step: "done" as const }],
    ["aguardando_pix", { step: "aguardando_pix" as const }],
    ["escalado", { step: "escalado" as const, escalado: true }],
  ])("sessão em '%s' (pós-pedido/operacional) NÃO recebe o link mesmo com fallback seco", async (_label, over) => {
    const iaReal = vi.fn(async () => "Boa noite! Já registramos seu pedido, obrigado! 🍕");
    const session: BotSession = { ...createInitialSession(), cart: [], deliveryFee: 0, ...over } as BotSession;
    const fb = await resolverFallbackInteligente({
      mensagemAtual: "boa noite",
      session,
      mensagensFallback: FALLBACK_SECO,
      chamarIA: iaReal,
    });
    expect(fb.messages[0]).not.toContain(LINK_CARDAPIO);
  });
});
