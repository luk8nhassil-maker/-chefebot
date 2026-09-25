// GET /api/cliente/fidelidade/painel — dados de temporada e ranking para a
// view do cliente. Agrega em uma única chamada para reduzir round-trips.
//
// Segurança: clienteId NUNCA exposto no ranking — apenas posicao e eVoce.
// Sem PII de outros participantes.

import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone, estrelasV1Ativa, obterConfigFidelidadePontos, obterExtratoPontos } from "@/lib/fidelidade";
import { ESTRELAS_INDICACAO_PRIMEIRA_COMPRA } from "@/lib/estrelasIndicacao";
import { obterTemporadaAtiva } from "@/lib/temporadas";
import { posicaoClienteRanking, obterTopRanking, obterRankingCompleto, reindexarPorFiltro } from "@/lib/rankingClientes";
import { projetarIdentidadesPublicasRanking } from "@/lib/rankingPrivacidade";
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
import { calcularNivelChef, calcularXpChefDosMovimentos } from "@/lib/rankingGamificacao";
import { obterConfigGamificacao } from "@/lib/rankingGamificacaoConfig";
import { obterBonusCompeticaoDaTemporada } from "@/lib/rankingBonusTemporada";
import { aplicarCarryoverClienteSeNecessario, sincronizarStatusSocialCliente, reconciliarTransicaoTemporada } from "@/lib/rankingTransicaoTemporada";
import { sincronizarMissaoSemanalCliente } from "@/lib/rankingMissaoSemanalEstado";
import { obterEstadoMissaoIndicacao } from "@/lib/rankingMissaoIndicacaoEstado";
import { aplicarImpulsoPodioSeElegivel } from "@/lib/rankingImpulsoPodioEstado";
import { sincronizarNivelChefCliente } from "@/lib/rankingNivelChefEstado";

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

  const temporada = await obterTemporadaAtiva(tenantId);
  const configGamificacao = await obterConfigGamificacao();

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
      }[];
      // Alvo atual ("faltam N estrelas para o #Y") e disputa relativa
      // (vizinho acima/abaixo), sempre calculados entre PARTICIPANTES — é a
      // única posição que importa para quem disputa o prêmio da temporada.
      // `null` só quando o próprio cliente ainda não tem posição aqui.
      alvo: AlvoRankingAtual | null;
      disputa: DisputaRelativa | null;
    };
  } | null = null;

  if (temporada) {
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
      // Uma única projeção cobre o ranking geral exibido e o ranking completo
      // usado para recalcular a posição entre participantes — evita duas
      // rodadas de leitura de consentimento para os mesmos clientes.
      const idsRelevantes = Array.from(new Set([
        ...listaBase.map((e) => e.clienteId),
        ...completo.map((e) => e.clienteId),
        clienteId,
      ]));
      const identidades = await projetarIdentidadesPublicasRanking(idsRelevantes);
      const lista = listaBase.map((e) => {
        const identidade = identidades.get(e.clienteId);
        return {
          posicao: e.posicao,
          score: e.score,
          eVoce: e.clienteId === clienteId,
          participaCampanha: identidade?.participaCampanha ?? false,
          ...(identidade?.nomePublico ? { nomePublico: identidade.nomePublico } : {}),
          ...(identidade?.telefoneMascarado ? { telefoneMascarado: identidade.telefoneMascarado } : {}),
        };
      });

      const reindexados = reindexarPorFiltro(
        completo,
        (id) => identidades.get(id)?.participaCampanha === true,
      );
      const LIMITE_PARTICIPANTES = 50;
      const topoParticipantes = reindexados.slice(0, LIMITE_PARTICIPANTES);
      const proprioEntreParticipantes = reindexados.find((e) => e.clienteId === clienteId) ?? null;
      const listaParticipantesBase =
        proprioEntreParticipantes && !topoParticipantes.some((e) => e.clienteId === clienteId)
          ? [...topoParticipantes, proprioEntreParticipantes]
          : topoParticipantes;
      const listaParticipantes = listaParticipantesBase.map((e) => {
        const identidade = identidades.get(e.clienteId);
        return {
          posicao: e.posicao,
          score: e.score,
          eVoce: e.clienteId === clienteId,
          participaCampanha: true as const,
          ...(identidade?.nomePublico ? { nomePublico: identidade.nomePublico } : {}),
          ...(identidade?.telefoneMascarado ? { telefoneMascarado: identidade.telefoneMascarado } : {}),
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
      const disputa = proprioEntreParticipantes
        ? montarDisputaRelativa({ ordenados: reindexados, clienteId, identidades })
        : null;

      ranking = {
        posicao: pos.posicao,
        score: pos.score,
        participaCampanha: identidades.get(clienteId)?.participaCampanha ?? false,
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
  const indicacao = estrelasV1Ativa(configFidelidade)
    ? { ativa: true as const, estrelasPrimeiraCompra: ESTRELAS_INDICACAO_PRIMEIRA_COMPRA }
    : { ativa: false as const, estrelasPrimeiraCompra: null };

  // Nível de Chef — progressão PERMANENTE, independente de temporada/ranking
  // (por isso calculada fora do bloco `if (temporada)`). Fail-closed: sem
  // limiares configurados pelo admin, o campo fica ausente na resposta e a
  // UI nunca mostra um "Nível 0" inventado.
  let nivelChef: { nivel: number; nome: string | null; xpAtual: number; xpProximoNivel: number | null } | null = null;
  if (configGamificacao.nivelChefAtivo && configGamificacao.nivelChefLimiares.length > 0) {
    const extratoCompleto = await obterExtratoPontos(clienteId);
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
  let missaoSemanal: { status: "inativa" | "desbloqueada" | "processando" | "consumida" } | null = null;
  let missaoIndicacao: { concluida: boolean } | null = null;
  if (temporada) {
    const statusVigente = await sincronizarStatusSocialCliente(tenantId, temporada, clienteId);
    statusSocial = statusVigente?.status ?? null;
    bonusCompeticao = await obterBonusCompeticaoDaTemporada(tenantId, temporada.temporadaId, clienteId);
    if (configGamificacao.missaoSemanalAtiva) {
      const estadoMissaoSemanal = await sincronizarMissaoSemanalCliente({
        tenantId,
        temporadaId: temporada.temporadaId,
        clienteId,
        participaCampanha: ranking?.participaCampanha ?? false,
        posicaoAtual: ranking?.participantes.posicao ?? null,
        agora: new Date(),
      });
      missaoSemanal = { status: estadoMissaoSemanal.status };
    }
    if (configGamificacao.missaoIndicacaoAtiva) {
      const estadoMissaoIndicacao = await obterEstadoMissaoIndicacao(tenantId, temporada.temporadaId, clienteId);
      missaoIndicacao = { concluida: estadoMissaoIndicacao.concluida };
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
      nivelChef,
    },
  });
}
