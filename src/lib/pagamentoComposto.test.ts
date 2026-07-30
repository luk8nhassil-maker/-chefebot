import { describe, test, expect } from "vitest";
import {
  emCentavos,
  parseValorMonetario,
  formatarValorPagamento,
  extrairPagamentoComposto,
  ehPagamentoComposto,
  montarPagamentoComposto,
  pagamentoAindaValido,
  normalizarPagamentoComposto,
} from "./pagamentoComposto";
import { valorPixEsperado, valorDinheiroEsperado } from "./bot";

describe("parseValorMonetario", () => {
  test("aceita vírgula decimal, símbolo monetário e espaços", () => {
    expect(parseValorMonetario("R$ 30,50")).toBe(30.5);
    expect(parseValorMonetario(" 30,50 ")).toBe(30.5);
  });

  test("aceita ponto decimal de registros legados", () => {
    expect(parseValorMonetario("30.00")).toBe(30);
    expect(parseValorMonetario("30.5")).toBe(30.5);
  });

  test("trata ponto seguido de 3 dígitos como separador de milhar", () => {
    expect(parseValorMonetario("1.234")).toBe(1234);
    expect(parseValorMonetario("1.234.567")).toBe(1234567);
  });

  test("com vírgula presente, todo ponto é milhar", () => {
    expect(parseValorMonetario("1.234,56")).toBe(1234.56);
  });

  test("nunca lança: entrada inválida devolve null", () => {
    expect(parseValorMonetario("")).toBeNull();
    expect(parseValorMonetario("abc")).toBeNull();
    expect(parseValorMonetario(null)).toBeNull();
    expect(parseValorMonetario(undefined)).toBeNull();
    expect(parseValorMonetario({} as unknown as string)).toBeNull();
  });

  test("número finito passa direto; NaN/Infinity viram null", () => {
    expect(parseValorMonetario(12.34)).toBe(12.34);
    expect(parseValorMonetario(NaN)).toBeNull();
    expect(parseValorMonetario(Infinity)).toBeNull();
  });
});

describe("emCentavos", () => {
  test("converte por arredondamento, sem erro de ponto flutuante", () => {
    expect(emCentavos(0.1) + emCentavos(0.2)).toBe(emCentavos(0.3));
    expect(emCentavos(19.99)).toBe(1999);
  });
});

describe("extrairPagamentoComposto", () => {
  test("lê a forma canônica com vírgula", () => {
    expect(extrairPagamentoComposto("Pix (R$ 30,00) + Dinheiro (R$ 20,00)")).toEqual({
      pix: 30,
      dinheiro: 20,
    });
  });

  test("lê a forma legada com ponto decimal (registros já gravados)", () => {
    expect(extrairPagamentoComposto("Pix (R$ 30.00) + Dinheiro (R$ 20.00)")).toEqual({
      pix: 30,
      dinheiro: 20,
    });
  });

  test("devolve null para pagamento simples ou ausente", () => {
    expect(extrairPagamentoComposto("Pix")).toBeNull();
    expect(extrairPagamentoComposto("Dinheiro")).toBeNull();
    expect(extrairPagamentoComposto("")).toBeNull();
    expect(extrairPagamentoComposto(null)).toBeNull();
    expect(extrairPagamentoComposto(undefined)).toBeNull();
  });

  test("regex ancorada: não reconhece a forma dentro de um texto maior", () => {
    expect(extrairPagamentoComposto("pagou com Pix (R$ 30,00) + Dinheiro (R$ 20,00) ontem")).toBeNull();
  });

  test("ehPagamentoComposto acompanha o parse", () => {
    expect(ehPagamentoComposto("Pix (R$ 1,00) + Dinheiro (R$ 2,00)")).toBe(true);
    expect(ehPagamentoComposto("Cartao")).toBe(false);
  });
});

