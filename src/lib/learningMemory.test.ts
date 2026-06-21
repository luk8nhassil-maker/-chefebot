import { vi, describe, it, expect, beforeEach } from "vitest";

// Redis em memória, para testar o round-trip de persistência da memória.
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    del: vi.fn(async (k: string) => { store.delete(k); }),
  },
}));

import {
  resumirCasoParaAprendizado,
  salvarCasoResolvido,
  buscarCasosParecidos,
  avaliarResultadoDaRetomada,
  registrarCasoPendente,
  consumirCasoPendente,
  redigirTexto,
  anonimizarConversaId,
  type CasoResolvido,
} from "./learningMemory";

beforeEach(() => { store.clear(); });

function base(over: Partial<Parameters<typeof resumirCasoParaAprendizado>[0]> = {}) {
  return resumirCasoParaAprendizado({
    conversaId: "5531999998888",
    path: "BECO",
    step: "payment",
    mensagemCliente: "como assim?",
    respostaIA: "Qual a forma de pagamento?",
    ...over,
  });
}

// ─── Persistência não envolve nem altera sessão ───────────────────────────────
describe("salvar caso sem alterar sessão / entrada", () => {
  it("resumir não muta o carrinho recebido", () => {
    const cart = [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", price: 50 }];
    const snap = JSON.parse(JSON.stringify(cart));
    resumirCasoParaAprendizado({ conversaId: "x", path: "BECO", step: "payment", mensagemCliente: "?", carrinho: cart, respostaIA: "ok" });
    expect(cart).toEqual(snap);
  });

  it("salvarCasoResolvido persiste no banco (sem sessão)", async () => {
    await salvarCasoResolvido(base({ resultado: "CLIENTE_CONTINUOU" }));
    const banco = store.get("memoria_conversao:casos") as CasoResolvido[];
    expect(banco).toHaveLength(1);
    expect(banco[0].resultado).toBe("CLIENTE_CONTINUOU");
  });
});

// ─── Não guarda preço inventado como regra ────────────────────────────────────
describe("não guarda preço como regra", () => {
  it("redige R$ e 'reais' na resposta da IA", () => {
    const caso = base({ respostaIA: "Fica R$ 50, fechado? São 50 reais no total" });
    expect(caso.respostaIA).not.toMatch(/r\$/i);
    expect(caso.respostaIA).not.toMatch(/\b50\b/);
    expect(caso.respostaIA).toContain("[valor]");
  });

  it("carrinhoResumo não inclui preços", () => {
    const caso = base({ carrinho: [{ name: "Pizza", size: "G", flavor: "Calabresa" }] });
    expect(caso.carrinhoResumo).not.toMatch(/r\$/i);
    expect(caso.carrinhoResumo).toContain("Pizza");
  });
});

// ─── Não guarda dados sensíveis desnecessários ────────────────────────────────
describe("não guarda dados sensíveis", () => {
  it("anonimiza o telefone (não guarda número completo)", () => {
    const caso = base({ conversaId: "5531999998888" });
    expect(caso.conversaId).toBe("***8888");
    expect(caso.conversaId).not.toContain("5531999998888");
  });

  it("redige número de telefone dentro da mensagem", () => {
    const caso = base({ step: "payment", mensagemCliente: "me liga no 5531999998888 por favor" });
    expect(caso.mensagemCliente).not.toContain("5531999998888");
    expect(caso.mensagemCliente).toContain("[numero]");
  });

  it("omite a mensagem na etapa de endereço (não guarda endereço completo)", () => {
    const caso = base({ step: "address", mensagemCliente: "Rua das Flores 123, Centro, casa azul" });
    expect(caso.mensagemCliente).not.toContain("Flores");
    expect(caso.mensagemCliente).not.toContain("Centro");
  });

  it("não cria campos de endereço/comprovante/PII no caso", () => {
    const chaves = Object.keys(base());
    for (const proibida of ["address", "endereco", "comprovante", "telefone", "cpf"]) {
      expect(chaves).not.toContain(proibida);
    }
  });
});

// ─── Classificação do resultado da retomada ───────────────────────────────────
describe("avaliarResultadoDaRetomada", () => {
  it("pedido fechado → RECUPEROU_VENDA", () => {
    expect(avaliarResultadoDaRetomada({ pedidoFechado: true })).toBe("RECUPEROU_VENDA");
  });
  it("cliente continuou o fluxo → CLIENTE_CONTINUOU", () => {
    expect(avaliarResultadoDaRetomada({ continuou: true })).toBe("CLIENTE_CONTINUOU");
    expect(avaliarResultadoDaRetomada({ stepAntes: "payment", stepDepois: "confirm" })).toBe("CLIENTE_CONTINUOU");
  });
  it("cliente abandonou → CLIENTE_ABANDONOU", () => {
    expect(avaliarResultadoDaRetomada({ abandonou: true })).toBe("CLIENTE_ABANDONOU");
  });
  it("precisou de humano → PRECISOU_HUMANO", () => {
    expect(avaliarResultadoDaRetomada({ precisouHumano: true })).toBe("PRECISOU_HUMANO");
  });
  it("prioriza venda fechada sobre abandono", () => {
    expect(avaliarResultadoDaRetomada({ pedidoFechado: true, abandonou: true })).toBe("RECUPEROU_VENDA");
  });
});

// ─── Busca por path, step e tags ──────────────────────────────────────────────
describe("buscarCasosParecidos", () => {
  it("encontra e prioriza por path, step e tags", async () => {
    await salvarCasoResolvido(base({ conversaId: "a", path: "BECO", step: "payment", faltas: ["forma de pagamento"], resultado: "RECUPEROU_VENDA", carrinho: [{ name: "Pizza" }] }));
    await salvarCasoResolvido(base({ conversaId: "b", path: "SAIDA", step: "confirm", resultado: "CLIENTE_CONTINUOU" }));
    await salvarCasoResolvido(base({ conversaId: "c", path: "BECO", step: "neighborhood", resultado: "CLIENTE_ABANDONOU" }));

    const res = await buscarCasosParecidos({ path: "BECO", step: "payment", tags: ["falta:forma_de_pagamento"] });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].path).toBe("BECO");
    expect(res[0].step).toBe("payment");
  });

  it("ignora casos pendentes", async () => {
    await salvarCasoResolvido(base({ resultado: "PENDENTE" }));
    const res = await buscarCasosParecidos({ path: "BECO", step: "payment" });
    expect(res).toHaveLength(0);
  });
});

