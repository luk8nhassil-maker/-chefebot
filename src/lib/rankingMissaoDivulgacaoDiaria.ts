import "server-only";

import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { obterTemporadaAtiva } from "./temporadas";
import { obterParticipacaoRanking } from "./consentimentoRanking";
import {
  creditarBonusCompeticao,
  obterMovimentosBonusTemporada,
} from "./rankingBonusTemporada";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";
import { lerEventosFallbackPedidos } from "./analyticsPedidosReadModel.server";
import { chaveExpedienteOperacional } from "./expedienteOperacional";

const TENANT_PADRAO = "default";

function eventoDoDia(indicadorId: string, agora = Date.now()): string {
  return `missao_divulgacao_diaria:${indicadorId}:${chaveExpedienteOperacional(agora)}`;
}

async function indicadoTemPedidoComercialAnterior(indicadoId: string): Promise<boolean> {
  try {
    // A fonte oficial de aquisição é o histórico real de pedidos entregues,
    // não apenas o ledger de Fidelidade — assim clientes antigos de antes da
    // implantação do ledger nunca são tratados como "novos" por engano.
    const eventos = await lerEventosFallbackPedidos(TENANT_PADRAO);
    return eventos.some(
      (evento) =>
        evento.statusAnalitico === "entregue" &&
        evento.clienteId === indicadoId,
    );
  } catch {
    // Fail-closed: se não conseguimos provar que a pessoa é nova, não paga
    // bônus de aquisição. A candidatura de indicação continua funcionando.
    return true;
  }
}

export type ResultadoMissaoDivulgacaoDiaria =
  | { status: "inativa" | "inelegivel" | "cliente_existente"; pontos: 0; temporadaId: string | null }
  | { status: "creditado" | "ja_creditado"; pontos: number; temporadaId: string };

export async function creditarMissaoDivulgacaoDiaria(params: {
  indicadorId: string;
  indicadoId: string;
  agora?: number;
}): Promise<ResultadoMissaoDivulgacaoDiaria> {
  const { indicadorId, indicadoId } = params;
  const agora = params.agora ?? Date.now();

  if (!indicadorId || !indicadoId || indicadorId === indicadoId) {
    return { status: "inelegivel", pontos: 0, temporadaId: null };
  }

  const [config, temporada, participa] = await Promise.all([
    obterConfigGamificacao(),
    obterTemporadaAtiva(TENANT_PADRAO),
    obterParticipacaoRanking(indicadorId).catch(() => false),
  ]);

  if (!config.missaoDivulgacaoDiariaAtiva || config.missaoDivulgacaoDiariaBonus <= 0) {
    return { status: "inativa", pontos: 0, temporadaId: temporada?.temporadaId ?? null };
  }
  if (!temporada || !participa) {
    return { status: "inelegivel", pontos: 0, temporadaId: temporada?.temporadaId ?? null };
  }
  if (await indicadoTemPedidoComercialAnterior(indicadoId)) {
    return { status: "cliente_existente", pontos: 0, temporadaId: temporada.temporadaId };
  }

  const eventoId = eventoDoDia(indicadorId, agora);
  const resultado = await creditarBonusCompeticao({
    tenantId: TENANT_PADRAO,
    temporadaId: temporada.temporadaId,
    clienteId: indicadorId,
    eventoId,
    tipo: "missao_divulgacao_diaria",
    pontos: config.missaoDivulgacaoDiariaBonus,
    motivo: "Embaixador do dia: nova pessoa entrou pelo link",
  });

  if (resultado === "invalido") {
    return { status: "inelegivel", pontos: 0, temporadaId: temporada.temporadaId };
  }

  await sincronizarScoreTemporadaComBonus(TENANT_PADRAO, temporada.temporadaId, indicadorId);
  return {
    status: resultado,
    pontos: config.missaoDivulgacaoDiariaBonus,
    temporadaId: temporada.temporadaId,
  };
}

export async function obterEstadoMissaoDivulgacaoDiaria(params: {
  temporadaId: string;
  indicadorId: string;
  agora?: number;
}): Promise<{ concluidaHoje: boolean }> {
  const eventoId = eventoDoDia(params.indicadorId, params.agora ?? Date.now());
  try {
    const movimentos = await obterMovimentosBonusTemporada(
      TENANT_PADRAO,
      params.temporadaId,
      params.indicadorId,
    );
    const concluidaHoje = movimentos.some(
      (movimento) =>
        movimento.tipo === "missao_divulgacao_diaria" &&
        movimento.eventoId === eventoId &&
        movimento.pontos > 0 &&
        !movimentos.some((estorno) => estorno.estornadoDeEventoId === movimento.eventoId),
    );
    return { concluidaHoje };
  } catch {
    return { concluidaHoje: false };
  }
}
