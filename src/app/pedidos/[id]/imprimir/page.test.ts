import { describe, test, expect } from "vitest";
import { numeroCupomExibicao, numeroDiarioCupom } from "./page";

// Regressão: dois pedidos DIFERENTES (delivery, retirada e consumo no local
// misturados no mesmo dia) saíram impressos com o mesmo "PEDIDO #8" — a
// numeração do cupom priorizava um índice recalculado por posição na lista
// (numeroDiarioCupom), que muda conforme pedidos são arquivados/cancelados
// entre uma impressão e outra, em vez do `numero` atômico e estável
// atribuído na criação (proximoNumeroPedido, ver src/lib/numeracao.ts).

type Pedido = Parameters<typeof numeroDiarioCupom>[0];

function pedido(overrides: Partial<Pedido> & { id: string }): Pedido {
  return {
    cliente: "Cliente Teste",
    telefone: "86999998888",
    itens: ["1x Pizza"],
    total: 50,
    status: "novo",
    horario: "20:00",
    endereco: "Retirada na loja",
    ...overrides,
  };
}

describe("numeroCupomExibicao — pedido.numero é sempre a fonte da verdade", () => {
  test("com numero definido, usa ele direto — ignora completamente a posição na lista", () => {
    const p = pedido({ id: "1785900000000", numero: 8 });
    // Lista vazia, ou com o próprio pedido em posições diferentes — não importa.
    expect(numeroCupomExibicao(p, [p])).toBe("#8");
    expect(numeroCupomExibicao(p, [])).toBe("#8");
  });

  test("dois pedidos DIFERENTES no mesmo dia, com numero diferentes, nunca colidem — mesmo que a posição na lista coincida", () => {
    const kaylane = pedido({ id: "1785900000001", numero: 8 });
    const wesley = pedido({ id: "1785900000002", numero: 9 });

    // Simula exatamente o bug do relato: a lista muda entre as duas
    // impressões (um pedido mais antigo some da lista ativa, ex.: foi
    // arquivado), então a posição de "wesley" recalculada por
    // numeroDiarioCupom também daria 8 se dependêssemos dela.
    const listaNaPrimeiraImpressao = [kaylane];
    const listaNaSegundaImpressao = [wesley]; // kaylane já não está mais na lista ativa

    expect(numeroCupomExibicao(kaylane, listaNaPrimeiraImpressao)).toBe("#8");
    expect(numeroCupomExibicao(wesley, listaNaSegundaImpressao)).toBe("#9");
  });

  test("sem numero, cai no cálculo por posição (comportamento antigo preservado para pedidos legados)", () => {
    const a = pedido({ id: "1785900000001" });
    const b = pedido({ id: "1785900000002" });
    const lista = [a, b];
    expect(numeroCupomExibicao(a, lista)).toBe("#1");
    expect(numeroCupomExibicao(b, lista)).toBe("#2");
  });

  test("sem numero e sem id parseável como timestamp, cai no id curto", () => {
    const p = pedido({ id: "id-nao-numerico" });
    expect(numeroCupomExibicao(p, [p])).toBe(`#${p.id.slice(-6).toUpperCase()}`);
  });

  test("numero=0 não é tratado como ausente (usa != null, não truthy)", () => {
    const p = pedido({ id: "1785900000001", numero: 0 });
    expect(numeroCupomExibicao(p, [p])).toBe("#0");
  });
});

describe("numeroDiarioCupom — mantido só como fallback, comportamento inalterado", () => {
  test("posição é 1-indexed, ordenada pelo timestamp do id", () => {
    const a = pedido({ id: "1785900000003" });
    const b = pedido({ id: "1785900000001" });
    const c = pedido({ id: "1785900000002" });
    const lista = [a, b, c];
    expect(numeroDiarioCupom(b, lista).diario).toBe(1);
    expect(numeroDiarioCupom(c, lista).diario).toBe(2);
    expect(numeroDiarioCupom(a, lista).diario).toBe(3);
  });

  test("só conta pedidos do mesmo dia (fuso America/Sao_Paulo)", () => {
    const hoje = pedido({ id: "1785900000001" });
    const outroDia = pedido({ id: "1700000000000" });
    const lista = [hoje, outroDia];
    expect(numeroDiarioCupom(hoje, lista).diario).toBe(1);
  });

  test("id não numérico devolve diario null", () => {
    const p = pedido({ id: "abc" });
    expect(numeroDiarioCupom(p, [p]).diario).toBeNull();
  });
});