// ─── Ciclo do caso pendente ───────────────────────────────────────────────────
describe("ciclo do caso pendente", () => {
  it("registra e consome o pendente uma única vez", async () => {
    await registrarCasoPendente("5531999998888", base({ resultado: "PENDENTE" }));
    const lido = await consumirCasoPendente("5531999998888");
    expect(lido?.path).toBe("BECO");
    const lido2 = await consumirCasoPendente("5531999998888");
    expect(lido2).toBeNull();
  });
});

// ─── Não chama IA / rede só para salvar memória ───────────────────────────────
describe("memória não usa IA nem rede", () => {
  it("nenhuma operação de memória chama fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("rede não deve ser chamada pela memória");
    });
    const caso = base({ resultado: "CLIENTE_CONTINUOU" });
    await salvarCasoResolvido(caso);
    await buscarCasosParecidos({ path: "BECO" });
    await registrarCasoPendente("x", caso);
    await consumirCasoPendente("x");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ─── Utilitários de sanitização ───────────────────────────────────────────────
describe("sanitização", () => {
  it("redigirTexto trunca textos longos", () => {
    expect(redigirTexto("a".repeat(500), 200).length).toBeLessThanOrEqual(201);
  });
  it("anonimizarConversaId mascara telefone para os 4 últimos dígitos", () => {
    expect(anonimizarConversaId("5531999998888")).toBe("***8888");
  });
});
