import { describe, expect, test } from "vitest";
import {
  calcularAlvoRankingAtual,
  detectarConquistaRanking,
  detectarCreditoRecente,
  mensagemAlvoRanking,
  mensagemMovimento,
  montarDisputaRelativa,
  necessarioParaUltrapassar,
  textoConquistaRanking,
} from "./rankingRetencao";

describe("necessarioParaUltrapassar", () => {
  test("score estritamente menor precisa da diferença + 1", () => {
    expect(necessarioParaUltrapassar(20, 22)).toBe(3);
  });

  test("empate de score ainda exige 1 estrela (desempate mantém quem chegou primeiro)", () => {
    expect(necessarioParaUltrapassar(20, 20)).toBe(1);
  });

  test("nunca retorna negativo quando já está acima", () => {
    expect(necessarioParaUltrapassar(25, 20)).toBe(0);
  });

  test("trata valores não finitos como zero, sem lançar", () => {
    expect(necessarioParaUltrapassar(Number.NaN, 10)).toBe(11);
  });
});

describe("calcularAlvoRankingAtual", () => {
  test("único participante retorna estado sozinho", () => {
    expect(
      calcularAlvoRankingAtual({
        posicaoAtual: 1,
        scoreAtual: 10,
        totalParticipantes: 1,
        entradaAcima: null,
        entradaAbaixo: null,
      }),
    ).toEqual({ estado: "sozinho" });
  });

  test("posição 1 com alguém abaixo retorna liderando com vantagem real", () => {
    const alvo = calcularAlvoRankingAtual({
      posicaoAtual: 1,
      scoreAtual: 30,
      totalParticipantes: 5,
      entradaAcima: null,
      entradaAbaixo: { posicao: 2, score: 22 },
    });
    expect(alvo).toEqual({ estado: "liderando", vantagem: 8 });
  });

  test("último colocado (sem ninguém abaixo) ainda calcula alvo para alcançar quem está acima", () => {
    const alvo = calcularAlvoRankingAtual({
      posicaoAtual: 5,
      scoreAtual: 10,
      totalParticipantes: 5,
      entradaAcima: { posicao: 4, score: 14 },
      entradaAbaixo: null,
    });
    expect(alvo).toEqual({ estado: "alcancar", alvoPosicao: 4, necessario: 5, scoreAlvo: 14 });
  });

  test("empate de score com quem está acima exige só 1 estrela para ultrapassar", () => {
    const alvo = calcularAlvoRankingAtual({
      posicaoAtual: 3,
      scoreAtual: 20,
      totalParticipantes: 5,
      entradaAcima: { posicao: 2, score: 20 },
      entradaAbaixo: { posicao: 4, score: 15 },
    });
    expect(alvo).toEqual({ estado: "alcancar", alvoPosicao: 2, necessario: 1, scoreAlvo: 20 });
  });
});

describe("montarDisputaRelativa", () => {
  const ordenados = [
    { posicao: 1, score: 30, clienteId: "ana" },
    { posicao: 2, score: 25, clienteId: "voce" },
    { posicao: 3, score: 20, clienteId: "carlos" },
  ];
  const identidades = new Map([
    ["ana", { nomePublico: "Ana", telefoneMascarado: null }],
    ["carlos", { nomePublico: null, telefoneMascarado: "(11) 9****-1234" }],
  ]);

  test("monta acima/você/abaixo com identidades projetadas", () => {
    const disputa = montarDisputaRelativa({ ordenados, clienteId: "voce", identidades });
    expect(disputa).toEqual({
      acima: { posicao: 1, score: 30, eVoce: false, nomePublico: "Ana", telefoneMascarado: null },
      voce: { posicao: 2, score: 25, eVoce: true, nomePublico: null, telefoneMascarado: null },
      abaixo: { posicao: 3, score: 20, eVoce: false, nomePublico: null, telefoneMascarado: "(11) 9****-1234" },
      sozinho: false,
    });
  });

  test("líder não tem ninguém acima", () => {
    const disputa = montarDisputaRelativa({ ordenados, clienteId: "ana", identidades });
    expect(disputa?.acima).toBeNull();
    expect(disputa?.abaixo?.posicao).toBe(2);
  });

  test("último colocado não tem ninguém abaixo", () => {
    const disputa = montarDisputaRelativa({ ordenados, clienteId: "carlos", identidades });
    expect(disputa?.abaixo).toBeNull();
    expect(disputa?.acima?.posicao).toBe(2);
  });

  test("participante anônimo não é inventado — sem identidade cai em null", () => {
    const disputa = montarDisputaRelativa({ ordenados, clienteId: "voce", identidades: new Map() });
    expect(disputa?.voce.nomePublico).toBeNull();
    expect(disputa?.acima?.nomePublico).toBeNull();
  });

  test("único participante marca sozinho e sem vizinhos", () => {
    const disputa = montarDisputaRelativa({
      ordenados: [{ posicao: 1, score: 5, clienteId: "voce" }],
      clienteId: "voce",
      identidades: new Map(),
    });
    expect(disputa).toEqual({
      acima: null,
      voce: { posicao: 1, score: 5, eVoce: true, nomePublico: null, telefoneMascarado: null },
      abaixo: null,
      sozinho: true,
    });
  });

  test("cliente fora da lista de participantes retorna null", () => {
    expect(montarDisputaRelativa({ ordenados, clienteId: "fantasma", identidades })).toBeNull();
  });
});