describe("montarPagamentoComposto", () => {
  test("devolve a string canônica quando a soma fecha", () => {
    const r = montarPagamentoComposto("30,00", "20,00", 50);
    expect(r).toEqual({ ok: true, valor: "Pix (R$ 30,00) + Dinheiro (R$ 20,00)" });
  });

  test("aceita a tolerância de um centavo", () => {
    const r = montarPagamentoComposto("30,00", "20,00", 50.01);
    expect(r.ok).toBe(true);
  });

  test("recusa quando a soma diverge do total", () => {
    const r = montarPagamentoComposto("30,00", "20,00", 35);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("R$ 35,00");
  });

  test("recusa parte zerada — pagamento composto exige as duas formas", () => {
    expect(montarPagamentoComposto("50,00", "0", 50).ok).toBe(false);
    expect(montarPagamentoComposto("0", "50,00", 50).ok).toBe(false);
  });

  test("recusa valores negativos e entrada ilegível", () => {
    expect(montarPagamentoComposto("-10,00", "60,00", 50).ok).toBe(false);
    expect(montarPagamentoComposto("abc", "20,00", 50).ok).toBe(false);
  });

  test("recusa total não finito em vez de gravar uma string inconsistente", () => {
    expect(montarPagamentoComposto("30,00", "20,00", NaN).ok).toBe(false);
  });

  test("a saída canônica é relegível pelo próprio parser (ida e volta)", () => {
    const r = montarPagamentoComposto("1.234,56", "765,44", 2000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(extrairPagamentoComposto(r.valor)).toEqual({ pix: 1234.56, dinheiro: 765.44 });
  });
});

describe("pagamentoAindaValido", () => {
  test("pagamento simples é sempre válido — não há soma a conferir", () => {
    expect(pagamentoAindaValido("Pix", 50)).toBe(true);
    expect(pagamentoAindaValido("Dinheiro", 12.3)).toBe(true);
    expect(pagamentoAindaValido(undefined, 50)).toBe(true);
  });

  test("composto que fecha com o total atual continua válido", () => {
    expect(pagamentoAindaValido("Pix (R$ 30,00) + Dinheiro (R$ 20,00)", 50)).toBe(true);
  });

  test("composto deixa de valer quando o total muda na edição", () => {
    // Cenário real: pedido de R$ 50 pago metade Pix / metade dinheiro; o
    // cliente remove um item na edição e o total cai para R$ 35.
    expect(pagamentoAindaValido("Pix (R$ 30,00) + Dinheiro (R$ 20,00)", 35)).toBe(false);
  });

  test("total não finito nunca é aceito como válido", () => {
    expect(pagamentoAindaValido("Pix (R$ 30,00) + Dinheiro (R$ 20,00)", NaN)).toBe(false);
  });
});

describe("normalizarPagamentoComposto", () => {
  test("corrige a grafia legada com ponto decimal", () => {
    expect(normalizarPagamentoComposto("Pix (R$ 30.00) + Dinheiro (R$ 20.00)")).toBe(
      "Pix (R$ 30,00) + Dinheiro (R$ 20,00)"
    );
  });

  test("pagamento simples passa intacto", () => {
    expect(normalizarPagamentoComposto("Cartao")).toBe("Cartao");
    expect(normalizarPagamentoComposto(null)).toBeNull();
  });
});

describe("compatibilidade com os helpers centralizados de src/lib/bot.ts", () => {
  test("a saída canônica é lida pelos mesmos valores por valorPixEsperado/valorDinheiroEsperado", () => {
    const r = montarPagamentoComposto("30,00", "20,00", 50);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(valorPixEsperado(r.valor, 50)).toBe(30);
    expect(valorDinheiroEsperado(r.valor, 50)).toBe(20);
  });

  test("a grafia legada com ponto era lida como milhar pelo bot — normalizar corrige", () => {
    const legado = "Pix (R$ 30.00) + Dinheiro (R$ 20.00)";
    // Comportamento pré-existente registrado aqui de propósito: é a razão de
    // a montagem da string ter deixado de ser responsabilidade da interface.
    expect(valorPixEsperado(legado, 50)).toBe(3000);

    const corrigido = normalizarPagamentoComposto(legado)!;
    expect(valorPixEsperado(corrigido, 50)).toBe(30);
    expect(valorDinheiroEsperado(corrigido, 50)).toBe(20);
  });

  test("formatarValorPagamento produz a grafia que o bot sabe ler", () => {
    expect(formatarValorPagamento(1234.5)).toBe("R$ 1234,50");
    expect(valorPixEsperado(`Pix (${formatarValorPagamento(1234.5)})`, 0)).toBe(1234.5);
  });
});
