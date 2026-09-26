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
import { creditarBonusCompeticao, estornarBonusCompeticao, obterMovimentosBonusTemporada } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";
import { comBloqueioGamificacao } from "./rankingGamificacaoLock";

function chaveEstado(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoIndicacao:${tenantId}:${temporadaId}:${clienteId}`;
}

function chaveLock(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoIndicacao:lock:${tenantId}:${temporadaId}:${clienteId}`;
}

// BLOCKER 7: metadado técnico (nunca de negócio) guardado numa chave
// SEPARADA do estado principal — nunca muda o formato de `chaveEstado`
// (evita qualquer risco de migração sobre dados já persistidos em
// produção). Usado só para decidir se uma reserva "processando" é
// candidata a reconciliação; ausente = nunca tratada como órfã.
function chaveProcessandoDesdeEm(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoIndicacao:processandoDesdeEm:${tenantId}:${temporadaId}:${clienteId}`;
}

// Limiar técnico (nunca de negócio) — bem acima de qualquer duração real de
// crédito no ledger, para nunca competir com uma reserva genuinamente em
// andamento.
const LIMIAR_MISSAO_INDICACAO_ORFA_MS = 5 * 60 * 1000;

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
 * BLOCKER 7: reconcilia uma reserva "processando" de OUTRO pedido, candidata
 * técnica a órfã (processo morreu de verdade). Chamada de DENTRO do lock
 * exclusivo já adquirido por `concluirMissaoIndicacaoNoPedido` — por isso
 * NUNCA usa `reverterMissaoIndicacaoDoPedido` nem `comBloqueioGamificacao` de
 * novo (o mesmo lock não é reentrante). NUNCA decide sozinha nem inventa um
 * crédito: só conclui o que o ledger já comprova (crédito real já existe →
 * confirma) ou o que o pedido real já decidiu (cancelado → estorna e
 * libera). Quando nada é decidível com segurança, devolve `null`.
 */
async function reconciliarMissaoIndicacaoOrfa(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  estadoAtual: EstadoMissaoIndicacaoTemporada;
}): Promise<EstadoMissaoIndicacaoTemporada | null> {
  const { tenantId, temporadaId, clienteId, estadoAtual } = params;
  const pedidoOrfaoId = estadoAtual.processandoPedidoId;
  if (!pedidoOrfaoId) return null;
  const desdeIso = await redis.get<string>(chaveProcessandoDesdeEm(tenantId, temporadaId, clienteId));
  const desdeMs = desdeIso ? new Date(desdeIso).getTime() : NaN;
  if (!Number.isFinite(desdeMs) || Date.now() - desdeMs <= LIMIAR_MISSAO_INDICACAO_ORFA_MS) return null;

  const pedidos = (await redis.get<{ id: string; status: string }[]>("pedidos")) ?? [];
  const pedidoOrfao = pedidos.find((item) => item.id === pedidoOrfaoId);
  const eventoIdBonus = `missaoIndicacao:${temporadaId}:${clienteId}:${pedidoOrfaoId}`;

  if (pedidoOrfao?.status === "cancelado") {
    const revertido = reverterMissaoIndicacaoTemporada({ estadoAtual, pedidoId: pedidoOrfaoId });
    const resultadoEstorno = await estornarBonusCompeticao({
      tenantId,
      temporadaId,
      clienteId,
      eventoIdOriginal: eventoIdBonus,
      motivo: "Reserva órfã reconciliada — pedido cancelado",
    });
    if (resultadoEstorno === "estornado") {
      await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
    }
    const novoEstado = revertido ?? estadoAtual;
    await redis.set(chaveEstado(tenantId, temporadaId, clienteId), novoEstado);
    await redis.del(chaveProcessandoDesdeEm(tenantId, temporadaId, clienteId));
    return novoEstado;
  }

  // Se o ledger já tem o crédito real deste pedido (crash entre creditar e
  // confirmar), só falta completar — nunca recreditar.
  const movimentos = await obterMovimentosBonusTemporada(tenantId, temporadaId, clienteId);
  const jaCreditado = movimentos.some((m) => m.eventoId === eventoIdBonus);
  if (jaCreditado) {
    await registrarFatoRankingGamificacao("missao_indicacao_concluida", `${clienteId}:${temporadaId}:${pedidoOrfaoId}`);
    await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
    const confirmado = confirmarMissaoIndicacaoTemporada({ estadoAtual, pedidoId: pedidoOrfaoId, agora: new Date() });
    const novoEstado = confirmado ?? estadoAtual;
    await redis.set(chaveEstado(tenantId, temporadaId, clienteId), novoEstado);
    await redis.del(chaveProcessandoDesdeEm(tenantId, temporadaId, clienteId));
    return novoEstado;
  }

  // Pedido não encontrado, ainda "entregue" sem crédito real, ou status
  // indeterminado — nunca decide/credita por conta própria. Nunca rouba;
  // devolve "não decidível".
  return null;
}

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
    let estadoAtual = await obterEstadoMissaoIndicacao(tenantId, temporadaId, clienteId);

    // BLOCKER 7: outro pedido tem a reserva "processando" — antes de tratar
    // isso silenciosamente como "nada a concluir", verifica se é candidata
    // técnica a órfã e tenta reconciliar o DONO usando só o que o ledger e o
    // pedido real já provam. Nunca "rouba" a reserva para ESTE pedido.
    if (estadoAtual.processandoPedidoId && estadoAtual.processandoPedidoId !== pedidoId) {
      const reconciliado = await reconciliarMissaoIndicacaoOrfa({ tenantId, temporadaId, clienteId, estadoAtual });
      if (!reconciliado) {
        // Ainda não é candidata a órfã, ou não foi possível decidir com
        // segurança — NUNCA abandona silenciosamente: vira retryable.
        throw new Error("ranking_missao_indicacao_em_processamento");
      }
      estadoAtual = reconciliado;
    }

    const reservado = reservarMissaoIndicacaoTemporada({ estadoAtual, pedidoId });
    if (!reservado) return { concluida: false, bonusCreditado: 0 };
    await redis.set(chaveEstado(tenantId, temporadaId, clienteId), reservado);
    const eraProcessandoDoMesmoPedido = estadoAtual.processandoPedidoId === pedidoId;
    if (!eraProcessandoDoMesmoPedido) {
      await redis.set(chaveProcessandoDesdeEm(tenantId, temporadaId, clienteId), agora.toISOString());
    }

    // eventoId inclui o pedidoId (correção de blocker): se uma conversão
    // anterior já foi creditada e depois ESTORNADA (cancelamento tardio),
    // uma NOVA conversão válida (outro pedidoId) precisa de um eventoId
    // diferente para poder creditar de novo — com um eventoId fixo por
    // (temporada, cliente), o ledger via o crédito antigo ainda presente e
    // devolvia "ja_creditado" sem nunca escrever o novo movimento, deixando
    // a missão "concluída" com bônus líquido zero. É determinístico (não
    // depende do resultado do crédito), então pode ser calculado já aqui.
    const eventoIdBonus = `missaoIndicacao:${temporadaId}:${clienteId}:${pedidoId}`;
    // BLOCKER 7: migalha ANTES de qualquer efeito financeiro — é o índice
    // durável que localiza o dono (tenant/temporada/cliente) e o eventoId
    // REAL desta reserva mesmo que o processo morra exatamente entre
    // reservar e creditar (antes, só era gravada DEPOIS do crédito).
    await redis.set(chaveBreadcrumbPedido(pedidoId), { tenantId, temporadaId, clienteId, bonus: 0, eventoIdBonus } satisfies BreadcrumbPedido);

    const bonus = Number.isFinite(config.missaoIndicacaoBonus) && config.missaoIndicacaoBonus > 0
      ? Math.round(config.missaoIndicacaoBonus)
      : 0;
    let bonusCreditado = 0;
    if (bonus > 0) {
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
      await redis.del(chaveProcessandoDesdeEm(tenantId, temporadaId, clienteId));
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
      await redis.del(chaveProcessandoDesdeEm(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId));
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
