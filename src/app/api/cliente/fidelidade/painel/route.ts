// GET /api/cliente/fidelidade/painel — dados de temporada e ranking para a
// view do cliente. Agrega em uma única chamada para reduzir round-trips.
//
// Segurança: clienteId NUNCA exposto no ranking — apenas posicao e eVoce.
// Sem PII de outros participantes.

import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { classificarOrigemMovimentoPontos, derivarClienteIdPorTelefone, estrelasV1Ativa, obterConfigFidelidadePontos, obterExtratoPontos } from "@/lib/fidelidade";
import { ESTRELAS_INDICACAO_PRIMEIRA_COMPRA } from "@/lib/estrelasIndicacao";
import { obterTemporadaAtiva } from "@/lib/temporadas";
import { posicaoClienteRanking, obterTopRanking, obterRankingCompleto, reindexarPorFiltro } from "@/lib/rankingClientes";
import { codinomeSecretoRanking } from "@/lib/rankingJogoSecreto";
import { projetarIdentidadesPublicasRanking } from "@/lib/rankingPrivacidade";
import { obterParticipacaoRanking, obterParticipacaoRankingParaClientes } from "@/lib/consentimentoRanking";
import {
  calcularVariacaoPosicao,
  garantirSnapshotDiario,
  obterPosicaoAnterior,
  type SnapshotPosicoesDoDia,
  type VariacaoPosicao,
} from "@/lib/rankingHistorico";
import {
  calcularAlvoRankingAtual,
  detectarFatosDePosicao,
  montarDisputaRelativa,
  type AlvoRankingAtual,
  type DisputaRelativa,
} from "@/lib/rankingRetencao";
import { dataReferenciaUtc } from "@/lib/rankingHistorico";
import {
  marcarLiderancaEVerificarSeJaFoiLider,
  registrarFatoRankingGamificacao,
} from "@/lib/rankingGamificacaoFatos";
import {
  calcularNivelChef,
  calcularXpChefDosMovimentos,
  calcularUltimoPedidoConfirmadoDosMovimentos,
  calcularCoroaAmeacada,
  type StatusTemporada,
} from "@/lib/rankingGamificacao";
import { obterConfigGamificacao } from "@/lib/rankingGamificacaoConfig";
import { obterBonusCompeticaoDaTemporada, obterMovimentosBonusTemporada } from "@/lib/rankingBonusTemporada";
import { chaveExpedienteOperacional } from "@/lib/expedienteOperacional";
import {
  aplicarCarryoverClienteSeNecessario,
  sincronizarStatusSocialCliente,
  reconciliarTransicaoTemporada,
  obterStatusSocialVigente,
} from "@/lib/rankingTransicaoTemporada";
import { sincronizarMissaoSemanalCliente } from "@/lib/rankingMissaoSemanalEstado";
import { obterEstadoMissaoIndicacao } from "@/lib/rankingMissaoIndicacaoEstado";
import { aplicarImpulsoPodioSeElegivel } from "@/lib/rankingImpulsoPodioEstado";
import { sincronizarNivelChefCliente } from "@/lib/rankingNivelChefEstado";
import { sincronizarMovimentoRecente, type MovimentoRecente } from "@/lib/rankingMovimentoRecenteEstado";
import { obterReferenciaCoroaDinamica } from "@/lib/rankingCoroaDinamica";

const TENANT_PADRAO = "default";

function diasRestantes(fimEm: string): number {
  const agora = Date.now();
  const fim = new Date(fimEm).getTime();
  if (fim <= agora) return 0;
  return Math.ceil((fim - agora) / 86400000);
}

