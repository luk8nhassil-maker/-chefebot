// Cofre do Chefe — núcleo puro da estratégia de cupons por comportamento.
//
// IMPORTANTE:
// - não lê/escreve Redis;
// - não aplica desconto;
// - não altera pedido, Pix, estoque, fidelidade ou Ranking;
// - não possui valores comerciais padrão;
// - toda regra econômica é fail-closed: sem custo/margem/orçamento aprovados,
//   o resultado é sempre BLOQUEADO.
//
// A integração real, quando for aprovada, deve reutilizar o ledger
// fidelidade:pontos:* para saldo disponível e manter o Ranking baseado em
// Estrelas conquistadas, sem reduzir score por resgate.

export type EventoComportamentalCofre = {
  pedidoId: string;
  criadoEmMs: number;
  valorElegivelCents: number;
  statusAnalitico: "entregue" | "estornado";
};

export type ResumoComportamentalCofre = {
  pedidosEntregues: number;
  ticketMedioCents: number | null;
  ticketMedianoCents: number | null;
  ultimoTicketCents: number | null;
  ultimoPedidoEmMs: number | null;
  diasDesdeUltimoPedido: number | null;
  intervaloMedianoDias: number | null;
};

export type ConfigComportamentalCofre = {
  /** Quantidade mínima de pedidos entregues para personalização por histórico. */
  minPedidosParaPersonalizar: number;
  /** Ex.: 1.5 significa considerar atraso quando passou 150% do intervalo normal do próprio cliente. */
  atrasoRetornoRazaoMin: number;
  /** Ex.: 0.75 significa ticket recente <= 75% da mediana do próprio cliente. */
  ticketBaixoRazaoMax: number;
};

export type AcaoComercialCofre =
  | "coletando_dados"
  | "sem_incentivo"
  | "retorno"
  | "aumentar_ticket"
  | "podio_exclusivo";

export type DecisaoCofre = {
  elegivel: boolean;
  acao: AcaoComercialCofre;
  motivo:
    | "nao_participa_ranking"
    | "dados_insuficientes"
    | "atraso_vs_proprio_historico"
    | "ticket_recente_abaixo_do_proprio_padrao"
    | "top3"
    | "comportamento_normal_sem_subsidio";
  posicaoRanking: number | null;
  resumo: ResumoComportamentalCofre;
};

export type ContextoClienteCofre = {
  participaRanking: boolean;
  posicaoRanking: number | null;
  estrelasDisponiveis: number;
  estrelasConquistadasTemporada: number;
};

export type BeneficioCofre =
  | { tipo: "desconto_fixo"; valorCents: number }
  | { tipo: "desconto_percentual"; percentualBps: number; tetoCents: number }
  | { tipo: "vantagem_sem_desconto"; descricao: string };

export type OfertaCofreConfigurada = {
  ofertaId: string;
  ativa: boolean;
  acao: Exclude<AcaoComercialCofre, "coletando_dados" | "sem_incentivo">;
  estrelasNecessarias: number;
  pedidoMinimoCents: number;
  somentePodio?: boolean;
  beneficio: BeneficioCofre;
};

export type ContextoEconomicoPedido = {
  /** Valor elegível oficial do pedido, recalculado no servidor. */
  receitaElegivelCents: number | null;
  /** CMV/custo oficial dos itens do pedido. null = fonte econômica ausente. */
  custoMercadoriaCents: number | null;
  /** Custos variáveis adicionais aprovados para a conta econômica. */
  custoVariavelCents: number | null;
  /** Piso de margem absoluta que deve sobrar após o benefício. */
  margemMinimaDepoisCents: number | null;
  /** Orçamento ainda disponível para benefícios neste período. */
  orcamentoRestantePeriodoCents: number | null;
  /** Aprovação econômica explícita da campanha. */
  coberturaEconomicaAprovada: boolean;
  /** Há outra promoção/desconto incompatível aplicado? */
  possuiOutraPromocao: boolean;
};