describe("mensagemAlvoRanking", () => {
  test("sozinho", () => {
    expect(mensagemAlvoRanking({ estado: "sozinho" })).toMatch(/único participante/);
  });

  test("liderando com vantagem", () => {
    expect(mensagemAlvoRanking({ estado: "liderando", vantagem: 5 })).toBe(
      "Você está na liderança, 5 estrelas à frente do #2.",
    );
  });

  test("liderando com vantagem singular", () => {
    expect(mensagemAlvoRanking({ estado: "liderando", vantagem: 1 })).toBe(
      "Você está na liderança, 1 estrela à frente do #2.",
    );
  });

  test("liderando sem ninguém abaixo (sem vantagem calculável)", () => {
    expect(mensagemAlvoRanking({ estado: "liderando", vantagem: null })).toMatch(/defender a posição/);
  });

  test("alcançar com concordância verbal e plural corretos", () => {
    expect(mensagemAlvoRanking({ estado: "alcancar", alvoPosicao: 7, necessario: 1, scoreAlvo: 20 })).toBe(
      "Falta 1 estrela para alcançar o #7.",
    );
    expect(mensagemAlvoRanking({ estado: "alcancar", alvoPosicao: 7, necessario: 4, scoreAlvo: 20 })).toBe(
      "Faltam 4 estrelas para alcançar o #7.",
    );
  });
});

describe("mensagemMovimento", () => {
  test("sem histórico não inventa frase", () => {
    expect(mensagemMovimento(null)).toBeNull();
  });

  test("manteve não gera mensagem (nada para destacar)", () => {
    expect(mensagemMovimento({ direcao: "manteve", casas: 0 })).toBeNull();
  });

  test("subiu é neutro/positivo", () => {
    expect(mensagemMovimento({ direcao: "subiu", casas: 2 })).toBe("Você subiu 2 posições desde ontem.");
  });

  test("desceu nunca usa linguagem humilhante", () => {
    const texto = mensagemMovimento({ direcao: "desceu", casas: 1 });
    expect(texto).toBe("A disputa mudou. Você está 1 posição abaixo de ontem.");
    expect(texto?.toLowerCase()).not.toMatch(/perdeu|caiu feio|humilha/);
  });
});

describe("detectarConquistaRanking / textoConquistaRanking", () => {
  test("só é conquista quando há subida real — estar parado no #1 não dispara o banner toda vez", () => {
    expect(detectarConquistaRanking({ posicao: 1, variacao: null })).toBeNull();
    expect(detectarConquistaRanking({ posicao: 1, variacao: { direcao: "manteve", casas: 0 } })).toBeNull();
  });

  test("top1/top3/top10 só contam quando a variação real é 'subiu'", () => {
    expect(detectarConquistaRanking({ posicao: 1, variacao: { direcao: "subiu", casas: 2 } })).toEqual({ tipo: "top1" });
    expect(detectarConquistaRanking({ posicao: 3, variacao: { direcao: "subiu", casas: 1 } })).toEqual({ tipo: "top3" });
    expect(detectarConquistaRanking({ posicao: 9, variacao: { direcao: "subiu", casas: 4 } })).toEqual({ tipo: "top10" });
  });

  test("estar parado (sem subir) no Top 3/Top 10 nunca gera conquista fictícia", () => {
    expect(detectarConquistaRanking({ posicao: 3, variacao: { direcao: "manteve", casas: 0 } })).toBeNull();
    expect(detectarConquistaRanking({ posicao: 9, variacao: null })).toBeNull();
  });

  test("fora do top10 só é conquista se subiu de fato", () => {
    expect(detectarConquistaRanking({ posicao: 15, variacao: { direcao: "subiu", casas: 3 } })).toEqual({
      tipo: "subiu",
      casas: 3,
    });
    expect(detectarConquistaRanking({ posicao: 15, variacao: { direcao: "manteve", casas: 0 } })).toBeNull();
    expect(detectarConquistaRanking({ posicao: 15, variacao: null })).toBeNull();
  });

  test("texto de compartilhamento nunca inclui PII de terceiros", () => {
    const texto = textoConquistaRanking({ tipo: "top3" }, 2);
    expect(texto).not.toMatch(/\d{2}\)\s?9/); // sem telefone
    expect(texto).toContain("#2");
  });

  test("sem conquista ainda gera texto neutro com a posição", () => {
    expect(textoConquistaRanking(null, 12)).toBe("Estou em #12 no Ranking do Chefe ⭐");
  });
});

describe("detectarCreditoRecente (feedback pós-pedido)", () => {
  const AGORA = new Date("2026-09-25T12:00:00.000Z").getTime();

  test("reconhece um movimento confirmado dentro da janela de recência", () => {
    const extrato = [
      { tipo: "confirmado", pontos: 5, criadoEm: new Date(AGORA - 60_000).toISOString() },
    ];
    expect(detectarCreditoRecente(extrato, AGORA)).toEqual({ pontos: 5 });
  });

  test("nunca promete crédito antes da confirmação — movimento 'previsto' não conta", () => {
    const extrato = [
      { tipo: "previsto", pontos: 5, criadoEm: new Date(AGORA - 60_000).toISOString() },
    ];
    expect(detectarCreditoRecente(extrato, AGORA)).toBeNull();
  });

  test("movimento confirmado antigo (fora da janela) não dispara o feedback", () => {
    const extrato = [
      { tipo: "confirmado", pontos: 5, criadoEm: new Date(AGORA - 60 * 60_000).toISOString() },
    ];
    expect(detectarCreditoRecente(extrato, AGORA)).toBeNull();
  });

  test("extrato vazio nunca inventa crédito", () => {
    expect(detectarCreditoRecente([], AGORA)).toBeNull();
  });
});
