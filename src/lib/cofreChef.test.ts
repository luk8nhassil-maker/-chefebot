import { describe, expect, test } from "vitest";
import {
  avaliarOfertasCofre,
  avaliarProtecaoEconomicaCofre,
  decidirProximaMelhorAcaoCofre,
  resumirComportamentoCofre,
  type ConfigComportamentalCofre,
  type ContextoClienteCofre,
  type EventoComportamentalCofre,
} from "./cofreChef";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.parse("2026-09-27T21:00:00.000Z");

const CONFIG: ConfigComportamentalCofre = {
  minPedidosParaPersonalizar: 3,
  atrasoRetornoRazaoMin: 1.5,
  ticketBaixoRazaoMax: 0.75,
};

const CONTEXTO: ContextoClienteCofre = {
  participaRanking: true,
  posicaoRanking: 8,
  estrelasDisponiveis: 30,
  estrelasConquistadasTemporada: 80,
};

function evento(diasAtras: number, valor: number, status: "entregue" | "estornado" = "entregue"): EventoComportamentalCofre {
  return {
    pedidoId: "p_" + diasAtras + "_" + valor + "_" + status,
    criadoEmMs: AGORA - diasAtras * DIA,
    valorElegivelCents: valor,
    statusAnalitico: status,
  };
}

describe("Cofre do Chefe — resumo comportamental", () => {
  test("usa só pedidos entregues positivos e calcula o padrão do próprio cliente", () => {
    const resumo = resumirComportamentoCofre([
      evento(21, 4000),
      evento(14, 5000),
      evento(7, 6000),
      evento(3, 9999, "estornado"),
      { ...evento(1, 1), valorElegivelCents: 0 },
    ], AGORA);

    expect(resumo.pedidosEntregues).toBe(3);
    expect(resumo.ticketMedianoCents).toBe(5000);
    expect(resumo.ticketMedioCents).toBe(5000);
    expect(resumo.ultimoTicketCents).toBe(6000);
    expect(resumo.diasDesdeUltimoPedido).toBe(7);
    expect(resumo.intervaloMedianoDias).toBe(7);
  });

  test("sem histórico devolve sinais nulos, nunca inventa padrão", () => {
    expect(resumirComportamentoCofre([], AGORA)).toEqual({
      pedidosEntregues: 0,
      ticketMedioCents: null,
      ticketMedianoCents: null,
      ultimoTicketCents: null,
      ultimoPedidoEmMs: null,
      diasDesdeUltimoPedido: null,
      intervaloMedianoDias: null,
    });
  });
});

describe("Cofre do Chefe — próxima melhor ação", () => {
  test("cliente fora do Ranking não entra no Cofre", () => {
    const resumo = resumirComportamentoCofre([evento(14, 5000), evento(7, 5000), evento(1, 5000)], AGORA);
    const d = decidirProximaMelhorAcaoCofre({
      contexto: { ...CONTEXTO, participaRanking: false },
      resumo,
      config: CONFIG,
    });
    expect(d.elegivel).toBe(false);
    expect(d.motivo).toBe("nao_participa_ranking");
  });

  test("com poucos dados coleta histórico em vez de oferecer desconto", () => {
    const resumo = resumirComportamentoCofre([evento(2, 5000)], AGORA);
    const d = decidirProximaMelhorAcaoCofre({ contexto: CONTEXTO, resumo, config: CONFIG });
    expect(d.acao).toBe("coletando_dados");
    expect(d.motivo).toBe("dados_insuficientes");
  });

  test("detecta atraso comparando com a própria frequência normal", () => {
    const resumo = resumirComportamentoCofre([
      evento(28, 5000),
      evento(21, 5000),
      evento(14, 5000),
    ], AGORA);
    const d = decidirProximaMelhorAcaoCofre({ contexto: CONTEXTO, resumo, config: CONFIG });
    expect(resumo.intervaloMedianoDias).toBe(7);
    expect(resumo.diasDesdeUltimoPedido).toBe(14);
    expect(d.acao).toBe("retorno");
    expect(d.motivo).toBe("atraso_vs_proprio_historico");
  });

  test("ticket recente muito abaixo do próprio padrão sugere aumentar ticket", () => {
    const resumo = resumirComportamentoCofre([
      evento(20, 8000),
      evento(12, 8000),
      evento(2, 5000),
    ], AGORA);
    const d = decidirProximaMelhorAcaoCofre({ contexto: CONTEXTO, resumo, config: CONFIG });
    expect(d.acao).toBe("aumentar_ticket");
    expect(d.motivo).toBe("ticket_recente_abaixo_do_proprio_padrao");
  });

  test("cliente normal fora do Pódio fica sem subsídio", () => {
    const resumo = resumirComportamentoCofre([
      evento(14, 5000),
      evento(7, 5200),
      evento(2, 5100),
    ], AGORA);
    const d = decidirProximaMelhorAcaoCofre({ contexto: CONTEXTO, resumo, config: CONFIG });
    expect(d.acao).toBe("sem_incentivo");
    expect(d.motivo).toBe("comportamento_normal_sem_subsidio");
  });

  test("Top 3 sem sinal comercial recebe exclusividade, não desconto obrigatório", () => {
    const resumo = resumirComportamentoCofre([
      evento(14, 5000),
      evento(7, 5200),
      evento(2, 5100),
    ], AGORA);
    const d = decidirProximaMelhorAcaoCofre({
      contexto: { ...CONTEXTO, posicaoRanking: 2 },
      resumo,
      config: CONFIG,
    });
    expect(d.acao).toBe("podio_exclusivo");
    expect(d.motivo).toBe("top3");
  });
});

