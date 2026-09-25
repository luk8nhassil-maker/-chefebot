"use client";

import { useState } from "react";
import { FidelidadeRankingScreen } from "@/app/cliente/FidelidadeRankingScreen";
import type {
  PainelFidelidade,
  PainelGamificacao,
  PreferenciasPrivacidadeRanking,
} from "@/app/cliente/painelFidelidadeTipos";
import { calcularAlvoRankingAtual, montarDisputaRelativa } from "@/lib/rankingRetencao";

type RankingCompleto = NonNullable<PainelFidelidade["ranking"]>;
type TemporadaCompleta = NonNullable<PainelFidelidade["temporada"]>;

type ParticipanteFixture = { nome: string | null; telefone: string | null; score: number };

/**
 * Deriva alvo/disputa/lista a partir de uma lista de participantes já
 * ordenada (score desc), usando as MESMAS funções puras do servidor — o
 * Preview nunca inventa um número que a produção não calcularia do mesmo
 * jeito (ver src/lib/rankingRetencao.ts).
 */
function montarParticipantes(voceIndex: number, participantes: ParticipanteFixture[]) {
  const ordenados = participantes.map((p, i) => ({
    ...p,
    posicao: i + 1,
    clienteId: i === voceIndex ? "voce" : `cli_${i}`,
  }));
  const total = ordenados.length;
  const eu = ordenados[voceIndex];
  const entradaAcima = voceIndex > 0 ? ordenados[voceIndex - 1] : null;
  const entradaAbaixo = voceIndex < total - 1 ? ordenados[voceIndex + 1] : null;
  const alvo = calcularAlvoRankingAtual({
    posicaoAtual: eu.posicao,
    scoreAtual: eu.score,
    totalParticipantes: total,
    entradaAcima: entradaAcima ? { posicao: entradaAcima.posicao, score: entradaAcima.score } : null,
    entradaAbaixo: entradaAbaixo ? { posicao: entradaAbaixo.posicao, score: entradaAbaixo.score } : null,
  });
  const identidades = new Map(
    ordenados.map((p) => [p.clienteId, { nomePublico: p.nome, telefoneMascarado: p.telefone }]),
  );
  const disputa = montarDisputaRelativa({ ordenados, clienteId: "voce", identidades });
  const lista = ordenados.map((p) => ({
    posicao: p.posicao,
    score: p.score,
    eVoce: p.clienteId === "voce",
    participaCampanha: true as const,
    ...(p.nome ? { nomePublico: p.nome } : {}),
    ...(p.telefone ? { telefoneMascarado: p.telefone } : {}),
  }));
  return { posicao: eu.posicao, score: eu.score, total, lista, alvo, disputa };
}

function montarRanking(params: {
  participantes: ParticipanteFixture[];
  voceIndex: number;
  variacaoPosicao?: RankingCompleto["variacaoPosicao"];
  variacaoParticipantes?: RankingCompleto["participantes"]["variacaoPosicao"];
}): RankingCompleto {
  const { posicao, score, total, lista, alvo, disputa } = montarParticipantes(params.voceIndex, params.participantes);
  return {
    posicao,
    score,
    participaCampanha: true,
    entorno: lista.map((e) => ({ posicao: e.posicao, eVoce: e.eVoce })),
    lista,
    variacaoPosicao: params.variacaoPosicao ?? null,
    participantes: {
      posicao,
      total,
      variacaoPosicao: params.variacaoParticipantes ?? params.variacaoPosicao ?? null,
      lista,
      alvo,
      disputa,
    },
  };
}

/**
 * Sobrepõe selos sociais (Campeão/Prata/Bronze/Elite) em posições específicas
 * de `ranking.participantes.lista` — usado pelos cenários V3 que mostram o
 * selo de OUTROS membros do Top 10, não só do próprio cliente (correção de
 * blocker da auditoria do #446). Nunca reescreve `eVoce`/score, só anexa o
 * campo que o servidor real também só anexa (painel/route.ts).
 */
