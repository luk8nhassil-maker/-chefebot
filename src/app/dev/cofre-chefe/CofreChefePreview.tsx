"use client";

import { useMemo, useState } from "react";
import {
  avaliarOfertasCofre,
  decidirProximaMelhorAcaoCofre,
  resumirComportamentoCofre,
  type ContextoClienteCofre,
  type EventoComportamentalCofre,
  type OfertaCofreConfigurada,
} from "@/lib/cofreChef";
import styles from "./CofreChefePreview.module.css";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.parse("2026-09-27T21:00:00.000Z");

const CONFIG_COMPORTAMENTO_FIXTURE = {
  minPedidosParaPersonalizar: 3,
  atrasoRetornoRazaoMin: 1.5,
  ticketBaixoRazaoMax: 0.75,
};

type Cenario = {
  id: string;
  nome: string;
  subtitulo: string;
  contexto: ContextoClienteCofre;
  eventos: EventoComportamentalCofre[];
  oferta?: OfertaCofreConfigurada;
  subtotalSimuladoCents: number;
  economiaSimulada: {
    custoMercadoriaCents: number;
    custoVariavelCents: number;
    margemMinimaDepoisCents: number;
    orcamentoRestantePeriodoCents: number;
  };
};

function evento(id: string, diasAtras: number, valorCents: number): EventoComportamentalCofre {
  return {
    pedidoId: id,
    criadoEmMs: AGORA - diasAtras * DIA,
    valorElegivelCents: valorCents,
    statusAnalitico: "entregue",
  };
}

const CENARIOS: Cenario[] = [
  {
    id: "normal",
    nome: "Cliente comprando normalmente",
    subtitulo: "O melhor desconto pode ser nenhum.",
    contexto: {
      participaRanking: true,
      posicaoRanking: 8,
      estrelasDisponiveis: 30,
      estrelasConquistadasTemporada: 80,
    },
    eventos: [
      evento("n1", 14, 5000),
      evento("n2", 7, 5200),
      evento("n3", 2, 5100),
    ],
    subtotalSimuladoCents: 6000,
    economiaSimulada: {
      custoMercadoriaCents: 2800,
      custoVariavelCents: 500,
      margemMinimaDepoisCents: 1800,
      orcamentoRestantePeriodoCents: 10000,
    },
  },
  {
    id: "retorno",
    nome: "Cliente demorando para voltar",
    subtitulo: "Compara o cliente com o próprio ritmo de compra.",
    contexto: {
      participaRanking: true,
      posicaoRanking: 7,
      estrelasDisponiveis: 32,
      estrelasConquistadasTemporada: 92,
    },
    eventos: [
      evento("r1", 28, 5200),
      evento("r2", 21, 5100),
      evento("r3", 14, 5300),
    ],
    oferta: {
      ofertaId: "fixture-retorno",
      ativa: true,
      acao: "retorno",
      estrelasNecessarias: 20,
      pedidoMinimoCents: 6000,
      beneficio: { tipo: "desconto_fixo", valorCents: 500 },
    },
    subtotalSimuladoCents: 8000,
    economiaSimulada: {
      custoMercadoriaCents: 3200,
      custoVariavelCents: 600,
      margemMinimaDepoisCents: 2200,
      orcamentoRestantePeriodoCents: 10000,
    },
  },
  {
    id: "ticket",
    nome: "Ticket recente caiu",
    subtitulo: "A vantagem só aparece para tentar aumentar o carrinho.",
    contexto: {
      participaRanking: true,
      posicaoRanking: 5,
      estrelasDisponiveis: 44,
      estrelasConquistadasTemporada: 110,
    },
    eventos: [
      evento("t1", 20, 8000),
      evento("t2", 12, 8000),
      evento("t3", 2, 5000),
    ],
    oferta: {
      ofertaId: "fixture-ticket",
      ativa: true,
      acao: "aumentar_ticket",
      estrelasNecessarias: 25,
      pedidoMinimoCents: 9000,
      beneficio: { tipo: "desconto_fixo", valorCents: 600 },
    },
    subtotalSimuladoCents: 9500,
    economiaSimulada: {
      custoMercadoriaCents: 3900,
      custoVariavelCents: 700,
      margemMinimaDepoisCents: 2500,
      orcamentoRestantePeriodoCents: 10000,
    },
  },
  {
    id: "podio",
    nome: "Cliente no Pódio",
    subtitulo: "Status primeiro; desconto não é obrigatório.",
    contexto: {
      participaRanking: true,
      posicaoRanking: 2,
      estrelasDisponiveis: 38,
      estrelasConquistadasTemporada: 126,
    },
    eventos: [
      evento("p1", 14, 6100),
      evento("p2", 7, 6300),
      evento("p3", 2, 6200),
    ],
    oferta: {
      ofertaId: "fixture-podio",
      ativa: true,
      acao: "podio_exclusivo",
      estrelasNecessarias: 10,
      pedidoMinimoCents: 6000,
      somentePodio: true,
      beneficio: {
        tipo: "vantagem_sem_desconto",
        descricao: "Acesso antecipado a uma vantagem configurada",
      },
    },
    subtotalSimuladoCents: 7000,
    economiaSimulada: {
      custoMercadoriaCents: 3000,
      custoVariavelCents: 500,
      margemMinimaDepoisCents: 2000,
      orcamentoRestantePeriodoCents: 10000,
    },
  },
];

