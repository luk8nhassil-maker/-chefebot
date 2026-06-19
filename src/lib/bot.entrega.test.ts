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

beforeEach(() => {
  setEsgotados([]);
  setHorarioFuncionamento("22h");
});

// ─── Testes unitários da função detectora ────────────────────────────────────

describe("detectaPerguntaEntregaFuncionamento", () => {
  it("detecta 'ainda estão fazendo entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("ainda estão fazendo entrega?")).toBe(true);
  });

  it("detecta 'tá entregando ainda?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("tá entregando ainda?")).toBe(true);
  });

  it("detecta 'vocês fazem delivery?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("vocês fazem delivery?")).toBe(true);
  });

  it("detecta 'ainda dá pra pedir?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("ainda dá pra pedir?")).toBe(true);
  });

  it("detecta 'até que horas entrega?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("até que horas entrega?")).toBe(true);
  });

  it("detecta 'vocês estão funcionando?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("vocês estão funcionando?")).toBe(true);
  });

  it("detecta 'estão abertos ainda?'", () => {
    expect(detectaPerguntaEntregaFuncionamento("estão abertos ainda?")).toBe(true);
  });

  it("NÃO detecta pedido completo com produto + pix + bairro", () => {
    expect(
      detectaPerguntaEntregaFuncionamento(
        "se sim quero 2 x-burguer e batata frita pagamento no pix entrega bairro Santa Luzia"
      )
    ).toBe(false);
  });
});

// ─── Testes de integração: resposta do bot ───────────────────────────────────

describe("pergunta sobre entrega — step name", () => {
  it("'ainda estão fazendo entrega?' → confirma entrega e mostra horário", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoName());
    expect(res.messages[0]).toContain("estamos fazendo entrega");
    expect(res.messages[0]).toContain("22h");
    expect(res.messages[0]).toContain("O que vai ser hoje");
  });

  it("'tá entregando ainda?' → responde com confirmação", () => {
    const res = processMessage("tá entregando ainda?", sessaoName());
    expect(res.messages[0]).toContain("estamos fazendo entrega");
  });

  it("'vocês fazem delivery?' → responde com confirmação", () => {
    const res = processMessage("vocês fazem delivery?", sessaoName());
    expect(res.messages[0]).toContain("estamos fazendo entrega");
  });

  it("'ainda dá pra pedir?' → responde com confirmação", () => {
    const res = processMessage("ainda dá pra pedir?", sessaoName());
    expect(res.messages[0]).toContain("estamos fazendo entrega");
  });

  it("'até que horas entrega?' → responde com horário configurado", () => {
    setHorarioFuncionamento("23h");
    const res = processMessage("até que horas entrega?", sessaoName());
    expect(res.messages[0]).toContain("23h");
  });

  it("NÃO salva a pergunta de entrega como nome do cliente", () => {
    const res = processMessage("ainda estão fazendo entrega?", sessaoName());
    expect(res.session.customerName).toBeFalsy();
  });
});

describe("pergunta sobre entrega — step category", () => {
  it("'estão funcionando?' no meio do fluxo → confirma entrega", () => {
    const res = processMessage("estão funcionando?", sessaoCategory());
    expect(res.messages[0]).toContain("estamos fazendo entrega");
  });
});

describe("pedido completo com pergunta embutida — prioriza pedido", () => {
  it("'se sim quero 2 x-burguer e batata frita pagamento pix entrega bairro Santa Luzia' → processa pedido", () => {
    const res = processMessage(
      "se sim quero 2 x-burguer e batata frita pagamento no pix entrega bairro Santa Luzia",
      sessaoName()
    );
    // Não deve responder apenas com confirmação de entrega
    expect(res.messages[0]).not.toContain("estamos fazendo entrega sim");
  });
});