export type ResultadoProtecaoEconomica =
  | {
      liberado: false;
      motivo:
        | "cobertura_economica_nao_aprovada"
        | "dados_economicos_incompletos"
        | "beneficio_invalido"
        | "orcamento_insuficiente"
        | "margem_insuficiente"
        | "promocao_incompativel";
    }
  | {
      liberado: true;
      margemAntesCents: number;
      margemDepoisCents: number;
      custoBeneficioCents: number;
    };

export type ResultadoOfertaCofre = {
  oferta: OfertaCofreConfigurada | null;
  status:
    | "sem_oferta_configurada"
    | "saldo_insuficiente"
    | "pedido_minimo_nao_atingido"
    | "fora_do_podio"
    | "bloqueada_economia"
    | "liberavel";
  protecaoEconomica?: ResultadoProtecaoEconomica;
};

const DIA_MS = 24 * 60 * 60 * 1000;

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 1) return ordenados[meio]!;
  return Math.round((ordenados[meio - 1]! + ordenados[meio]!) / 2);
}

function mediaInteira(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return Math.round(valores.reduce((soma, valor) => soma + valor, 0) / valores.length);
}

function diasComUmaCasa(ms: number): number {
  return Math.round((ms / DIA_MS) * 10) / 10;
}

export function resumirComportamentoCofre(
  eventos: EventoComportamentalCofre[],
  agoraMs: number = Date.now(),
): ResumoComportamentalCofre {
  const entregues = (Array.isArray(eventos) ? eventos : [])
    .filter((evento) =>
      evento?.statusAnalitico === "entregue" &&
      Number.isFinite(evento.criadoEmMs) &&
      evento.criadoEmMs > 0 &&
      Number.isFinite(evento.valorElegivelCents) &&
      evento.valorElegivelCents > 0,
    )
    .sort((a, b) => a.criadoEmMs - b.criadoEmMs);

  if (entregues.length === 0) {
    return {
      pedidosEntregues: 0,
      ticketMedioCents: null,
      ticketMedianoCents: null,
      ultimoTicketCents: null,
      ultimoPedidoEmMs: null,
      diasDesdeUltimoPedido: null,
      intervaloMedianoDias: null,
    };
  }

  const tickets = entregues.map((evento) => Math.round(evento.valorElegivelCents));
  const intervalosMs: number[] = [];
  for (let i = 1; i < entregues.length; i++) {
    const intervalo = entregues[i]!.criadoEmMs - entregues[i - 1]!.criadoEmMs;
    if (intervalo > 0) intervalosMs.push(intervalo);
  }

  const ultimo = entregues[entregues.length - 1]!;
  const diasDesdeUltimoPedido =
    Number.isFinite(agoraMs) && agoraMs >= ultimo.criadoEmMs
      ? diasComUmaCasa(agoraMs - ultimo.criadoEmMs)
      : null;
  const intervaloMedianoMs = mediana(intervalosMs);

  return {
    pedidosEntregues: entregues.length,
    ticketMedioCents: mediaInteira(tickets),
    ticketMedianoCents: mediana(tickets),
    ultimoTicketCents: Math.round(ultimo.valorElegivelCents),
    ultimoPedidoEmMs: ultimo.criadoEmMs,
    diasDesdeUltimoPedido,
    intervaloMedianoDias: intervaloMedianoMs === null ? null : diasComUmaCasa(intervaloMedianoMs),
  };
}

function configComportamentalValida(config: ConfigComportamentalCofre): boolean {
  return Number.isInteger(config.minPedidosParaPersonalizar)
    && config.minPedidosParaPersonalizar >= 2
    && Number.isFinite(config.atrasoRetornoRazaoMin)
    && config.atrasoRetornoRazaoMin > 1
    && Number.isFinite(config.ticketBaixoRazaoMax)
    && config.ticketBaixoRazaoMax > 0
    && config.ticketBaixoRazaoMax < 1;
}