function comStatusSocialNosParticipantes(
  ranking: RankingCompleto,
  porPosicao: Record<number, NonNullable<PainelGamificacao["statusSocial"]>>,
): RankingCompleto {
  return {
    ...ranking,
    participantes: {
      ...ranking.participantes,
      lista: ranking.participantes.lista.map((entrada) =>
        porPosicao[entrada.posicao] ? { ...entrada, statusSocial: porPosicao[entrada.posicao] } : entrada,
      ),
    },
  };
}

const TEMPORADA_PADRAO: TemporadaCompleta = {
  nome: "Temporada Preview",
  diasRestantes: 18,
  fimEm: null,
  estado: "ativa",
  premio: { descricao: "1 Pizza Família", quantidadePremiados: 3 },
};

const PRIVACIDADE_PARTICIPANTE: PreferenciasPrivacidadeRanking = {
  participaCampanha: true,
  finalidades: [
    { finalidade: "ranking_primeiro_nome", texto: "Nome", textoVersao: "preview-v1", disponivel: true, motivoIndisponivel: null, estado: "concedido", atualizadoEm: null },
    { finalidade: "ranking_telefone_mascarado", texto: "Telefone", textoVersao: "preview-v1", disponivel: true, motivoIndisponivel: null, estado: "concedido", atualizadoEm: null },
  ],
};

const PARTICIPANTES_PADRAO: ParticipanteFixture[] = [
  { nome: "Ana", telefone: "(11) 9••••-4201", score: 40 },
  { nome: "Carlos", telefone: "(21) 9••••-1188", score: 33 },
  { nome: "Marina", telefone: "(31) 9••••-0777", score: 28 },
  { nome: "Rafael", telefone: "(41) 9••••-9863", score: 22 },
  // Nome real (não "Você") mesmo no índice que representa o usuário nos
  // cenários 1–13/16–17 (voceIndex 4): a UI sempre força "Você" na própria
  // linha via `eVoce`, então o nome aqui só importa para não colidir com o
  // texto "Você" em cenários que usam outro voceIndex (líder, último).
  { nome: "Lucas", telefone: "(99) 9••••-9991", score: 18 },
  { nome: "Julia", telefone: "(51) 9••••-4426", score: 15 },
  { nome: "Pedro", telefone: "(61) 9••••-2231", score: 9 },
];

type Cenario = {
  id: string;
  titulo: string;
  detalhe: string;
  props: {
    ranking: RankingCompleto;
    temporada: TemporadaCompleta | null;
    indicacao: PainelFidelidade["indicacao"];
    posPedido?: { estado: "pendente" | "creditado"; estrelasGanhas?: number } | null;
    gamificacao?: PainelGamificacao | null;
  };
};

const GAMIFICACAO_NEUTRA: PainelGamificacao = {
  statusSocial: null,
  bonusCompeticao: 0,
  missaoSemanal: null,
  missaoIndicacao: null,
  nivelChef: null,
  movimentoRecente: null,
  coroaAmeacada: false,
};

