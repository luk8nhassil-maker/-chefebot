// GET /api/cliente/fidelidade/painel — dados de temporada e ranking para a
// view do cliente. Agrega em uma única chamada para reduzir round-trips.
//
// Segurança: clienteId NUNCA exposto no ranking — apenas posicao e eVoce.
// Sem PII de outros participantes.

import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
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
        },
      };
    }
  }

  return NextResponse.json({
    temporada: temporada
      ? {
          nome: temporada.nome ?? null,
          diasRestantes: temporada.fimEm ? diasRestantes(temporada.fimEm) : null,
          fimEm: temporada.fimEm ?? null,
          estado: temporada.estado,
        }
      : null,
    ranking,
  });
}