const ROTULO_ACAO = {
  coletando_dados: "Coletar mais dados",
  sem_incentivo: "Não oferecer desconto",
  retorno: "Trazer de volta",
  aumentar_ticket: "Aumentar o ticket",
  podio_exclusivo: "Exclusividade do Pódio",
} as const;

function moeda(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function motivoHumano(motivo: string): string {
  const mapa: Record<string, string> = {
    nao_participa_ranking: "Cliente não participa do Ranking.",
    dados_insuficientes: "Ainda não existe histórico suficiente para personalizar.",
    atraso_vs_proprio_historico: "Está demorando mais que o próprio ritmo normal de recompra.",
    ticket_recente_abaixo_do_proprio_padrao: "O último ticket ficou abaixo do padrão desse próprio cliente.",
    top3: "Está no Top 3 e pode receber uma experiência exclusiva.",
    comportamento_normal_sem_subsidio: "O cliente está comprando normalmente; não vale pagar por uma compra que provavelmente viria sozinha.",
  };
  return mapa[motivo] ?? motivo;
}

function statusHumano(status: string): string {
  const mapa: Record<string, string> = {
    sem_oferta_configurada: "Nenhum cupom necessário",
    saldo_insuficiente: "Estrelas insuficientes",
    pedido_minimo_nao_atingido: "Pedido mínimo ainda não atingido",
    fora_do_podio: "Exclusivo do Pódio",
    bloqueada_economia: "Bloqueado pela proteção econômica",
    liberavel: "Liberável na simulação",
  };
  return mapa[status] ?? status;
}

export default function CofreChefePreview() {
  const [cenarioId, setCenarioId] = useState(CENARIOS[0].id);
  const [simularGasto, setSimularGasto] = useState(false);

  const cenario = CENARIOS.find((item) => item.id === cenarioId) ?? CENARIOS[0];

  const calculado = useMemo(() => {
    const resumo = resumirComportamentoCofre(cenario.eventos, AGORA);
    const decisao = decidirProximaMelhorAcaoCofre({
      contexto: cenario.contexto,
      resumo,
      config: CONFIG_COMPORTAMENTO_FIXTURE,
    });
    const ofertas = cenario.oferta ? [cenario.oferta] : [];

    const resultadoProdução = avaliarOfertasCofre({
      decisao,
      contexto: cenario.contexto,
      ofertas,
      subtotalElegivelCents: cenario.subtotalSimuladoCents,
      economia: {
        receitaElegivelCents: cenario.subtotalSimuladoCents,
        custoMercadoriaCents: null,
        custoVariavelCents: null,
        margemMinimaDepoisCents: null,
        orcamentoRestantePeriodoCents: null,
        coberturaEconomicaAprovada: false,
        possuiOutraPromocao: false,
      },
    });

    const resultadoSimulado = avaliarOfertasCofre({
      decisao,
      contexto: cenario.contexto,
      ofertas,
      subtotalElegivelCents: cenario.subtotalSimuladoCents,
      economia: {
        receitaElegivelCents: cenario.subtotalSimuladoCents,
        custoMercadoriaCents: cenario.economiaSimulada.custoMercadoriaCents,
        custoVariavelCents: cenario.economiaSimulada.custoVariavelCents,
        margemMinimaDepoisCents: cenario.economiaSimulada.margemMinimaDepoisCents,
        orcamentoRestantePeriodoCents: cenario.economiaSimulada.orcamentoRestantePeriodoCents,
        coberturaEconomicaAprovada: true,
        possuiOutraPromocao: false,
      },
    });

    return { resumo, decisao, resultadoProdução, resultadoSimulado };
  }, [cenario]);

  const estrelasGastaveis = cenario.oferta?.estrelasNecessarias ?? 0;
  const saldoDepois = simularGasto && calculado.resultadoSimulado.status === "liberavel"
    ? Math.max(0, cenario.contexto.estrelasDisponiveis - estrelasGastaveis)
    : cenario.contexto.estrelasDisponiveis;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.previewBadge}>PREVIEW ISOLADO · FIXTURES</span>
          <p className={styles.eyebrow}>COFRE DO CHEFE</p>
          <h1>Estrelas que viram ação de venda — sem virar desconto automático.</h1>
          <p className={styles.lead}>
            Os números desta tela são fictícios e servem apenas para validar a lógica. Nenhum cliente,
            pedido, Redis, Pix, WhatsApp ou Estrela real é alterado.
          </p>
        </div>
        <div className={styles.shield}>
          <strong>Produção real</strong>
          <span>Bloqueada até CMV, margem e orçamento serem aprovados.</span>
        </div>
      </section>

      <nav className={styles.scenarios} aria-label="Cenários de comportamento">
        {CENARIOS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id === cenario.id ? styles.scenarioActive : styles.scenario}
            onClick={() => {
              setCenarioId(item.id);
              setSimularGasto(false);
            }}
          >
            <strong>{item.nome}</strong>
            <span>{item.subtitulo}</span>
          </button>
        ))}
      </nav>

      <section className={styles.grid}>
        <article className={styles.card}>
          <p className={styles.cardLabel}>1 · O cliente</p>
          <div className={styles.scoreGrid}>
            <div>
              <span>Ranking</span>
              <strong>#{cenario.contexto.posicaoRanking ?? "—"}</strong>
            </div>
            <div>
              <span>Conquistadas</span>
              <strong>{cenario.contexto.estrelasConquistadasTemporada} ★</strong>
            </div>
            <div>
              <span>Disponíveis</span>
              <strong>{saldoDepois} ★</strong>
            </div>
          </div>
          <p className={styles.note}>
            Mesmo simulando um resgate, o Ranking continua em <b>{cenario.contexto.estrelasConquistadasTemporada} ★</b>.
            Só o saldo disponível diminui.
          </p>
        </article>

        <article className={styles.card}>
          <p className={styles.cardLabel}>2 · O comportamento</p>
          <dl className={styles.metrics}>
            <div><dt>Pedidos usados</dt><dd>{calculado.resumo.pedidosEntregues}</dd></div>
            <div><dt>Ticket mediano</dt><dd>{moeda(calculado.resumo.ticketMedianoCents)}</dd></div>
            <div><dt>Último ticket</dt><dd>{moeda(calculado.resumo.ultimoTicketCents)}</dd></div>
            <div><dt>Ritmo normal</dt><dd>{calculado.resumo.intervaloMedianoDias ?? "—"} dias</dd></div>
            <div><dt>Desde o último</dt><dd>{calculado.resumo.diasDesdeUltimoPedido ?? "—"} dias</dd></div>
          </dl>
          <p className={styles.note}>A comparação é contra o próprio histórico do cliente, não uma média genérica.</p>
        </article>

        <article className={styles.cardStrong}>
          <p className={styles.cardLabel}>3 · Próxima melhor ação</p>
          <h2>{ROTULO_ACAO[calculado.decisao.acao]}</h2>
          <p>{motivoHumano(calculado.decisao.motivo)}</p>
          {cenario.oferta ? (
            <div className={styles.offer}>
              <span>Oferta configurada na fixture</span>
              <strong>{cenario.oferta.estrelasNecessarias} ★ · pedido mínimo {moeda(cenario.oferta.pedidoMinimoCents)}</strong>
              <small>Esses valores são fictícios e não são regra comercial.</small>
            </div>
          ) : (
            <div className={styles.noOffer}>Nenhum benefício financeiro é necessário neste cenário.</div>
          )}
        </article>

        <article className={styles.card}>
          <p className={styles.cardLabel}>4 · Blindagem econômica</p>
          <div className={styles.guardRow}>
            <span>Com dados reais hoje</span>
            <strong className={styles.blocked}>{statusHumano(calculado.resultadoProdução.status)}</strong>
          </div>
          <div className={styles.guardRow}>
            <span>Simulação fictícia completa</span>
            <strong className={calculado.resultadoSimulado.status === "liberavel" ? styles.allowed : styles.blocked}>
              {statusHumano(calculado.resultadoSimulado.status)}
            </strong>
          </div>
          {calculado.resultadoSimulado.protecaoEconomica?.liberado ? (
            <div className={styles.marginBox}>
              <span>Margem antes</span>
              <b>{moeda(calculado.resultadoSimulado.protecaoEconomica.margemAntesCents)}</b>
              <span>Margem depois</span>
              <b>{moeda(calculado.resultadoSimulado.protecaoEconomica.margemDepoisCents)}</b>
            </div>
          ) : null}
          <p className={styles.note}>
            Sem CMV, custo variável, piso de margem e orçamento oficiais, o cupom real nunca é liberado.
          </p>
        </article>
      </section>

      <section className={styles.footerPanel}>
        <div>
          <p className={styles.cardLabel}>Validação da regra aprovada</p>
          <h2>Gastar Estrelas não derruba a posição.</h2>
          <p>
            A competição mede o que foi conquistado. O Cofre controla apenas o saldo disponível para gastar.
          </p>
        </div>
        <button
          type="button"
          disabled={!cenario.oferta || calculado.resultadoSimulado.status !== "liberavel"}
          onClick={() => setSimularGasto((valor) => !valor)}
        >
          {simularGasto ? "Desfazer simulação" : "Simular uso das Estrelas"}
        </button>
      </section>
    </main>
  );
}