describe("Cofre do Chefe — proteção econômica", () => {
  const beneficio = { tipo: "desconto_fixo" as const, valorCents: 500 };

  test("sem cobertura econômica aprovada bloqueia", () => {
    expect(avaliarProtecaoEconomicaCofre({
      beneficio,
      economia: {
        receitaElegivelCents: 6000,
        custoMercadoriaCents: 2500,
        custoVariavelCents: 500,
        margemMinimaDepoisCents: 1500,
        orcamentoRestantePeriodoCents: 10000,
        coberturaEconomicaAprovada: false,
        possuiOutraPromocao: false,
      },
    })).toEqual({ liberado: false, motivo: "cobertura_economica_nao_aprovada" });
  });

  test("sem CMV/custos oficiais bloqueia", () => {
    expect(avaliarProtecaoEconomicaCofre({
      beneficio,
      economia: {
        receitaElegivelCents: 6000,
        custoMercadoriaCents: null,
        custoVariavelCents: 500,
        margemMinimaDepoisCents: 1500,
        orcamentoRestantePeriodoCents: 10000,
        coberturaEconomicaAprovada: true,
        possuiOutraPromocao: false,
      },
    })).toEqual({ liberado: false, motivo: "dados_economicos_incompletos" });
  });

  test("benefício que derruba a margem mínima é recusado", () => {
    expect(avaliarProtecaoEconomicaCofre({
      beneficio,
      economia: {
        receitaElegivelCents: 5000,
        custoMercadoriaCents: 3000,
        custoVariavelCents: 500,
        margemMinimaDepoisCents: 1200,
        orcamentoRestantePeriodoCents: 10000,
        coberturaEconomicaAprovada: true,
        possuiOutraPromocao: false,
      },
    })).toEqual({ liberado: false, motivo: "margem_insuficiente" });
  });

  test("só libera quando cobertura, orçamento e margem estão protegidos", () => {
    expect(avaliarProtecaoEconomicaCofre({
      beneficio,
      economia: {
        receitaElegivelCents: 8000,
        custoMercadoriaCents: 3000,
        custoVariavelCents: 500,
        margemMinimaDepoisCents: 2000,
        orcamentoRestantePeriodoCents: 10000,
        coberturaEconomicaAprovada: true,
        possuiOutraPromocao: false,
      },
    })).toEqual({
      liberado: true,
      margemAntesCents: 4500,
      margemDepoisCents: 4000,
      custoBeneficioCents: 500,
    });
  });
});

describe("Cofre do Chefe — oferta configurada", () => {
  test("motor nunca inventa oferta quando não existe configuração", () => {
    const resumo = resumirComportamentoCofre([evento(28, 5000), evento(21, 5000), evento(14, 5000)], AGORA);
    const decisao = decidirProximaMelhorAcaoCofre({ contexto: CONTEXTO, resumo, config: CONFIG });

    expect(avaliarOfertasCofre({
      decisao,
      contexto: CONTEXTO,
      ofertas: [],
      subtotalElegivelCents: 8000,
      economia: {
        receitaElegivelCents: 8000,
        custoMercadoriaCents: 3000,
        custoVariavelCents: 500,
        margemMinimaDepoisCents: 2000,
        orcamentoRestantePeriodoCents: 10000,
        coberturaEconomicaAprovada: true,
        possuiOutraPromocao: false,
      },
    })).toEqual({ oferta: null, status: "sem_oferta_configurada" });
  });

  test("oferta configurada continua bloqueada sem economia oficial", () => {
    const resumo = resumirComportamentoCofre([evento(28, 5000), evento(21, 5000), evento(14, 5000)], AGORA);
    const decisao = decidirProximaMelhorAcaoCofre({ contexto: CONTEXTO, resumo, config: CONFIG });

    const resultado = avaliarOfertasCofre({
      decisao,
      contexto: CONTEXTO,
      ofertas: [{
        ofertaId: "fixture-retorno",
        ativa: true,
        acao: "retorno",
        estrelasNecessarias: 20,
        pedidoMinimoCents: 6000,
        beneficio: { tipo: "desconto_fixo", valorCents: 500 },
      }],
      subtotalElegivelCents: 8000,
      economia: {
        receitaElegivelCents: 8000,
        custoMercadoriaCents: null,
        custoVariavelCents: null,
        margemMinimaDepoisCents: null,
        orcamentoRestantePeriodoCents: null,
        coberturaEconomicaAprovada: false,
        possuiOutraPromocao: false,
      },
    });

    expect(resultado.status).toBe("bloqueada_economia");
    expect(resultado.protecaoEconomica).toEqual({
      liberado: false,
      motivo: "cobertura_economica_nao_aprovada",
    });
  });
});