/**
 * Decide UMA próxima melhor ação.
 *
 * Princípios:
 * - cliente fora do Ranking não entra no Cofre;
 * - comportamento é comparado com o próprio histórico;
 * - atraso de retorno tem prioridade sobre tentativa de aumentar ticket;
 * - Top 3 recebe status/exclusividade quando não existe sinal comercial mais urgente;
 * - comportamento normal não é subsidiado sem necessidade.
 */
export function decidirProximaMelhorAcaoCofre(params: {
  contexto: ContextoClienteCofre;
  resumo: ResumoComportamentalCofre;
  config: ConfigComportamentalCofre | null;
}): DecisaoCofre {
  const { contexto, resumo, config } = params;

  if (!contexto.participaRanking) {
    return {
      elegivel: false,
      acao: "sem_incentivo",
      motivo: "nao_participa_ranking",
      posicaoRanking: contexto.posicaoRanking,
      resumo,
    };
  }

  const noPodio = contexto.posicaoRanking !== null
    && contexto.posicaoRanking >= 1
    && contexto.posicaoRanking <= 3;

  if (!config || !configComportamentalValida(config) || resumo.pedidosEntregues < config.minPedidosParaPersonalizar) {
    return {
      elegivel: true,
      acao: noPodio ? "podio_exclusivo" : "coletando_dados",
      motivo: noPodio ? "top3" : "dados_insuficientes",
      posicaoRanking: contexto.posicaoRanking,
      resumo,
    };
  }

  if (
    resumo.intervaloMedianoDias !== null &&
    resumo.intervaloMedianoDias > 0 &&
    resumo.diasDesdeUltimoPedido !== null &&
    resumo.diasDesdeUltimoPedido / resumo.intervaloMedianoDias >= config.atrasoRetornoRazaoMin
  ) {
    return {
      elegivel: true,
      acao: "retorno",
      motivo: "atraso_vs_proprio_historico",
      posicaoRanking: contexto.posicaoRanking,
      resumo,
    };
  }

  if (
    resumo.ticketMedianoCents !== null &&
    resumo.ticketMedianoCents > 0 &&
    resumo.ultimoTicketCents !== null &&
    resumo.ultimoTicketCents / resumo.ticketMedianoCents <= config.ticketBaixoRazaoMax
  ) {
    return {
      elegivel: true,
      acao: "aumentar_ticket",
      motivo: "ticket_recente_abaixo_do_proprio_padrao",
      posicaoRanking: contexto.posicaoRanking,
      resumo,
    };
  }

  if (noPodio) {
    return {
      elegivel: true,
      acao: "podio_exclusivo",
      motivo: "top3",
      posicaoRanking: contexto.posicaoRanking,
      resumo,
    };
  }

  return {
    elegivel: true,
    acao: "sem_incentivo",
    motivo: "comportamento_normal_sem_subsidio",
    posicaoRanking: contexto.posicaoRanking,
    resumo,
  };
}

export function custoBeneficioCents(
  beneficio: BeneficioCofre,
  receitaElegivelCents: number,
): number | null {
  if (!Number.isFinite(receitaElegivelCents) || receitaElegivelCents < 0) return null;
  if (beneficio.tipo === "vantagem_sem_desconto") return 0;
  if (beneficio.tipo === "desconto_fixo") {
    return Number.isInteger(beneficio.valorCents) && beneficio.valorCents > 0
      ? beneficio.valorCents
      : null;
  }
  if (
    !Number.isInteger(beneficio.percentualBps) ||
    beneficio.percentualBps <= 0 ||
    beneficio.percentualBps > 10_000 ||
    !Number.isInteger(beneficio.tetoCents) ||
    beneficio.tetoCents <= 0
  ) {
    return null;
  }
  return Math.min(
    Math.floor((receitaElegivelCents * beneficio.percentualBps) / 10_000),
    beneficio.tetoCents,
  );
}

/**
 * Guarda econômica obrigatória.
 *
 * Nenhum valor é inferido. Ausência de CMV, custo variável, margem mínima,
 * orçamento ou aprovação explícita bloqueia o benefício.
 */
