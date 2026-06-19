import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import {
  processMessage,
  setEsgotados,
  setHorarioFuncionamento,
  detectaPerguntaEntregaFuncionamento,
  type BotSession,
} from "./bot";

function sessaoName(overrides: Partial<BotSession> = {}): BotSession {
  return { step: "name", cart: [], deliveryFee: 0, ...overrides };
}

function sessaoCategory(overrides: Partial<BotSession> = {}): BotSession {
  return { step: "category", cart: [], deliveryFee: 0, customerName: "Teste", ...overrides };
}

function sessaoAddMore(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "add_more",
    cart: [{ category: "pizza", name: "Calabresa", price: 50 }],
    deliveryFee: 0,
    customerName: "Teste",
    ...overrides,
  };
}

beforeEach(() => {
  setEsgotados([]);
  setHorarioFuncionamento("22h");
});

// ─── Testes unitários da função detectora ────────────────────────────────────

describe("detectaPerguntaEntregaFuncionamento — função detectora", () => {
  // Casos que DEVEM retornar true
  it("detecta 'ainda estão fazendo entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("ainda estão fazendo entrega?")).toBe(true);
  });
  it("detecta 'ainda estao fazendo entrega?' (sem acento)", () => {
    expect(detectaPerguntaEntregaFuncionamento("ainda estao fazendo entrega?")).toBe(true);
  });
  it("detecta 'estão fazendo entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("estão fazendo entrega?")).toBe(true);
  });
  it("detecta 'estao fazendo entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("estao fazendo entrega?")).toBe(true);
  });
  it("detecta 'tá fazendo entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("tá fazendo entrega?")).toBe(true);
  });
  it("detecta 'ta fazendo entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("ta fazendo entrega?")).toBe(true);
  });
  it("detecta 'tá entregando ainda?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("tá entregando ainda?")).toBe(true);
  });
  it("detecta 'faz entrega ainda?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("faz entrega ainda?")).toBe(true);
  });
  it("detecta 'vocês estão entregando?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("vocês estão entregando?")).toBe(true);
  });
  it("detecta 'ainda dá pra pedir?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("ainda dá pra pedir?")).toBe(true);
  });
  it("detecta 'estão funcionando ainda?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("estão funcionando ainda?")).toBe(true);
  });
  it("detecta 'até que horas entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("até que horas entrega?")).toBe(true);
  });
  it("detecta 'vocês fazem delivery?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("vocês fazem delivery?")).toBe(true);
  });

  // Casos que NÃO devem retornar true (pedido completo com produto + pagamento/bairro)
  it("NÃO detecta pedido completo com produto + pix + bairro", () => {
    expect(
      detectaPerguntaEntregaFuncionamento(
        "se sim quero 2 x-burguer e batata frita pagamento no pix entrega bairro Santa Luzia"
      )
    ).toBe(false);
  });
  it("NÃO detecta pedido com pizza + bairro", () => {
    expect(
      detectaPerguntaEntregaFuncionamento("quero pizza calabresa bairro centro pix")
    ).toBe(false);
  });
});

// ─── Testes de integração: frase exata "ainda estão fazendo entrega?" ─────────

describe("frase exata 'ainda estão fazendo entrega?' — integração", () => {
  it("step name: NÃO responde com fallback de cardápio/produto", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoName());
    expect(res.messages[0]).not.toContain("Opa, acho que não tem isso");
    expect(res.messages[0]).not.toContain("Eita, não entendi");
    expect(res.messages[0]).not.toContain("Hmm, essa não tá na lista");
  });
  it("step name: responde confirmando entrega", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoName());
    expect(res.messages[0]).toContain("Sim, estamos fazendo entrega sim");
  });
  it("step name: resposta contém o horário", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoName());
    expect(res.messages[0]).toContain("22h");
  });
  it("step name: resposta convida a fazer pedido", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoName());
    expect(res.messages[0]).toContain("O que vai ser hoje");
  });
  it("step name: NÃO salva a pergunta como nome do cliente", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoName());
    expect(res.session.customerName).toBeFalsy();
  });

  it("step category: NÃO responde com fallback de produto", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoCategory());
    expect(res.messages[0]).not.toContain("Opa, acho que não tem isso");
    expect(res.messages[0]).toContain("Sim, estamos fazendo entrega sim");
  });

  it("step add_more: NÃO responde com fallback", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoAddMore());
    expect(res.messages[0]).not.toContain("Opa, acho que não tem isso");
    expect(res.messages[0]).toContain("Sim, estamos fazendo entrega sim");
  });
});

// ─── Outras variações ─────────────────────────────────────────────────────────

describe("variações de pergunta de entrega — step name", () => {
  it("'tá entregando ainda?' → confirma entrega", () => {
    const res = processMessage("tá entregando ainda?", sessaoName());
    expect(res.messages[0]).toContain("Sim, estamos fazendo entrega sim");
  });
  it("'vocês fazem delivery?' → confirma entrega", () => {
    const res = processMessage("vocês fazem delivery?", sessaoName());
    expect(res.messages[0]).toContain("Sim, estamos fazendo entrega sim");
  });
  it("'ainda dá pra pedir?' → confirma entrega", () => {
    const res = processMessage("ainda dá pra pedir?", sessaoName());
    expect(res.messages[0]).toContain("Sim, estamos fazendo entrega sim");
  });
  it("'até que horas entrega?' → mostra horário configurado", () => {
    setHorarioFuncionamento("23h");
    const res = processMessage("até que horas entrega?", sessaoName());
    expect(res.messages[0]).toContain("23h");
  });
  it("'estão funcionando ainda?' → confirma entrega", () => {
    const res = processMessage("estão funcionando ainda?", sessaoName());
    expect(res.messages[0]).toContain("Sim, estamos fazendo entrega sim");
  });
});

// ─── Pedido completo com pergunta embutida → prioriza o pedido ───────────────

describe("pedido completo com pergunta embutida — não intercepta", () => {
  it("'se sim quero 2 x-burguer e batata frita pagamento no pix entrega bairro Santa Luzia' → processa pedido", () => {
    const res = processMessage(
      "se sim quero 2 x-burguer e batata frita pagamento no pix entrega bairro Santa Luzia",
      sessaoName()
    );
    expect(res.messages[0]).not.toContain("Sim, estamos fazendo entrega sim ✅");
  });
});
