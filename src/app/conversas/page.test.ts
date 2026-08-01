import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizarConversa, normalizarTelefone, type ConversaRecente } from "./page";

// Guarda estrutural sem jsdom (mesma abordagem de src/app/rastrear/[pedidoId]/page.test.ts).
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

// Regressão: clicar em qualquer conversa selecionava TODAS visualmente e o
// painel da direita nunca abria. Causa raiz: o Upstash Redis retorna members
// de ZSET puramente numéricos (telefones) já convertidos para `number` em
// runtime — o tipo TS "string[]" do zrange() não garante isso. O helper local
// `ss()` só aceitava string, então todo `phone` numérico virava "" e
// `conversaSelecionada === c.phone` batia como true para qualquer conversa
// com phone vazio (string vazia === string vazia).
//
// Estes testes cobrem os helpers reais usados pela tela (normalizarTelefone e
// normalizarConversa), que são a camada 2 de defesa do fix.

describe("normalizarTelefone", () => {
  test("aceita number e converte para string completa (bug real do Upstash)", () => {
    expect(normalizarTelefone(5586999990001)).toBe("5586999990001");
  });

  test("aceita string e remove espaços nas pontas", () => {
    expect(normalizarTelefone("  5586999990002  ")).toBe("5586999990002");
  });

  test("nunca faz comparação parcial: preserva o telefone inteiro, sem slice/endsWith", () => {
    const longo = "5586999990003";
    expect(normalizarTelefone(Number(longo))).toBe(longo);
    expect(normalizarTelefone(longo).length).toBe(longo.length);
  });

  test("rejeita null, undefined, objeto e NaN retornando string vazia", () => {
    expect(normalizarTelefone(null)).toBe("");
    expect(normalizarTelefone(undefined)).toBe("");
    expect(normalizarTelefone({})).toBe("");
    expect(normalizarTelefone(NaN)).toBe("");
  });

  test("é estável entre chamadas sucessivas para o mesmo valor (não muda sozinho durante o polling de 8s)", () => {
    const a1 = normalizarTelefone(5586999990004);
    const a2 = normalizarTelefone(5586999990004);
    expect(a1).toBe(a2);
    expect(a1).not.toBe("");
  });
});

describe("normalizarConversa — phone", () => {
  test("phone recebido como string permanece igual", () => {
    const c = normalizarConversa({ phone: "5586999990005", nome: "Ana" });
    expect(c?.phone).toBe("5586999990005");
  });

  test("phone recebido como number (JSON.parse automático do Upstash) vira string válida, nunca ''", () => {
    const c = normalizarConversa({ phone: 5586999990006, nome: "Bruno" });
    expect(c).not.toBeNull();
    expect(c?.phone).toBe("5586999990006");
    expect(c?.phone).not.toBe("");
  });

  test("phone ausente/vazio: a conversa não é renderizada (retorna null)", () => {
    expect(normalizarConversa({ nome: "Sem telefone" })).toBeNull();
    expect(normalizarConversa({ phone: "", nome: "Vazio" })).toBeNull();
    expect(normalizarConversa({ phone: null, nome: "Nulo" })).toBeNull();
  });

  test("usa 'telefone' como fallback apenas quando 'phone' está ausente (registro antigo)", () => {
    const c = normalizarConversa({ telefone: 5586999990007, nome: "Legado" });
    expect(c?.phone).toBe("5586999990007");
  });

  test("duas conversas diferentes nunca colapsam para o mesmo phone", () => {
    const a = normalizarConversa({ phone: 5586999990008, nome: "Cliente A" });
    const b = normalizarConversa({ phone: "5586999990009", nome: "Cliente B" });
    expect(a?.phone).not.toBe(b?.phone);
    expect(a?.phone).not.toBe("");
    expect(b?.phone).not.toBe("");
  });

  test("shape final tem os campos esperados com defaults seguros", () => {
    const c = normalizarConversa({
      phone: 5586999990010,
      nome: "Carla",
      ultimaMensagem: "oi",
      ultimaTs: 123,
      status: "humano",
      mensagensCount: 4,
    }) as ConversaRecente;
    expect(c).toEqual({
      phone: "5586999990010",
      nome: "Carla",
      ultimaMensagem: "oi",
      ultimaTs: 123,
      status: "humano",
      mensagensCount: 4,
    });
  });

  test("status inválido/ausente cai em 'finalizado', nunca quebra a normalização do phone", () => {
    const c = normalizarConversa({ phone: 5586999990011, status: "bogus" });
    expect(c?.status).toBe("finalizado");
    expect(c?.phone).toBe("5586999990011");
  });
});

describe("/conversas — polling pausado com aba oculta", () => {
  test("lista de pedidos (carregar) só consulta com aba visível e limpa o listener ao desmontar", () => {
    expect(fonte).toContain("if (document.visibilityState === 'visible') carregar()");
    expect(fonte).toContain("setInterval(talvezCarregar, 15000)");
    expect(fonte).toContain("document.addEventListener('visibilitychange', talvezCarregar)");
    expect(fonte).toContain("document.removeEventListener('visibilitychange', talvezCarregar)");
  });

  test("relógio de tempo relativo (ivTime) continua rodando sempre — não é polling de rede", () => {
    expect(fonte).toContain("setInterval(() => setNow(Date.now()), 30000)");
  });

  test("conversas recentes só consultam com aba visível e limpam o listener ao desmontar", () => {
    expect(fonte).toContain("if (document.visibilityState === 'visible') carregarRecentes()");
    expect(fonte).toContain("setInterval(talvezCarregarRecentes, 8000)");
    expect(fonte).toContain("document.addEventListener('visibilitychange', talvezCarregarRecentes)");
    expect(fonte).toContain("document.removeEventListener('visibilitychange', talvezCarregarRecentes)");
  });

  test("histórico da conversa selecionada só consulta com aba visível e limpa o listener ao desmontar", () => {
    expect(fonte).toContain("if (document.visibilityState === 'visible') carregarHistorico(phone)");
    expect(fonte).toContain("setInterval(talvezCarregarHistorico, 3000)");
    expect(fonte).toContain("document.addEventListener('visibilitychange', talvezCarregarHistorico)");
    expect(fonte).toContain("document.removeEventListener('visibilitychange', talvezCarregarHistorico)");
  });
});