const CENARIOS: Cenario[] = [
  {
    id: "posicao-intermediaria",
    titulo: "1. Posição intermediária",
    detalhe: "Você no meio do pelotão, com alvo e disputa nos dois lados.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "subiu",
    titulo: "2. Subiu posição",
    detalhe: "Selo de variação real (▲) e mensagem de movimento positiva.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "subiu", casas: 2 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "desceu",
    titulo: "3. Desceu posição",
    detalhe: "Linguagem neutra, nunca punitiva — sem 'perdeu' ou humilhação.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "desceu", casas: 1 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "manteve",
    titulo: "4. Manteve a posição",
    detalhe: "'Manteve' nunca gera selo nem frase de movimento (nada para destacar).",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "sem-historico",
    titulo: "5. Sem histórico",
    detalhe: "variacaoPosicao null — nunca inventa 'manteve' na ausência de snapshot anterior.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: null }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "lider",
    titulo: "6. #1 (líder)",
    detalhe: "Sem adversário fictício acima — estado 'defenda a liderança' com vantagem real.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 0, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "ultimo",
    titulo: "7. Último colocado",
    detalhe: "Sem ninguém abaixo — a disputa só mostra quem está acima.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: PARTICIPANTES_PADRAO.length - 1, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "sozinho",
    titulo: "8. Somente um participante",
    detalhe: "Estado 'sozinho' — sem vizinho inventado, sem disputa fictícia.",
    props: {
      ranking: montarRanking({ participantes: [{ nome: "Você", telefone: null, score: 12 }], voceIndex: 0, variacaoPosicao: null }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "empate",
    titulo: "9. Empate de estrelas",
    detalhe: "Mesmo score de quem está acima — alvo ainda exige 1 estrela (desempate real).",
    props: {
      ranking: montarRanking({
        participantes: [
          { nome: "Ana", telefone: null, score: 30 },
          // Rafael chegou a 22 estrelas primeiro — desempate real mantém
          // ele acima mesmo com o MESMO score de "Você" logo abaixo.
          { nome: "Rafael", telefone: null, score: 22 },
          { nome: "Você", telefone: null, score: 22 },
          { nome: "Marina", telefone: null, score: 15 },
        ],
        voceIndex: 2,
        variacaoPosicao: { direcao: "manteve", casas: 0 },
      }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "top3",
    titulo: "10. Top 3",
    detalhe: "Conquista real reconhecida — banner + botão de compartilhar aparecem.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 1, variacaoPosicao: { direcao: "subiu", casas: 1 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "temporada-acabando",
    titulo: "11. Temporada quase acabando",
    detalhe: "Contagem regressiva em destaque no cabeçalho.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: { ...TEMPORADA_PADRAO, diasRestantes: 1 },
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "premio-configurado",
    titulo: "12. Prêmio configurado",
    detalhe: "Descrição do prêmio vem só de configuração aprovada pelo admin.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: { ...TEMPORADA_PADRAO, premio: { descricao: "1 Pizza Família + Refrigerante", quantidadePremiados: 3 } },
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "sem-premio",
    titulo: "13. Sem prêmio configurado",
    detalhe: "Fail-closed: sem aprovação do admin, nunca promete prêmio.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: { ...TEMPORADA_PADRAO, premio: null },
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "indicacao-ativa",
    titulo: "14. Indicação ativa",
    detalhe: "Sheet 'Quero subir' mostra o caminho de indicar amigo com a regra oficial.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "indicacao-indisponivel",
    titulo: "15. Indicação indisponível",
    detalhe: "Sem Estrelas V1 ativa — o caminho de indicação não aparece (nunca inventado).",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: false, estrelasPrimeiraCompra: null },
    },
  },
  {
    id: "pos-pedido-pendente",
    titulo: "16. Pós-pedido — antes do crédito",
    detalhe: "Nunca promete crédito antes da confirmação do servidor.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      posPedido: { estado: "pendente" },
    },
  },
  {
    id: "pos-pedido-creditado",
    titulo: "17. Pós-pedido — depois do crédito",
    detalhe: "Feedback real com estrelas ganhas e nova posição, só com dado confirmado.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 3, variacaoPosicao: { direcao: "subiu", casas: 1 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      posPedido: { estado: "creditado", estrelasGanhas: 5 },
    },
  },
  {
    id: "compartilhamento",
    titulo: "18. Compartilhamento de conquista",
    detalhe: "Subiu para o Top 10 sem estar no Top 3 — conquista real, sem PII de terceiros.",
    props: {
      ranking: montarRanking({
        // Lista dedicada (não reaproveita PARTICIPANTES_PADRAO): lá o nome
        // "Você" está fixo no índice 4, então mudar o voceIndex sozinho
        // deixaria outro participante com o mesmo nome exibido.
        participantes: [
          { nome: "Ana", telefone: "(11) 9••••-4201", score: 40 },
          { nome: "Carlos", telefone: "(21) 9••••-1188", score: 33 },
          { nome: "Marina", telefone: "(31) 9••••-0777", score: 28 },
          { nome: "Rafael", telefone: "(41) 9••••-9863", score: 22 },
          { nome: "Julia", telefone: "(51) 9••••-4426", score: 18 },
          { nome: "Você", telefone: "(99) 9••••-9991", score: 15 },
          { nome: "Pedro", telefone: "(61) 9••••-2231", score: 9 },
        ],
        voceIndex: 5,
        variacaoPosicao: { direcao: "subiu", casas: 3 },
      }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
    },
  },
  {
    id: "status-campeao",
    titulo: "19. Status social — Campeão",
    detalhe: "Selo herdado do #1 da temporada anterior, exibido durante a temporada atual.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, statusSocial: "campeao" },
    },
  },
  {
    id: "status-prata",
    titulo: "20. Status social — Prata",
    detalhe: "Selo herdado do #2 da temporada anterior.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, statusSocial: "prata" },
    },
  },
  {
    id: "status-bronze",
    titulo: "21. Status social — Bronze",
    detalhe: "Selo herdado do #3 da temporada anterior.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, statusSocial: "bronze" },
    },
  },
  {
    id: "status-elite",
    titulo: "22. Status social — Elite Top 10",
    detalhe: "Selo herdado de quem ficou entre #4 e #10 na temporada anterior.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, statusSocial: "elite" },
    },
  },
  {
    id: "missao-semanal-desbloqueada",
    titulo: "23. Caçada ao Pódio — desbloqueada",
    detalhe: "Fora do pódio há 7+ dias sem pedido: próximo pedido vale o dobro de estrelas na temporada.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, missaoSemanal: { status: "desbloqueada" } },
    },
  },
  {
    id: "missao-indicacao-concluida",
    titulo: "24. Missão da temporada — Indique um amigo (concluída)",
    detalhe: "Progresso 0/1 já cumprido nesta temporada — nunca duplica o bônus numa segunda indicação.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, missaoIndicacao: { concluida: true } },
    },
  },
  {
    id: "nivel-chef",
    titulo: "25. Nível de Chef",
    detalhe: "Progressão permanente por XP vitalício, independente da temporada em disputa.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, nivelChef: { nivel: 3, nome: "Chef", xpAtual: 620, xpProximoNivel: 1000 } },
    },
  },
  {
    id: "gamificacao-completa",
    titulo: "26. Tudo ativo ao mesmo tempo",
    detalhe: "Status, bônus de competição, missão semanal e nível juntos — nenhum atrapalha o outro.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 1, variacaoPosicao: { direcao: "subiu", casas: 1 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: {
        statusSocial: "elite",
        bonusCompeticao: 45,
        missaoSemanal: { status: "desbloqueada" },
        missaoIndicacao: { concluida: false },
        nivelChef: { nivel: 4, nome: "Chef Executivo", xpAtual: 1450, xpProximoNivel: null },
        movimentoRecente: { variacao: { direcao: "subiu", casas: 2 }, desde: "2026-09-20T12:00:00.000Z" },
        coroaAmeacada: false,
      },
    },
  },

  // -------------------------------------------------------------------
  // Preview V3 — cenários novos da auditoria de hardening do #446
  // (16 cenários abaixo, mantendo os 26 originais intactos acima).
  // -------------------------------------------------------------------
];

