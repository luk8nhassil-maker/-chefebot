import { describe, expect, test } from "vitest";
import {
  calcularAlvoRankingAtual,
  detectarConquistaRanking,
  detectarCreditoDoPedido,
  detectarFatosDePosicao,
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

describe("detectarCreditoDoPedido (feedback pós-pedido, correção do #445)", () => {
  test("reconhece o crédito confirmado do pedido exato", () => {
    const extrato = [{ pedidoId: "ped_123", tipo: "confirmado", pontos: 5 }];
    expect(detectarCreditoDoPedido(extrato, "ped_123")).toEqual({ pontos: 5 });
  });

  test("nunca atribui ao pedido atual o crédito de OUTRO pedido, mesmo recente", () => {
    const extrato = [{ pedidoId: "ped_outro", tipo: "confirmado", pontos: 99 }];
    expect(detectarCreditoDoPedido(extrato, "ped_123")).toBeNull();
  });

  test("nunca atribui crédito de indicação/apoio ao pedido atual (pedidoId diferente)", () => {
    // Crédito de indicação carrega o pedidoId do AMIGO indicado, não do
    // pedido do indicador — mesmo estando no extrato do indicador, não deve
    // ser confundido com o crédito do pedido que trouxe o indicador aqui.
    const extrato = [
      { pedidoId: "ped_do_amigo", tipo: "confirmado", pontos: 6 },
      { pedidoId: "ped_123", tipo: "confirmado", pontos: 5 },
    ];
    expect(detectarCreditoDoPedido(extrato, "ped_123")).toEqual({ pontos: 5 });
  });

  test("nunca promete crédito antes da confirmação — movimento 'previsto' não conta", () => {
    const extrato = [{ pedidoId: "ped_123", tipo: "previsto", pontos: 5 }];
    expect(detectarCreditoDoPedido(extrato, "ped_123")).toBeNull();
  });

  test("sem pedidoId conhecido, nunca inventa crédito", () => {
    const extrato = [{ pedidoId: "ped_123", tipo: "confirmado", pontos: 5 }];
    expect(detectarCreditoDoPedido(extrato, null)).toBeNull();
    expect(detectarCreditoDoPedido(extrato, undefined)).toBeNull();
    expect(detectarCreditoDoPedido(extrato, "")).toBeNull();
  });

  test("extrato vazio nunca inventa crédito", () => {
    expect(detectarCreditoDoPedido([], "ped_123")).toBeNull();
  });
});

describe("detectarFatosDePosicao (fatos server-side, correção do #445)", () => {
  test("sem histórico anterior, nunca inventa fato", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: null, posicaoAtual: 5, jaFoiLiderNestaTemporada: false })).toEqual([]);
    expect(detectarFatosDePosicao({ posicaoAnterior: undefined, posicaoAtual: 5, jaFoiLiderNestaTemporada: false })).toEqual([]);
  });

  test("manteve a posição não gera fato nenhum", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 5, posicaoAtual: 5, jaFoiLiderNestaTemporada: false })).toEqual([]);
  });

  test("subida simples (sem cruzar Top 10/Top 3) só gera subiu_posicao", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 30, posicaoAtual: 25, jaFoiLiderNestaTemporada: false })).toEqual(["subiu_posicao"]);
  });

  test("subida que cruza para o Top 10 gera os dois fatos", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 12, posicaoAtual: 8, jaFoiLiderNestaTemporada: false })).toEqual([
      "subiu_posicao",
      "entrou_top10",
    ]);
  });

  test("subida que cruza direto para o Top 3 gera subiu + top10 + top3", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 12, posicaoAtual: 2, jaFoiLiderNestaTemporada: false })).toEqual([
      "subiu_posicao",
      "entrou_top10",
      "entrou_top3",
    ]);
  });

  test("já estava no Top 10 e subiu para o Top 3 não repete entrou_top10", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 7, posicaoAtual: 2, jaFoiLiderNestaTemporada: false })).toEqual([
      "subiu_posicao",
      "entrou_top3",
    ]);
  });

  test("chegou ao #1 pela primeira vez, vindo de fora do Top 10", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 15, posicaoAtual: 1, jaFoiLiderNestaTemporada: false })).toEqual([
      "subiu_posicao",
      "entrou_top10",
      "entrou_top3",
      "chegou_top1",
    ]);
  });

  test("já estava no Top 3 (posição #2) e assumiu o #1 pela primeira vez", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 2, posicaoAtual: 1, jaFoiLiderNestaTemporada: false })).toEqual([
      "subiu_posicao",
      "chegou_top1",
    ]);
  });

  test("recuperou a liderança (já tinha sido #1 antes nesta temporada), vindo de fora do Top 10", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 15, posicaoAtual: 1, jaFoiLiderNestaTemporada: true })).toEqual([
      "subiu_posicao",
      "entrou_top10",
      "entrou_top3",
      "recuperou_lideranca",
    ]);
  });

  test("perdeu a liderança", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 1, posicaoAtual: 2, jaFoiLiderNestaTemporada: true })).toEqual(["perdeu_lideranca"]);
  });

  test("desceu sem ter sido líder não gera fato nenhum (nunca linguagem punitiva)", () => {
    expect(detectarFatosDePosicao({ posicaoAnterior: 5, posicaoAtual: 8, jaFoiLiderNestaTemporada: false })).toEqual([]);
  });
});
