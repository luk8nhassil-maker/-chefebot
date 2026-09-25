// Estado persistido da missão da temporada "Indique um amigo" — reaproveita
// 100% a infraestrutura real de indicação (indicacaoToken/estrelasIndicacao);
// este módulo só decide se a indicação, já confirmada e creditada de
// verdade, também conclui a missão 0/1 da temporada e credita o bônus de
// competição configurado (nunca cria uma indicação paralela).
import "server-only";
import { redis } from "./redis";
import {
  concluirMissaoIndicacaoTemporada,
  ESTADO_MISSAO_INDICACAO_INICIAL,
  type EstadoMissaoIndicacaoTemporada,
} from "./rankingGamificacao";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { creditarBonusCompeticao } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";

function chaveEstado(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoIndicacao:${tenantId}:${temporadaId}:${clienteId}`;
}

export async function obterEstadoMissaoIndicacao(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<EstadoMissaoIndicacaoTemporada> {
  const salvo = await redis.get<EstadoMissaoIndicacaoTemporada>(chaveEstado(tenantId, temporadaId, clienteId));
  return salvo ?? ESTADO_MISSAO_INDICACAO_INICIAL;
}

export type ResultadoMissaoIndicacao = { concluida: boolean; bonusCreditado: number };

/**
 * Chamada no MESMO efeito idempotente que credita a indicação real
 * (fidelidadeEfeitos.ts, dentro de `resultadoIndicacao === "creditado"`).
 * `clienteId` aqui é sempre o INDICADOR (quem indicou), nunca o indicado —
 * é ele quem cumpre a missão da temporada. Fail-closed sem config ativa.
 */
export async function concluirMissaoIndicacaoNoPedido(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  pedidoId: string;
  agora: Date;
}): Promise<ResultadoMissaoIndicacao> {
  const { tenantId, temporadaId, clienteId, pedidoId, agora } = params;
  const config = await obterConfigGamificacao();
  if (!config.missaoIndicacaoAtiva) return { concluida: false, bonusCreditado: 0 };

  const estadoAtual = await obterEstadoMissaoIndicacao(tenantId, temporadaId, clienteId);
  const novoEstado = concluirMissaoIndicacaoTemporada({ estadoAtual, pedidoId, agora });
  if (!novoEstado) return { concluida: false, bonusCreditado: 0 };
  await redis.set(chaveEstado(tenantId, temporadaId, clienteId), novoEstado);

  const bonus = Number.isFinite(config.missaoIndicacaoBonus) && config.missaoIndicacaoBonus > 0
    ? Math.round(config.missaoIndicacaoBonus)
    : 0;
  if (bonus <= 0) return { concluida: true, bonusCreditado: 0 };

  const resultado = await creditarBonusCompeticao({
    tenantId,
    temporadaId,
    clienteId,
    eventoId: `missaoIndicacao:${temporadaId}:${clienteId}`,
    tipo: "missao_indicacao",
    pontos: bonus,
    motivo: `Indique um amigo — indicação confirmada no pedido ${pedidoId}`,
  });
  if (resultado === "creditado") {
    await registrarFatoRankingGamificacao("missao_indicacao_concluida", `${clienteId}:${temporadaId}`);
  }
  return { concluida: true, bonusCreditado: bonus };
}
