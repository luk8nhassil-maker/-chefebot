// Estado persistido da missão semanal "Caçada ao Pódio" — a parte com I/O
// que fica de fora de rankingGamificacao.ts (puro). Duas entradas:
// - sincronizarMissaoSemanalCliente: avaliada a cada leitura do painel do
//   cliente (lazy, sem cron — mesmo padrão do auto-expiry de temporadas.ts).
// - consumirMissaoSemanalNoPedido / reverterMissaoSemanalDoPedido: chamadas
//   pelo efeito "gamificacao" do pedido entregue/cancelado
//   (fidelidadeEfeitos.ts), sempre amarradas ao pedidoId exato.
//
// Consumo atômico e retomável (correção de dois blockers da auditoria do
// #446): reservar/confirmar passam pelo MESMO lock exclusivo do cliente —
// dois pedidos concorrentes nunca conseguem reservar a mesma missão
// desbloqueada, e uma falha entre reservar e confirmar deixa o estado em
// "processando" (nunca "consumida" sem o bônus garantido, nunca perdido) —
// um retry com o MESMO pedidoId sempre retoma e conclui com segurança.
import "server-only";
import { redis } from "./redis";
import {
  avaliarDesbloqueioMissaoSemanal,
  calcularBonusMissaoSemanal,
  reservarConsumoMissaoSemanal,
  confirmarConsumoMissaoSemanal,
  reverterConsumoMissaoSemanal,
  ESTADO_MISSAO_SEMANAL_INICIAL,
  type EstadoMissaoSemanal,
} from "./rankingGamificacao";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { creditarBonusCompeticao, estornarBonusCompeticao } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";
import { comBloqueioGamificacao } from "./rankingGamificacaoLock";

type RegistroMissaoSemanal = {
  estado: EstadoMissaoSemanal;
  ultimoPedidoElegivelEm: string | null;
};

const REGISTRO_INICIAL: RegistroMissaoSemanal = {
  estado: ESTADO_MISSAO_SEMANAL_INICIAL,
  ultimoPedidoElegivelEm: null,
};

function chaveRegistro(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoSemanal:${tenantId}:${temporadaId}:${clienteId}`;
}

function chaveLock(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:missaoSemanal:lock:${tenantId}:${temporadaId}:${clienteId}`;
}

// Migalha por pedido: guarda QUAL (tenant, temporada, cliente, bônus) esse
// pedido consumiu, para o cancelamento reverter sem precisar saber "qual é a
// temporada atual" — a temporada pode até já ter virado outra quando o
// cancelamento chega.
function chaveBreadcrumbPedido(pedidoId: string): string {
  return `ranking:missaoSemanal:pedido:${pedidoId}`;
}

type BreadcrumbPedido = { tenantId: string; temporadaId: string; clienteId: string; bonus: number };

async function obterRegistro(tenantId: string, temporadaId: string, clienteId: string): Promise<RegistroMissaoSemanal> {
  const salvo = await redis.get<RegistroMissaoSemanal>(chaveRegistro(tenantId, temporadaId, clienteId));
  return salvo ?? REGISTRO_INICIAL;
}

async function salvarRegistro(tenantId: string, temporadaId: string, clienteId: string, registro: RegistroMissaoSemanal): Promise<void> {
  await redis.set(chaveRegistro(tenantId, temporadaId, clienteId), registro);
}

export async function obterEstadoMissaoSemanal(tenantId: string, temporadaId: string, clienteId: string): Promise<EstadoMissaoSemanal> {
  return (await obterRegistro(tenantId, temporadaId, clienteId)).estado;
}

/**
 * Reavalia o desbloqueio a cada leitura do painel. Fail-closed: sem
 * `missaoSemanalAtiva` na config do admin, sempre retorna o estado inicial
 * (missão nunca aparece, nunca é avaliada, nunca escreve nada no Redis).
 * Roda sob o mesmo lock do cliente para nunca correr por cima de uma
 * reserva de consumo em andamento.
 */
export async function sincronizarMissaoSemanalCliente(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  participaCampanha: boolean;
  posicaoAtual: number | null;
  agora: Date;
}): Promise<EstadoMissaoSemanal> {
  const { tenantId, temporadaId, clienteId, participaCampanha, posicaoAtual, agora } = params;
  const config = await obterConfigGamificacao();
  if (!config.missaoSemanalAtiva) return ESTADO_MISSAO_SEMANAL_INICIAL;

  return comBloqueioGamificacao(chaveLock(tenantId, temporadaId, clienteId), async () => {
    const registro = await obterRegistro(tenantId, temporadaId, clienteId);
    const novoEstado = avaliarDesbloqueioMissaoSemanal({
      estadoAtual: registro.estado,
      participaCampanha,
      posicaoAtual,
      ultimoPedidoElegivelEm: registro.ultimoPedidoElegivelEm,
      agora,
      cooldownDias: config.missaoSemanalCooldownDias,
    });
    if (novoEstado !== registro.estado) {
      await salvarRegistro(tenantId, temporadaId, clienteId, { ...registro, estado: novoEstado });
      if (novoEstado.status === "desbloqueada") {
        await registrarFatoRankingGamificacao("missao_semanal_desbloqueada", `${clienteId}:${temporadaId}:${novoEstado.desbloqueadaEm}`);
      }
    }
    return novoEstado;
  });
}