/** Top 12 participantes reais para os cenários V3 que precisam de posições
 * além do #7 (Elite #10, #11 perseguindo o Top 10). */
const PARTICIPANTES_TOP12: ParticipanteFixture[] = [
  { nome: "Ana", telefone: "(11) 9••••-4201", score: 90 },
  { nome: "Bruno", telefone: "(12) 9••••-1002", score: 82 },
  { nome: "Carlos", telefone: "(21) 9••••-1188", score: 75 },
  { nome: "Diana", telefone: "(22) 9••••-2233", score: 68 },
  { nome: "Marina", telefone: "(31) 9••••-0777", score: 60 },
  { nome: "Rafael", telefone: "(41) 9••••-9863", score: 52 },
  { nome: "Sofia", telefone: "(42) 9••••-3344", score: 45 },
  { nome: "Lucas", telefone: "(99) 9••••-9991", score: 38 },
  { nome: "Julia", telefone: "(51) 9••••-4426", score: 30 },
  { nome: "Otavio", telefone: "(61) 9••••-2231", score: 22 },
  { nome: "Beatriz", telefone: "(71) 9••••-5566", score: 18 },
  { nome: "Tomas", telefone: "(81) 9••••-7788", score: 12 },
];

const LIDER_GAP_PEQUENO: ParticipanteFixture[] = [
  { nome: "Você", telefone: null, score: 50 },
  { nome: "Rafael", telefone: "(41) 9••••-9863", score: 47 },
  { nome: "Julia", telefone: "(51) 9••••-4426", score: 30 },
];

