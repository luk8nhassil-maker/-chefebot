// Estado persistido da missão da temporada "Indique um amigo" — reaproveita
// 100% a infraestrutura real de indicação (indicacaoToken/estrelasIndicacao);
// este módulo só decide se a indicação, já confirmada e creditada de
// verdade, também conclui a missão 0/1 da temporada e credita o bônus de
// competição configurado (nunca cria uma indicação paralela).
//
// Consumo atômico e retomável (mesmo princípio da missão semanal): reservar
// e confirmar rodam sob o lock exclusivo do (tenant, temporada, indicador),
// e uma falha entre reservar e creditar deixa uma reserva retomável — nunca
// perde nem duplica o bônus.
import "server-only";
import { redis } from "./redis";
import {
  reservarMissaoIndicacaoTemporada,
  confirmarMissaoIndicacaoTemporada,
  reverterMissaoIndicacaoTemporada,
  ESTADO_MISSAO_INDICACAO_INICIAL,
  type EstadoMissaoIndicacaoTemporada,
} from "./rankingGamificacao";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { creditarBonusCompeticao, estornarBonusCompeticao } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";
import { comBloqueioGamificacao } from "./rankingGamificacaoLock";

function chaveEstado(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoIndicacao:${tenantId}:${temporadaId}:${clienteId}`;
}

function chaveLock(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoIndicacao:lock:${tenantId}:${temporadaId}:${clienteId}`;
}

// Migalha por pedido (mesmo padrão da missão semanal): permite reverter no
// cancelamento tardio sem depender de saber qual é a temporada "atual".
function chaveBreadcrumbPedido(pedidoId: string): string {
  return `ranking:missaoIndicacao:pedido:${pedidoId}`;
}

type BreadcrumbPedido = {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  bonus: number;
  /**
   * eventoId REAL usado no crédito do ledger de bônus — guardado aqui (nunca
   * reconstruído por interpolação de string no momento do estorno) para o
   * cancelamento tardio sempre estornar o evento certo, mesmo que o formato
   * do eventoId mude no futuro.
   */
  eventoIdBonus: string;
};

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

  return comBloqueioGamificacao(chaveLock(tenantId, temporadaId, clienteId), async () => {
    const estadoAtual = await obterEstadoMissaoIndicacao(tenantId, temporadaId, clienteId);
    const reservado = reservarMissaoIndicacaoTemporada({ estadoAtual, pedidoId });
    if (!reservado) return { concluida: false, bonusCreditado: 0 };
    await redis.set(chaveEstado(tenantId, temporadaId, clienteId), reservado);

    const bonus = Number.isFinite(config.missaoIndicacaoBonus) && config.missaoIndicacaoBonus > 0
      ? Math.round(config.missaoIndicacaoBonus)
      : 0;
    let bonusCreditado = 0;
    if (bonus > 0) {
      // eventoId inclui o pedidoId (correção de blocker): se uma conversão
      // anterior já foi creditada e depois ESTORNADA (cancelamento tardio),
      // uma NOVA conversão válida (outro pedidoId) precisa de um eventoId
      // diferente para poder creditar de novo — com um eventoId fixo por
      // (temporada, cliente), o ledger via o crédito antigo ainda presente e
      // devolvia "ja_creditado" sem nunca escrever o novo movimento, deixando
      // a missão "concluída" com bônus líquido zero.
      const eventoIdBonus = `missaoIndicacao:${temporadaId}:${clienteId}:${pedidoId}`;
      const resultado = await creditarBonusCompeticao({
        tenantId,
        temporadaId,
        clienteId,
        eventoId: eventoIdBonus,
        tipo: "missao_indicacao",
        pontos: bonus,
        motivo: `Indique um amigo — indicação confirmada no pedido ${pedidoId}`,
      });
      // "creditado" ou "ja_creditado" (retry pós-falha) precisam convergir
      // para o MESMO estado final íntegro — nunca só o primeiro (mesmo
      // blocker do consumo da missão semanal). "invalido" nunca cai aqui.
      if (resultado === "creditado" || resultado === "ja_creditado") {
        bonusCreditado = bonus;
        await redis.set(chaveBreadcrumbPedido(pedidoId), { tenantId, temporadaId, clienteId, bonus, eventoIdBonus } satisfies BreadcrumbPedido);
        await registrarFatoRankingGamificacao("missao_indicacao_concluida", `${clienteId}:${temporadaId}:${pedidoId}`);
        await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
      }
    }

    const confirmado = confirmarMissaoIndicacaoTemporada({ estadoAtual: reservado, pedidoId, agora });
    if (confirmado) {
      await redis.set(chaveEstado(tenantId, temporadaId, clienteId), confirmado);
    }
    return { concluida: true, bonusCreditado };
  });
}

/**
 * Cancelamento tardio: se o pedido que originou a primeira compra do
 * indicado for corrigido para cancelado DEPOIS de já ter concluído a missão
 * (ou de estar no meio de concluir), reverte a missão e estorna o bônus —
 * nunca deixa uma vantagem baseada num pedido comercial inválido. Idempotente
 * e sem efeito quando este pedido nunca reservou/concluiu nada.
 */
export async function reverterMissaoIndicacaoDoPedido(pedidoId: string, motivo: string): Promise<void> {
  if (!pedidoId) return;
  const breadcrumb = await redis.get<BreadcrumbPedido>(chaveBreadcrumbPedido(pedidoId));
  if (!breadcrumb) return;

  await comBloqueioGamificacao(chaveLock(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId), async () => {
    const estadoAtual = await obterEstadoMissaoIndicacao(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId);
    const revertido = reverterMissaoIndicacaoTemporada({ estadoAtual, pedidoId });
    if (revertido) {
      await redis.set(chaveEstado(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId), revertido);
    }
    const resultado = await estornarBonusCompeticao({
      tenantId: breadcrumb.tenantId,
      temporadaId: breadcrumb.temporadaId,
      clienteId: breadcrumb.clienteId,
      // Sempre o eventoId REAL guardado na migalha — nunca reconstruído por
      // interpolação de string aqui (blocker: um formato antigo sem pedidoId
      // faria o estorno mirar um evento que talvez já não seja o crédito
      // certo depois de uma segunda conversão válida).
      eventoIdOriginal: breadcrumb.eventoIdBonus,
      motivo,
    });
    if (resultado === "estornado") {
      await sincronizarScoreTemporadaComBonus(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId);
    }
  });
}