export type ResultadoConsumoMissaoSemanal = { consumida: boolean; bonusCreditado: number };

/**
 * Chamada pelo efeito "gamificacao" de um pedido entregue. Sempre atualiza
 * "último pedido elegível" (alimenta o cooldown de desbloqueio), e só
 * consome/credita quando havia uma missão desbloqueada — nunca cria bônus a
 * partir do nada.
 *
 * Consumo atômico e retomável: TODA a seção (reservar → creditar →
 * confirmar) roda sob o lock exclusivo do cliente. Se o processo cair entre
 * reservar e confirmar, o estado fica "processando" com este `pedidoId` — um
 * retry (mesmo pedidoId) reentra no lock, vê a reserva já é sua, e retoma o
 * crédito (idempotente por eventoId) até confirmar. Nunca perde, nunca
 * duplica o bônus.
 */
export async function consumirMissaoSemanalNoPedido(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  pedidoId: string;
  estrelasBaseDoPedido: number;
  agora: Date;
}): Promise<ResultadoConsumoMissaoSemanal> {
  const { tenantId, temporadaId, clienteId, pedidoId, estrelasBaseDoPedido, agora } = params;
  const config = await obterConfigGamificacao();
  if (!config.missaoSemanalAtiva) {
    return { consumida: false, bonusCreditado: 0 };
  }

  return comBloqueioGamificacao(chaveLock(tenantId, temporadaId, clienteId), async () => {
    const registro = await obterRegistro(tenantId, temporadaId, clienteId);
    const atualizado: RegistroMissaoSemanal = { ...registro, ultimoPedidoElegivelEm: agora.toISOString() };

    const reservado = reservarConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId });
    if (!reservado) {
      await salvarRegistro(tenantId, temporadaId, clienteId, atualizado);
      return { consumida: false, bonusCreditado: 0 };
    }
    await salvarRegistro(tenantId, temporadaId, clienteId, { ...atualizado, estado: reservado });

    const bonus = calcularBonusMissaoSemanal(estrelasBaseDoPedido, config.missaoSemanalMultiplicador);
    let bonusCreditado = 0;
    if (bonus > 0) {
      const resultado = await creditarBonusCompeticao({
        tenantId,
        temporadaId,
        clienteId,
        eventoId: `missaoSemanal:${pedidoId}`,
        tipo: "missao_semanal",
        pontos: bonus,
        motivo: `Caçada ao Pódio — 2x no pedido ${pedidoId}`,
      });
      // "creditado" (primeira vez) ou "ja_creditado" (retry pós-falha, o
      // bônus já estava garantido) — os dois significam "o ledger tem esse
      // crédito agora", então os dois avançam para confirmar a missão.
      if (resultado === "creditado" || resultado === "ja_creditado") {
        bonusCreditado = bonus;
        if (resultado === "creditado") {
          await redis.set(chaveBreadcrumbPedido(pedidoId), { tenantId, temporadaId, clienteId, bonus } satisfies BreadcrumbPedido);
          await registrarFatoRankingGamificacao("missao_semanal_consumida", `${clienteId}:${temporadaId}:${pedidoId}`);
          await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
        }
      }
    }

    const confirmado = confirmarConsumoMissaoSemanal({ estadoAtual: reservado, pedidoId, agora });
    if (confirmado) {
      const registroAtual = await obterRegistro(tenantId, temporadaId, clienteId);
      await salvarRegistro(tenantId, temporadaId, clienteId, { ...registroAtual, estado: confirmado });
    }
    return { consumida: true, bonusCreditado };
  });
}

/**
 * Chamada pelo efeito "gamificacao" de um pedido cancelado/estornado. Só
 * reverte se ESTE pedido exato foi o que reservou/consumiu a missão (a
 * migalha só existe quando houve ao menos uma tentativa real de consumo) —
 * nunca mexe no estado de outro pedido/cliente. Idempotente: chamar duas
 * vezes (retry) é seguro. Roda sob o mesmo lock do cliente.
 */
export async function reverterMissaoSemanalDoPedido(pedidoId: string, motivo: string): Promise<void> {
  if (!pedidoId) return;
  const breadcrumb = await redis.get<BreadcrumbPedido>(chaveBreadcrumbPedido(pedidoId));
  if (!breadcrumb) return;

  await comBloqueioGamificacao(chaveLock(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId), async () => {
    const registro = await obterRegistro(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId);
    const revertido = reverterConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId });
    if (revertido) {
      await salvarRegistro(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId, { ...registro, estado: revertido });
    }
    const resultado = await estornarBonusCompeticao({
      tenantId: breadcrumb.tenantId,
      temporadaId: breadcrumb.temporadaId,
      clienteId: breadcrumb.clienteId,
      eventoIdOriginal: `missaoSemanal:${pedidoId}`,
      motivo,
    });
    if (resultado === "estornado") {
      await sincronizarScoreTemporadaComBonus(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId);
    }
  });
}