const LIDER_GAP_GRANDE: ParticipanteFixture[] = [
  { nome: "Você", telefone: null, score: 80 },
  { nome: "Rafael", telefone: "(41) 9••••-9863", score: 20 },
  { nome: "Julia", telefone: "(51) 9••••-4426", score: 12 },
];

const CENARIOS_V3: Cenario[] = [
  {
    id: "v3-selo-outro-campeao-podium",
    titulo: "27. Selo Campeão em OUTRO participante do pódio",
    detalhe: "O #1 é outro cliente (não você) — o selo Campeão aparece nele mesmo sem você estar logado como esse cliente.",
    props: {
      ranking: comStatusSocialNosParticipantes(
        montarRanking({ participantes: PARTICIPANTES_TOP12, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
        { 1: "campeao" },
      ),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: GAMIFICACAO_NEUTRA,
    },
  },
  {
    id: "v3-selo-outro-elite-pos4",
    titulo: "28. Selo Elite em outro participante — posição #4",
    detalhe: "Elite (Top 4-10 da temporada anterior) exibido em quem está na posição #4 agora, não em você.",
    props: {
      ranking: comStatusSocialNosParticipantes(
        montarRanking({ participantes: PARTICIPANTES_TOP12, voceIndex: 6, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
        { 4: "elite" },
      ),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: GAMIFICACAO_NEUTRA,
    },
  },
  {
    id: "v3-selo-outro-elite-pos10",
    titulo: "29. Selo Elite em outro participante — posição #10 (borda do Top 10)",
    detalhe: "Última posição que ainda recebe selo Elite — #11 (cenário seguinte) nunca recebe selo nenhum.",
    props: {
      ranking: comStatusSocialNosParticipantes(
        montarRanking({ participantes: PARTICIPANTES_TOP12, voceIndex: 6, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
        { 10: "elite" },
      ),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: GAMIFICACAO_NEUTRA,
    },
  },
  {
    id: "v3-perseguindo-top10-pos11",
    titulo: "30. Você é #11 — perseguindo o Top 10",
    detalhe: "Fora do Top 10 por pouco: a disputa mostra a distância real até o #10, nunca um selo (selo só existe de #1 a #10).",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_TOP12, voceIndex: 10, variacaoPosicao: { direcao: "subiu", casas: 1 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: GAMIFICACAO_NEUTRA,
    },
  },
  {
    id: "v3-coroa-sem-ameaca-config",
    titulo: "31. Defenda sua coroa — sem ameaça configurada",
    detalhe: "Você lidera; sem ameacaPodioMaxGap configurado pelo admin, mostra só a distância neutra até o #2 (fail-closed).",
    props: {
      ranking: montarRanking({ participantes: LIDER_GAP_PEQUENO, voceIndex: 0, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, coroaAmeacada: false },
    },
  },
  {
    id: "v3-coroa-ameacada",
    titulo: "32. Coroa ameaçada! (config real + vantagem pequena)",
    detalhe: "Admin configurou ameacaPodioMaxGap e a vantagem real (3 Estrelas) está dentro do limite — alerta aparece.",
    props: {
      ranking: montarRanking({ participantes: LIDER_GAP_PEQUENO, voceIndex: 0, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, coroaAmeacada: true },
    },
  },
  {
    id: "v3-coroa-config-mas-folgada",
    titulo: "33. Coroa com config ativa mas vantagem folgada — sem alerta",
    detalhe: "Mesmo com ameacaPodioMaxGap configurado, uma vantagem grande (60 Estrelas) nunca mostra 'ameaçada' — nunca alarme falso.",
    props: {
      ranking: montarRanking({ participantes: LIDER_GAP_GRANDE, voceIndex: 0, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, coroaAmeacada: false },
    },
  },
  {
    id: "v3-missao-indicacao-card-incompleta",
    titulo: "34. Missão de indicação — card visível, 0/1",
    detalhe: "Card 'MISSÃO DA TEMPORADA' aparece direto na tela, sem precisar abrir o sheet 'Quero subir'.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, missaoIndicacao: { concluida: false } },
    },
  },
  {
    id: "v3-missao-indicacao-card-concluida",
    titulo: "35. Missão de indicação — card visível, 1/1 ✓",
    detalhe: "Mesmo card, agora mostrando conclusão real após a primeira compra confirmada do indicado.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, missaoIndicacao: { concluida: true } },
    },
  },
  {
    id: "v3-missao-semanal-cliente-antigo",
    titulo: "36. Caçada ao Pódio para cliente ANTIGO (pedido antes da feature existir)",
    detalhe: "Batizado (backdating) usa a data real do último pedido confirmado no extrato — nunca fica bloqueado para sempre por 'nunca ter um pedido elegível registrado'.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, missaoSemanal: { status: "desbloqueada" } },
    },
  },
  {
    id: "v3-nivel-progresso-parcial",
    titulo: "37. Nível de Chef — barra de progresso parcial",
    detalhe: "XP atual no meio do caminho até o próximo nível — barra reflete a fração real (nunca 0% logo após subir de nível).",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, nivelChef: { nivel: 2, nome: "Cozinheiro", xpAtual: 250, xpProximoNivel: 500 } },
    },
  },
  {
    id: "v3-nivel-maximo",
    titulo: "38. Nível de Chef — nível máximo atingido",
    detalhe: "Sem próximo nível configurado: barra cheia e texto 'Nível máximo atingido', nunca um XP restante inventado.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, nivelChef: { nivel: 5, nome: "Lenda da Cozinha", xpAtual: 9999, xpProximoNivel: null } },
    },
  },
  {
    id: "v3-movimento-recente-subiu",
    titulo: "39. Movimento recente — ▲ desde sua última visita",
    detalhe: "Conceito separado do histórico diário: compara com a última vez que VOCÊ abriu o painel, nunca com 'ontem'.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, movimentoRecente: { variacao: { direcao: "subiu", casas: 3 }, desde: "2026-09-18T09:00:00.000Z" } },
    },
  },
  {
    id: "v3-movimento-recente-desceu",
    titulo: "40. Movimento recente — ▼ desde sua última visita",
    detalhe: "Mesmo conceito, direção de queda — sempre com evidência real da visita anterior, nunca uma data inventada.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, movimentoRecente: { variacao: { direcao: "desceu", casas: 1 }, desde: "2026-09-19T14:30:00.000Z" } },
    },
  },
  {
    id: "v3-carryover-sem-login-anterior",
    titulo: "41. Carryover aplicado sem depender do login do vencedor",
    detalhe: "Bônus de largada e selo social já refletidos na PRIMEIRA visita da temporada — a reconciliação em lote roda a partir de QUALQUER leitura do painel, nunca espera o próprio Top 10 logar.",
    props: {
      ranking: montarRanking({ participantes: PARTICIPANTES_PADRAO, voceIndex: 4, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: { ...GAMIFICACAO_NEUTRA, statusSocial: "bronze", bonusCompeticao: 12 },
    },
  },
  {
    id: "v3-podium-selos-multiplos",
    titulo: "42. Pódio com 3 selos diferentes, todos de outros participantes",
    detalhe: "Campeão, Prata e Bronze aparecem simultaneamente em quem ocupa #1/#2/#3 — você está fora do pódio, sem selo nenhum.",
    props: {
      ranking: comStatusSocialNosParticipantes(
        montarRanking({ participantes: PARTICIPANTES_TOP12, voceIndex: 6, variacaoPosicao: { direcao: "manteve", casas: 0 } }),
        { 1: "campeao", 2: "prata", 3: "bronze" },
      ),
      temporada: TEMPORADA_PADRAO,
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6 },
      gamificacao: GAMIFICACAO_NEUTRA,
    },
  },
];

CENARIOS.push(...CENARIOS_V3);

export default function RankingRetencaoPreview() {
  const [cenario, setCenario] = useState(CENARIOS[0]);
  const [aviso, setAviso] = useState("");
  const [indicando, setIndicando] = useState(false);
  const [compartilhando, setCompartilhando] = useState(false);

  function simular(mensagem: string, setBusy?: (v: boolean) => void) {
    setBusy?.(true);
    setTimeout(() => setBusy?.(false), 600);
    setAviso(mensagem);
    setTimeout(() => setAviso(""), 3200);
  }

  return (
    <main style={{ minHeight: "100dvh", background: "#f4f6f9", padding: 24, fontFamily: "Arial, sans-serif", color: "#172945" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "280px 1fr", gap: 24, alignItems: "start" }}>
        <div>
          <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: "#3972d7" }}>PREVIEW ISOLADO</p>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Ranking do Chefe — Retenção + Gamificação V2</h1>
          <p style={{ margin: "0 0 14px", color: "#61738b", lineHeight: 1.5, fontSize: 13 }}>
            Fixtures locais. Nenhum pedido, Pix, WhatsApp, impressão, estoque, fidelidade real, indicação real,
            bônus de competição ou escrita em Redis é criada aqui — o componente renderizado é o mesmo usado em
            produção (<code>FidelidadeRankingScreen</code>).
          </p>
          <div style={{ display: "grid", gap: 8, maxHeight: "80dvh", overflow: "auto", paddingRight: 4 }}>
            {CENARIOS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCenario(item)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 12,
                  border: item.id === cenario.id ? "2px solid #4f86ed" : "1px solid #d7deea",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <strong style={{ display: "block", fontSize: 13 }}>{item.titulo}</strong>
                <span style={{ display: "block", marginTop: 4, color: "#61738b", fontSize: 11.5, lineHeight: 1.35 }}>{item.detalhe}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: "#fdf6e8", borderRadius: 24, padding: "24px 18px", minHeight: 640 }}>
          {aviso && (
            <p role="status" style={{ margin: "0 0 12px", padding: "8px 12px", borderRadius: 10, background: "#e9f1ff", color: "#2d609f", fontSize: 12.5 }}>
              {aviso}
            </p>
          )}
          <FidelidadeRankingScreen
            key={cenario.id}
            ranking={cenario.props.ranking}
            temporada={cenario.props.temporada}
            indicacao={cenario.props.indicacao}
            gamificacao={cenario.props.gamificacao ?? null}
            privacidade={PRIVACIDADE_PARTICIPANTE}
            privacidadeCarregando={false}
            privacidadeSalvando={null}
            privacidadeErro=""
            indicando={indicando}
            compartilhando={compartilhando}
            posPedido={cenario.props.posPedido ?? null}
            onAlterarPrivacidade={() => undefined}
            onRevogarTodas={() => simular("Revogação simulada. Nenhuma autorização real foi alterada.")}
            onIndicarAmigo={() => simular("Indicação simulada. Nenhum link real foi criado ou enviado.", setIndicando)}
            onCompartilharConquista={() => simular("Compartilhamento simulado. Nenhum link real foi criado ou enviado.", setCompartilhando)}
            onNovoPedido={() => simular("No Preview, um novo pedido não é criado de verdade.")}
            onTelemetria={() => undefined}
            onClose={() => simular("No fluxo real, isso voltaria para o resumo de Fidelidade.")}
          />
        </div>
      </section>
    </main>
  );
}
