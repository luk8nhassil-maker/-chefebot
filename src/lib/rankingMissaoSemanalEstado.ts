// Estado persistido da missão semanal "Caçada ao Pódio" — a parte com I/O
// que fica de fora de rankingGamificacao.ts (puro). Duas entradas:
// - sincronizarMissaoSemanalCliente: avaliada a cada leitura do painel do
//   cliente (lazy, sem cron — mesmo padrão do auto-expiry de temporadas.ts).
// - consumirMissaoSemanalNoPedido / reverterMissaoSemanalDoPedido: chamadas
//   pelo efeito "gamificacao" do pedido entregue/cancelado
//   (fidelidadeEfeitos.ts), sempre amarradas ao pedidoId exato.
import "server-only";
import { redis } from "./redis";
import {
  avaliarDesbloqueioMissaoSemanal,
  calcularBonusMissaoSemanal,
  consumirMissaoSemanal,
  reverterConsumoMissaoSemanal,
  ESTADO_MISSAO_SEMANAL_INICIAL,
  type EstadoMissaoSemanal,
} from "./rankingGamificacao";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { creditarBonusCompeticao, estornarBonusCompeticao } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";

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
}

export type ResultadoConsumoMissaoSemanal = { consumida: boolean; bonusCreditado: number };

/**
 * Chamada pelo efeito "gamificacao" de um pedido entregue. Sempre atualiza
 * "último pedido elegível" (alimenta o cooldown de desbloqueio), e só
 * consome/credita quando havia uma missão desbloqueada — nunca cria bônus a
 * partir do nada.
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
  const registro = await obterRegistro(tenantId, temporadaId, clienteId);

  if (!config.missaoSemanalAtiva) {
    return { consumida: false, bonusCreditado: 0 };
  }

  const atualizado: RegistroMissaoSemanal = { ...registro, ultimoPedidoElegivelEm: agora.toISOString() };
  const consumido = consumirMissaoSemanal({ estadoAtual: registro.estado, pedidoId, agora });
  if (!consumido) {
    await salvarRegistro(tenantId, temporadaId, clienteId, atualizado);
    return { consumida: false, bonusCreditado: 0 };
  }

  const bonus = calcularBonusMissaoSemanal(estrelasBaseDoPedido, config.missaoSemanalMultiplicador);
  await salvarRegistro(tenantId, temporadaId, clienteId, { ...atualizado, estado: consumido });
  if (bonus <= 0) return { consumida: true, bonusCreditado: 0 };

  const resultado = await creditarBonusCompeticao({
    tenantId,
    temporadaId,
    clienteId,
    eventoId: `missaoSemanal:${pedidoId}`,
    tipo: "missao_semanal",
    pontos: bonus,
    motivo: `Caçada ao Pódio — 2x no pedido ${pedidoId}`,
  });
  if (resultado === "creditado") {
    await redis.set(chaveBreadcrumbPedido(pedidoId), { tenantId, temporadaId, clienteId, bonus } satisfies BreadcrumbPedido);
    await registrarFatoRankingGamificacao("missao_semanal_consumida", `${clienteId}:${temporadaId}:${pedidoId}`);
  }
  return { consumida: true, bonusCreditado: bonus };
}

/**
 * Chamada pelo efeito "gamificacao" de um pedido cancelado/estornado. Só
 * reverte se ESTE pedido exato foi o que consumiu a missão (a migalha só
 * existe quando houve consumo real) — nunca mexe no estado de outro pedido.
 * Idempotente: chamar duas vezes (retry) é seguro.
 */
export async function reverterMissaoSemanalDoPedido(pedidoId: string, motivo: string): Promise<void> {
  if (!pedidoId) return;
  const breadcrumb = await redis.get<BreadcrumbPedido>(chaveBreadcrumbPedido(pedidoId));
  if (!breadcrumb) return;

  const registro = await obterRegistro(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId);
  const revertido = reverterConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId });
  if (revertido) {
    await salvarRegistro(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId, { ...registro, estado: revertido });
  }
  await estornarBonusCompeticao({
    tenantId: breadcrumb.tenantId,
    temporadaId: breadcrumb.temporadaId,
    clienteId: breadcrumb.clienteId,
    eventoIdOriginal: `missaoSemanal:${pedidoId}`,
    motivo,
  });
}