export function avaliarProtecaoEconomicaCofre(params: {
  beneficio: BeneficioCofre;
  economia: ContextoEconomicoPedido;
}): ResultadoProtecaoEconomica {
  const { beneficio, economia } = params;

  if (!economia.coberturaEconomicaAprovada) {
    return { liberado: false, motivo: "cobertura_economica_nao_aprovada" };
  }
  if (economia.possuiOutraPromocao) {
    return { liberado: false, motivo: "promocao_incompativel" };
  }

  const campos = [
    economia.receitaElegivelCents,
    economia.custoMercadoriaCents,
    economia.custoVariavelCents,
    economia.margemMinimaDepoisCents,
    economia.orcamentoRestantePeriodoCents,
  ];
  if (campos.some((valor) => valor === null || !Number.isInteger(valor) || (valor as number) < 0)) {
    return { liberado: false, motivo: "dados_economicos_incompletos" };
  }

  const receita = economia.receitaElegivelCents as number;
  const cmv = economia.custoMercadoriaCents as number;
  const custoVariavel = economia.custoVariavelCents as number;
  const margemMinima = economia.margemMinimaDepoisCents as number;
  const orcamento = economia.orcamentoRestantePeriodoCents as number;
  const custoBeneficio = custoBeneficioCents(beneficio, receita);

  if (custoBeneficio === null) {
    return { liberado: false, motivo: "beneficio_invalido" };
  }
  if (custoBeneficio > orcamento) {
    return { liberado: false, motivo: "orcamento_insuficiente" };
  }

  const margemAntes = receita - cmv - custoVariavel;
  const margemDepois = margemAntes - custoBeneficio;
  if (margemDepois < margemMinima) {
    return { liberado: false, motivo: "margem_insuficiente" };
  }

  return {
    liberado: true,
    margemAntesCents: margemAntes,
    margemDepoisCents: margemDepois,
    custoBeneficioCents: custoBeneficio,
  };
}

/**
 * Seleciona somente ofertas previamente configuradas.
 * O motor nunca inventa desconto, quantidade de Estrelas ou pedido mínimo.
 */
export function avaliarOfertasCofre(params: {
  decisao: DecisaoCofre;
  contexto: ContextoClienteCofre;
  ofertas: OfertaCofreConfigurada[];
  subtotalElegivelCents: number;
  economia: ContextoEconomicoPedido;
}): ResultadoOfertaCofre {
  const { decisao, contexto, ofertas, subtotalElegivelCents, economia } = params;

  if (
    decisao.acao === "coletando_dados" ||
    decisao.acao === "sem_incentivo" ||
    !decisao.elegivel
  ) {
    return { oferta: null, status: "sem_oferta_configurada" };
  }

  const oferta = ofertas.find((item) => item.ativa && item.acao === decisao.acao) ?? null;
  if (!oferta) return { oferta: null, status: "sem_oferta_configurada" };

  if (oferta.somentePodio && !(contexto.posicaoRanking !== null && contexto.posicaoRanking <= 3)) {
    return { oferta, status: "fora_do_podio" };
  }
  if (!Number.isInteger(contexto.estrelasDisponiveis) || contexto.estrelasDisponiveis < oferta.estrelasNecessarias) {
    return { oferta, status: "saldo_insuficiente" };
  }
  if (!Number.isInteger(subtotalElegivelCents) || subtotalElegivelCents < oferta.pedidoMinimoCents) {
    return { oferta, status: "pedido_minimo_nao_atingido" };
  }

  const protecaoEconomica = avaliarProtecaoEconomicaCofre({
    beneficio: oferta.beneficio,
    economia: {
      ...economia,
      receitaElegivelCents: subtotalElegivelCents,
    },
  });
  if (!protecaoEconomica.liberado) {
    return { oferta, status: "bloqueada_economia", protecaoEconomica };
  }

  return { oferta, status: "liberavel", protecaoEconomica };
}