export async function GET(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const clienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  const tenantId = TENANT_PADRAO;

  const [temporada, configGamificacao, participaRanking] = await Promise.all([
    obterTemporadaAtiva(tenantId),
    obterConfigGamificacao(),
    obterParticipacaoRanking(clienteId).catch(() => false),
  ]);

  // Vantagem de largada (carryover) e status social — aplicados ANTES de ler
  // a posição, para que o Top 10 herdado da temporada anterior já apareça
  // refletido nesta mesma leitura. Idempotente: repetir em toda leitura do
  // painel é seguro.
  //
  // A reconciliação em lote roda primeiro e cobre TODO o Top 10 anterior de
  // uma vez (nunca depende de cada um deles logar — correção de blocker da
  // auditoria do #446); a chamada por-cliente logo depois garante que o
  // PRÓPRIO cliente autenticado nesta requisição também fica em dia mesmo
  // que a reconciliação em lote já tenha rodado por outra pessoa.
  if (temporada) {
    // Invariante global: a transição da temporada precisa continuar sendo
    // reconciliada mesmo quando quem abriu o app ainda não participa. Isso
    // mantém status/carryover corretos para todos sem expor o Ranking.
    await reconciliarTransicaoTemporada(tenantId, temporada);
    await aplicarCarryoverClienteSeNecessario(tenantId, temporada, clienteId);
  }

  let ranking: {
    posicao: number;
    score: number;
    participaCampanha: boolean;
    entorno: { posicao: number; eVoce: boolean }[];
    lista: {
      posicao: number;
      score: number;
      eVoce: boolean;
      participaCampanha: boolean;
      nomePublico?: string;
      telefoneMascarado?: string;
      codinomeSecreto?: string;
    }[];
    // Histórico honesto: comparação contra o snapshot diário anterior, nunca
    // um valor inventado. `null` quando ainda não existe snapshot anterior.
    variacaoPosicao: VariacaoPosicao | null;
    // Ranking próprio de quem "Vale prêmio" (autorizou aparecer). Reindexado
    // 1..N só entre participantes — nunca reaproveita a posição do ranking
    // geral, porque quem não autorizou pode estar à frente sem disputar.
    participantes: {
      posicao: number | null;
      total: number;
      variacaoPosicao: VariacaoPosicao | null;
      lista: {
        posicao: number;
        score: number;
        eVoce: boolean;
        participaCampanha: true;
        nomePublico?: string;
        telefoneMascarado?: string;
        codinomeSecreto?: string;
        // Selo herdado do Top 10 da temporada ANTERIOR (não da posição atual)
        // — mesma fonte usada para o próprio cliente, agora também exposto
        // para os outros membros do Top 10 na tela de Ranking. `null`/ausente
        // quando o participante nunca teve status (nunca inventa um selo).
        statusSocial?: StatusTemporada;
      }[];
      // Alvo atual ("faltam N estrelas para o #Y") e disputa relativa
      // (vizinho acima/abaixo), sempre calculados entre PARTICIPANTES — é a
      // única posição que importa para quem disputa o prêmio da temporada.
      // `null` só quando o próprio cliente ainda não tem posição aqui.
      alvo: AlvoRankingAtual | null;
      disputa: DisputaRelativa | null;
    };
  } | null = null;

  if (temporada && participaRanking) {
    const [pos, top, completo] = await Promise.all([
      posicaoClienteRanking(tenantId, temporada.temporadaId, clienteId),
      obterTopRanking(tenantId, temporada.temporadaId, 50),
      obterRankingCompleto(tenantId, temporada.temporadaId),
    ]);
    if (pos) {
      const vizinhos = top.filter(
        (e) => e.posicao >= Math.max(1, pos.posicao - 1) && e.posicao <= pos.posicao + 1,
      );
      // clienteId NUNCA exposto — apenas posicao e eVoce
      const entorno = vizinhos.map((e) => ({ posicao: e.posicao, eVoce: e.clienteId === clienteId }));
      // A decisao de exposicao fica na DAL server-only. A rota nunca recebe
      // consentimento bruto nem o perfil inteiro, e omite campos ausentes.
      // O resumo pode mostrar uma posição além do Top 50. Nesse caso, ainda
      // incluímos o próprio cliente na lista para que a aba "Participando"
      // nunca pareça vazia depois do consentimento.
      const listaBase = top.some((e) => e.clienteId === clienteId)
        ? top
        : [...top, { clienteId, score: pos.score, posicao: pos.posicao }];
      // Participação continua sendo lida em lote. Identidade pública é uma
      // camada separada: só carrega perfil para quem autorizou nome. Quem não
      // autorizou continua com codinome e nunca recebe PII na resposta.
      const idsRelevantes = Array.from(new Set([
        ...listaBase.map((e) => e.clienteId),
        ...completo.map((e) => e.clienteId),
        clienteId,
      ]));
      const participacoes = await obterParticipacaoRankingParaClientes(idsRelevantes);

      const reindexados = reindexarPorFiltro(
        completo,
        (id) => participacoes.get(id) === true,
      );
      const LIMITE_PARTICIPANTES = 50;
      const topoParticipantes = reindexados.slice(0, LIMITE_PARTICIPANTES);
      const proprioEntreParticipantes = reindexados.find((e) => e.clienteId === clienteId) ?? null;
      const listaParticipantesBase =
        proprioEntreParticipantes && !topoParticipantes.some((e) => e.clienteId === clienteId)
          ? [...topoParticipantes, proprioEntreParticipantes]
          : topoParticipantes;
      // Perfil/nome só é consultado para quem realmente pode aparecer na tela.
      // A filtragem de participação ainda usa o ranking completo, mas isso não
      // força leitura de perfil para centenas de clientes.
      const idsIdentidadeVisivel = Array.from(new Set([
        ...listaBase.map((e) => e.clienteId),
        ...listaParticipantesBase.map((e) => e.clienteId),
        clienteId,
      ]));
      const identidadesPublicas = await projetarIdentidadesPublicasRanking(idsIdentidadeVisivel);

      const lista = listaBase.map((e) => {
        const participaCampanha = participacoes.get(e.clienteId) === true;
        const nomePublico = identidadesPublicas.get(e.clienteId)?.nomePublico ?? null;
        return {
          posicao: e.posicao,
          score: e.score,
          eVoce: e.clienteId === clienteId,
          participaCampanha,
          ...(participaCampanha
            ? {
                ...(nomePublico ? { nomePublico } : {}),
                codinomeSecreto: codinomeSecretoRanking(e.clienteId, temporada.temporadaId),
              }
            : {}),
        };
      });
      // Selo social (Campeão/Prata/Bronze/Elite) de CADA membro do Top 10
      // atual, não só do cliente autenticado — correção de blocker da
      // auditoria do #446 ("UI só colocava selo em quem estava logado").
      // Escopo limitado ao Top 10 (o mesmo recorte do selo em si) para não
      // disparar uma leitura extra por participante da lista inteira.
      const statusPorClienteId = new Map<string, StatusTemporada>(
        await Promise.all(
          listaParticipantesBase
            .filter((e) => e.posicao <= 10)
            .map(async (e): Promise<[string, StatusTemporada]> => {
              const vigente = await obterStatusSocialVigente(tenantId, e.clienteId);
              return [e.clienteId, vigente?.status ?? null];
            }),
        ),
      );
      const listaParticipantes = listaParticipantesBase.map((e) => {
        const status = statusPorClienteId.get(e.clienteId) ?? null;
        const nomePublico = identidadesPublicas.get(e.clienteId)?.nomePublico ?? null;
        return {
          posicao: e.posicao,
          score: e.score,
          eVoce: e.clienteId === clienteId,
          participaCampanha: true as const,
          ...(nomePublico ? { nomePublico } : {}),
          codinomeSecreto: codinomeSecretoRanking(e.clienteId, temporada.temporadaId),
          ...(status ? { statusSocial: status } : {}),
        };
      });

      // Snapshot diário para o histórico "subiu/desceu": grava a posição de
      // hoje de todo mundo (só na 1ª leitura do dia, ver rankingHistorico.ts)
      // e compara a do cliente autenticado contra o snapshot anterior real.
      const participantesPorId = new Map(reindexados.map((e) => [e.clienteId, e.posicao]));
      const snapshotHoje: SnapshotPosicoesDoDia = {};
      for (const e of completo) {
        snapshotHoje[e.clienteId] = { geral: e.posicao, participantes: participantesPorId.get(e.clienteId) ?? null };
      }
      const [, posicaoAnterior] = await Promise.all([
        garantirSnapshotDiario(tenantId, temporada.temporadaId, snapshotHoje),
        obterPosicaoAnterior(tenantId, temporada.temporadaId, clienteId),
      ]);
      const variacaoPosicao = calcularVariacaoPosicao(posicaoAnterior?.geral, pos.posicao);
      const variacaoPosicaoParticipantes = proprioEntreParticipantes
        ? calcularVariacaoPosicao(posicaoAnterior?.participantes, proprioEntreParticipantes.posicao)
        : null;

      // Fatos de negócio (subiu/entrou Top 10/entrou Top 3/chegou ou
      // recuperou/perdeu a liderança) — SEMPRE calculados e registrados aqui
      // no servidor, nunca pelo navegador (correção do #445). Escopo entre
      // PARTICIPANTES, a mesma posição que importa para a disputa/missão.
      // Idempotente por dia: a variação só muda uma vez por dia (mesmo
      // snapshot diário do histórico), então reabrir a tela várias vezes no
      // mesmo dia nunca conta o fato de novo.
      if (proprioEntreParticipantes) {
        const posicaoAtualParticipantes = proprioEntreParticipantes.posicao;
        const posicaoAnteriorParticipantes = posicaoAnterior?.participantes;
        const chegouOuVoltouAoTopo = posicaoAtualParticipantes === 1 && posicaoAnteriorParticipantes !== 1;
        const jaFoiLider = chegouOuVoltouAoTopo
          ? await marcarLiderancaEVerificarSeJaFoiLider(tenantId, temporada.temporadaId, clienteId)
          : false;
        const fatosPosicao = detectarFatosDePosicao({
          posicaoAnterior: posicaoAnteriorParticipantes,
          posicaoAtual: posicaoAtualParticipantes,
          jaFoiLiderNestaTemporada: jaFoiLider,
        });
        if (fatosPosicao.length > 0) {
          const eventoIdDoDia = `${clienteId}:${temporada.temporadaId}:${dataReferenciaUtc(new Date())}`;
          await Promise.all(fatosPosicao.map((tipo) => registrarFatoRankingGamificacao(tipo, eventoIdDoDia)));
          // Impulso do Pódio — bônus limitado e com teto, concedido quando o
          // cliente entra no Top 3. Idempotente pelo mesmo eventoId diário
          // (nunca credita duas vezes no mesmo dia) e sempre fail-closed sem
          // config do admin.
          if (fatosPosicao.includes("entrou_top3")) {
            await aplicarImpulsoPodioSeElegivel({
              tenantId,
              temporadaId: temporada.temporadaId,
              clienteId,
              eventoId: `impulsoPodio:${eventoIdDoDia}`,
            });
          }
        }
      }

      // reindexados é 1..N sequencial (reindexarPorFiltro), então o índice do
      // array já corresponde a posicao-1 — nenhuma busca extra é necessária
      // para achar quem está imediatamente acima/abaixo do próprio cliente.
      const meuIndice = proprioEntreParticipantes ? proprioEntreParticipantes.posicao - 1 : -1;
      const entradaAcima = meuIndice > 0 ? reindexados[meuIndice - 1] : null;
      const entradaAbaixo = meuIndice >= 0 && meuIndice < reindexados.length - 1 ? reindexados[meuIndice + 1] : null;
      const alvo = proprioEntreParticipantes
        ? calcularAlvoRankingAtual({
            posicaoAtual: proprioEntreParticipantes.posicao,
            scoreAtual: proprioEntreParticipantes.score,
            totalParticipantes: reindexados.length,
            entradaAcima: entradaAcima ? { posicao: entradaAcima.posicao, score: entradaAcima.score } : null,
            entradaAbaixo: entradaAbaixo ? { posicao: entradaAbaixo.posicao, score: entradaAbaixo.score } : null,
          })
        : null;
      const identidadesDisputa = new Map(
        idsRelevantes.map((id) => {
          const participaCampanha = participacoes.get(id) === true;
          const nomeAutorizado = identidadesPublicas.get(id)?.nomePublico ?? null;
          return [id, {
            participaCampanha,
            nomePublico: participaCampanha
              ? (nomeAutorizado || codinomeSecretoRanking(id, temporada.temporadaId))
              : null,
            telefoneMascarado: null,
            fotoPerfilUrl: null,
          }] as const;
        }),
      );
      const disputa = proprioEntreParticipantes
        ? montarDisputaRelativa({ ordenados: reindexados, clienteId, identidades: identidadesDisputa })
        : null;

      ranking = {
        posicao: pos.posicao,
        score: pos.score,
        participaCampanha: participacoes.get(clienteId) === true,
        entorno,
        lista,
        variacaoPosicao,
        participantes: {
          posicao: proprioEntreParticipantes?.posicao ?? null,
          total: reindexados.length,
          variacaoPosicao: variacaoPosicaoParticipantes,
          lista: listaParticipantes,
          alvo,
          disputa,
        },
      };
    }
  }

  // Regra oficial de estrelas: nunca hardcoded no frontend. A UI só pode
  // sugerir "indicar amigo" como caminho para subir quando as Estrelas V1
  // estão realmente ativas — nunca inventa o valor do crédito.
  const configFidelidade = await obterConfigFidelidadePontos();
  // Extrato completo buscado no máximo uma vez, reaproveitado pelo Nível de
  // Chef (XP) e pelo "batizado" (backdating) da missão semanal — nenhum dos
  // dois inventa dado, os dois só leem o mesmo histórico real do cliente.
  let extratoCompleto: Awaited<ReturnType<typeof obterExtratoPontos>> | null = null;
  const precisaExtrato = (configGamificacao.nivelChefAtivo && configGamificacao.nivelChefLimiares.length > 0)
    || configGamificacao.missaoSemanalAtiva;
  if (precisaExtrato) {
    extratoCompleto = await obterExtratoPontos(clienteId);
  }

  // Convites só ficam disponíveis depois de um pedido comercial confirmado.
  // A origem/evento do ledger é a autoridade: bônus de indicação, apoio e
  // ajustes nunca podem desbloquear o compartilhamento por engano. Se a
  // leitura opcional falhar, o estado permanece bloqueado (fail-closed) sem
  // derrubar o painel do cliente.
  let extratoParaIndicacao = extratoCompleto;
  if (estrelasV1Ativa(configFidelidade) && !extratoParaIndicacao) {
    try {
      extratoParaIndicacao = await obterExtratoPontos(clienteId);
    } catch {
      extratoParaIndicacao = null;
    }
  }
  const pedidosConfirmados = new Set(
    (extratoParaIndicacao ?? [])
      .filter((movimento) => movimento.tipo === "confirmado" && movimento.pedidoId && movimento.eventoId?.startsWith("confirmado:") && classificarOrigemMovimentoPontos(movimento.eventoId) === "pedido")
      .map((movimento) => movimento.pedidoId as string),
  );
  const pedidosInvalidados = new Set(
    (extratoParaIndicacao ?? [])
      .filter((movimento) => (movimento.tipo === "cancelado" || movimento.tipo === "estornado") && movimento.pedidoId)
      .map((movimento) => movimento.pedidoId as string),
  );
  const compartilhamentoLiberado = [...pedidosConfirmados].some((pedidoId) => !pedidosInvalidados.has(pedidoId));
  const indicacao = estrelasV1Ativa(configFidelidade)
    ? { ativa: true as const, estrelasPrimeiraCompra: ESTRELAS_INDICACAO_PRIMEIRA_COMPRA, compartilhamentoLiberado }
    : { ativa: false as const, estrelasPrimeiraCompra: null, compartilhamentoLiberado: false };

  // Nível de Chef — progressão PERMANENTE, independente de temporada/ranking
  // (por isso calculada fora do bloco `if (temporada)`). Fail-closed: sem
  // limiares configurados pelo admin, o campo fica ausente na resposta e a
  // UI nunca mostra um "Nível 0" inventado.
  let nivelChef: { nivel: number; nome: string | null; xpAtual: number; xpProximoNivel: number | null } | null = null;
  if (configGamificacao.nivelChefAtivo && configGamificacao.nivelChefLimiares.length > 0 && extratoCompleto) {
    const xp = calcularXpChefDosMovimentos(extratoCompleto);
    const nivel = calcularNivelChef(xp, configGamificacao.nivelChefLimiares);
    if (nivel.nivel > 0) {
      await sincronizarNivelChefCliente(tenantId, clienteId, nivel.nivel);
      nivelChef = nivel;
    }
  }

  // Status social (Campeão/Prata/Bronze/Elite) herdado do Top 10 da
  // temporada anterior, bônus de competição já refletido no score acima, e
  // missões da temporada — tudo fail-closed sem config/temporada.
  let statusSocial: "campeao" | "prata" | "bronze" | "elite" | null = null;
  let bonusCompeticao = 0;
  let missaoDivulgacao: { concluidaHoje: boolean; bonus: number; elegivel: boolean } | null = null;
  let missaoSemanal: { status: "inativa" | "desbloqueada" | "processando" | "consumida" } | null = null;
  let missaoIndicacao: { concluida: boolean } | null = null;
  const missaoFotoPerfil = configGamificacao.missaoFotoPerfilAtiva && configGamificacao.missaoFotoPerfilBonus > 0 && temporada && participaRanking
    ? {
        concluida: Boolean(cliente.rankingFotoBonusConcedidoEm),
        bonus: configGamificacao.missaoFotoPerfilBonus,
      }
    : null;
  let movimentoRecente: MovimentoRecente | null = null;
  let coroaAmeacada = false;
  if (temporada && participaRanking) {
    const statusVigente = await sincronizarStatusSocialCliente(tenantId, temporada, clienteId);
    statusSocial = statusVigente?.status ?? null;
    bonusCompeticao = await obterBonusCompeticaoDaTemporada(tenantId, temporada.temporadaId, clienteId);

    if (configGamificacao.missaoDivulgacaoAtiva && configGamificacao.missaoDivulgacaoBonus > 0) {
      const expedienteId = chaveExpedienteOperacional();
      const movimentosBonus = await obterMovimentosBonusTemporada(tenantId, temporada.temporadaId, clienteId);
      const concluidaHoje = movimentosBonus.some((movimento) =>
        movimento.tipo === "missao_divulgacao_diaria" &&
        movimento.eventoId === `missao_divulgacao_diaria:${expedienteId}` &&
        movimento.pontos > 0
      );
      missaoDivulgacao = {
        concluidaHoje,
        bonus: configGamificacao.missaoDivulgacaoBonus,
        elegivel: compartilhamentoLiberado,
      };
    }

    if (configGamificacao.missaoSemanalAtiva) {
      const ultimoPedidoConfirmadoConhecido = extratoCompleto
        ? calcularUltimoPedidoConfirmadoDosMovimentos(extratoCompleto)
        : null;
      const estadoMissaoSemanal = await sincronizarMissaoSemanalCliente({
        tenantId,
        temporadaId: temporada.temporadaId,
        clienteId,
        participaCampanha: ranking?.participaCampanha ?? false,
        posicaoAtual: ranking?.participantes.posicao ?? null,
        agora: new Date(),
        ultimoPedidoConfirmadoConhecido,
      });
      missaoSemanal = { status: estadoMissaoSemanal.status };
    }
    if (configGamificacao.missaoIndicacaoAtiva) {
      const estadoMissaoIndicacao = await obterEstadoMissaoIndicacao(tenantId, temporada.temporadaId, clienteId);
      missaoIndicacao = { concluida: estadoMissaoIndicacao.concluida };
    }

    // "Movimento recente" — conceito separado do snapshot diário
    // (variacaoPosicao acima): compara contra a última vez que ESTE cliente
    // abriu o painel, nunca contra "ontem" quando a referência real é outra.
    const posicaoParaMovimento = ranking?.participantes.posicao ?? null;
    if (posicaoParaMovimento !== null) {
      movimentoRecente = await sincronizarMovimentoRecente(tenantId, temporada.temporadaId, clienteId, posicaoParaMovimento);
    }

    // "Defenda sua Coroa" — referência DINÂMICA, baseada no ticket médio
    // elegível da semana operacional anterior completa. O ticket é convertido
    // pela mesma regra oficial de Estrelas e serve apenas como distância de
    // competição: não credita saldo, não altera fidelidade e não muda prêmio.
    //
    // Fail-closed: se o histórico semanal ainda não existir/estiver
    // indisponível, a UI mostra somente a distância neutra e nunca inventa
    // uma ameaça.
    const alvoDoCliente = ranking?.participantes.alvo ?? null;
    if (alvoDoCliente && alvoDoCliente.estado === "liderando") {
      try {
        const referenciaCoroa = await obterReferenciaCoroaDinamica(tenantId);
        coroaAmeacada = calcularCoroaAmeacada(
          alvoDoCliente.vantagem,
          referenciaCoroa?.maxGapEstrelas ?? 0,
        );
      } catch {
        console.error("[ranking-coroa-dinamica] falha ao ler histórico semanal");
        coroaAmeacada = false;
      }
    }
  }

  return NextResponse.json({
    temporada: temporada
      ? {
          nome: temporada.nome ?? null,
          diasRestantes: temporada.fimEm ? diasRestantes(temporada.fimEm) : null,
          fimEm: temporada.fimEm ?? null,
          estado: temporada.estado,
          // Fail-closed: só chega premio != null quando o admin aprovou
          // explicitamente (mesma regra de temporadaResultado.ts) — nunca
          // promete prêmio a partir de um valor parcialmente configurado.
          premio: temporada.premioAprovado === true && (temporada.premioQuantidadePremiados ?? 0) > 0
            ? {
                descricao: temporada.premioDescricao ?? null,
                quantidadePremiados: temporada.premioQuantidadePremiados as number,
              }
            : null,
        }
      : null,
    ranking,
    indicacao,
    // Gamificação V2 — cada campo é null/ausente quando o admin não
    // configurou aquela mecânica (fail-closed): a UI nunca mostra um selo,
    // missão ou nível que não foi explicitamente ligado.
    gamificacao: {
      statusSocial,
      bonusCompeticao,
      missaoSemanal,
      missaoIndicacao,
      missaoFotoPerfil,
      missaoDivulgacao,
      movimentoRecente,
      coroaAmeacada,
      nivelChef,
    },
  });
}
