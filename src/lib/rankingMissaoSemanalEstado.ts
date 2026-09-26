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
import { creditarBonusCompeticao, estornarBonusCompeticao, obterMovimentosBonusTemporada } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";
import { comBloqueioGamificacao, comBloqueioGamificacaoComToken } from "./rankingGamificacaoLock";

type RegistroMissaoSemanal = {
  estado: EstadoMissaoSemanal;
  ultimoPedidoElegivelEm: string | null;
  // BLOCKER 6: metadado técnico (nunca uma regra de negócio) usado só para
  // decidir se uma reserva "processando" é candidata a reconciliação — sem
  // ele, nenhuma reserva é considerada órfã. Ausente em registros gravados
  // antes desta correção, e sempre limpo (`null`) fora do estado
  // "processando".
  processandoDesdeEm?: string | null;
};

// BLOCKER 6: limiar técnico (nunca de negócio) para considerar uma reserva
// "processando" candidata a reconciliação — bem acima de qualquer duração
// real de crédito no ledger, para nunca competir com uma reserva
// genuinamente em andamento.
const LIMIAR_MISSAO_SEMANAL_ORFA_MS = 5 * 60 * 1000;

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

type BreadcrumbPedido = {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  bonus: number;
  /**
   * BLOCKER: quanto este pedido credita se o crédito real acontecer,
   * calculado com a base de estrelas REAL do pedido e o multiplicador
   * vigente NO MOMENTO da reserva — gravado ANTES de qualquer chamada ao
   * ledger. É o que permite a reconciliação de uma reserva órfã "entregue,
   * mas o processo morreu antes do crédito" creditar exatamente o valor
   * correto sem recalcular com uma config que pode ter mudado depois.
   * Ausente em breadcrumbs gravadas antes desta correção (a reconciliação
   * nesse caso fica fail-closed — nunca inventa o valor).
   */
  bonusPlanejado?: number;
};

async function obterRegistro(tenantId: string, temporadaId: string, clienteId: string): Promise<RegistroMissaoSemanal> {
  const salvo = await redis.get<RegistroMissaoSemanal>(chaveRegistro(tenantId, temporadaId, clienteId));
  return salvo ?? REGISTRO_INICIAL;
}

async function salvarRegistro(tenantId: string, temporadaId: string, clienteId: string, registro: RegistroMissaoSemanal): Promise<void> {
  await redis.set(chaveRegistro(tenantId, temporadaId, clienteId), registro);
}

// BLOCKER: escreve o registro só se a chave de LOCK ainda contiver
// exatamente este `token` — verificação e escrita na MESMA operação Lua,
// sem nenhuma janela entre "checar dono" e "gravar". Usado pelas
// transições que reservam/confirmam/revertem/reconciliam a missão — nunca
// pela reavaliação lazy de desbloqueio (sincronizarMissaoSemanalCliente),
// que não credita nada e cuja pior consequência de perder a escrita é só
// recalcular no próximo acesso. Sem isto, um `fn()` que por qualquer
// motivo levasse mais que o TTL do lock (10s) podia ter o lock "roubado"
// por outro worker (cancelamento, reconciliação) e MESMO ASSIM escrever o
// registro por cima do estado mais novo (mesmo padrão já usado em
// rankingIndicacaoConversao.ts/rankingBonusTemporada.ts).
const ESCREVER_REGISTRO_SE_DONO_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("SET", KEYS[2], ARGV[2])
  return 1
else
  return 0
end
`;

async function escreverRegistroSeDono(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
  token: string,
  registro: RegistroMissaoSemanal,
): Promise<boolean> {
  const resultado = await redis.eval(
    ESCREVER_REGISTRO_SE_DONO_SCRIPT,
    [chaveLock(tenantId, temporadaId, clienteId), chaveRegistro(tenantId, temporadaId, clienteId)],
    [token, JSON.stringify(registro)],
  );
  return resultado === 1;
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
  /**
   * Data do último pedido REAL confirmado (fonte canônica: extrato de
   * fidelidade), usada só para "batizar" a missão na PRIMEIRA avaliação de
   * um cliente que nunca teve `ultimoPedidoElegivelEm` registrado — nunca
   * sobrescreve um valor já existente. Sem isso, quem já era cliente antes
   * da feature existir ficaria bloqueado para sempre (nunca teria um
   * "pedido elegível registrado" depois da ativação).
   */
  ultimoPedidoConfirmadoConhecido?: string | null;
}): Promise<EstadoMissaoSemanal> {
  const { tenantId, temporadaId, clienteId, participaCampanha, posicaoAtual, agora, ultimoPedidoConfirmadoConhecido } = params;
  const config = await obterConfigGamificacao();
  if (!config.missaoSemanalAtiva) return ESTADO_MISSAO_SEMANAL_INICIAL;

  return comBloqueioGamificacao(chaveLock(tenantId, temporadaId, clienteId), async () => {
    const registro = await obterRegistro(tenantId, temporadaId, clienteId);
    const baseline = registro.ultimoPedidoElegivelEm === null && ultimoPedidoConfirmadoConhecido
      ? ultimoPedidoConfirmadoConhecido
      : registro.ultimoPedidoElegivelEm;

    const novoEstado = avaliarDesbloqueioMissaoSemanal({
      estadoAtual: registro.estado,
      participaCampanha,
      posicaoAtual,
      ultimoPedidoElegivelEm: baseline,
      agora,
      cooldownDias: config.missaoSemanalCooldownDias,
    });
    if (novoEstado !== registro.estado || baseline !== registro.ultimoPedidoElegivelEm) {
      await salvarRegistro(tenantId, temporadaId, clienteId, { estado: novoEstado, ultimoPedidoElegivelEm: baseline });
      if (novoEstado.status === "desbloqueada" && novoEstado !== registro.estado) {
        await registrarFatoRankingGamificacao("missao_semanal_desbloqueada", `${clienteId}:${temporadaId}:${novoEstado.desbloqueadaEm}`);
      }
    }
    return novoEstado;
  });
}

export type ResultadoConsumoMissaoSemanal = { consumida: boolean; bonusCreditado: number };

/**
 * BLOCKER 6: reconcilia uma reserva "processando" de OUTRO pedido, candidata
 * técnica a órfã (processo morreu de verdade, sem catch/finally algum).
 * Chamada de DENTRO do lock exclusivo do cliente já adquirido por
 * `consumirMissaoSemanalNoPedido` — por isso NUNCA usa `reverterMissaoSemanalDoPedido`
 * nem `comBloqueioGamificacao` de novo (o mesmo lock não é reentrante),
 * repetindo aqui só a lógica pura de estado + as chamadas ao ledger.
 * NUNCA decide sozinha nem inventa um crédito: só conclui o que o ledger já
 * comprova (crédito real já existe → confirma) ou o que o pedido real já
 * decidiu (cancelado → estorna e libera). Quando nada disso é decidível com
 * segurança, devolve `null` e NUNCA mexe em nada.
 */
async function reconciliarMissaoSemanalOrfa(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  registro: RegistroMissaoSemanal;
  token: string;
}): Promise<RegistroMissaoSemanal | null> {
  const { tenantId, temporadaId, clienteId, registro, token } = params;
  const pedidoOrfaoId = registro.estado.processandoPedidoId;
  if (!pedidoOrfaoId) return null;
  const desdeMs = registro.processandoDesdeEm ? new Date(registro.processandoDesdeEm).getTime() : NaN;
  if (!Number.isFinite(desdeMs) || Date.now() - desdeMs <= LIMIAR_MISSAO_SEMANAL_ORFA_MS) return null;

  const pedidos = (await redis.get<{ id: string; status: string }[]>("pedidos")) ?? [];
  const pedidoOrfao = pedidos.find((item) => item.id === pedidoOrfaoId);

  if (pedidoOrfao?.status === "cancelado") {
    const revertido = reverterConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId: pedidoOrfaoId });
    const resultadoEstorno = await estornarBonusCompeticao({
      tenantId,
      temporadaId,
      clienteId,
      eventoIdOriginal: `missaoSemanal:${pedidoOrfaoId}`,
      motivo: "Reserva órfã reconciliada — pedido cancelado",
    });
    if (resultadoEstorno === "estornado") {
      await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
    }
    const novoRegistro: RegistroMissaoSemanal = { ...registro, estado: revertido ?? registro.estado, processandoDesdeEm: null };
    // BLOCKER: o TTL do lock expirou entre o GET e este SET — nunca reporta
    // a reconciliação como concluída sem ter escrito de verdade (o estorno
    // já é idempotente por eventoId, então um retry nunca duplica).
    if (!(await escreverRegistroSeDono(tenantId, temporadaId, clienteId, token, novoRegistro))) {
      throw new Error("ranking_missao_semanal_lock_perdido_durante_reconciliacao");
    }
    return novoRegistro;
  }

  // Se o ledger já tem o crédito real deste pedido (crash entre creditar e
  // confirmar), só falta completar — nunca recreditar.
  const movimentos = await obterMovimentosBonusTemporada(tenantId, temporadaId, clienteId);
  const eventoId = `missaoSemanal:${pedidoOrfaoId}`;
  const jaCreditado = movimentos.some((m) => m.eventoId === eventoId);
  if (jaCreditado) {
    await redis.set(chaveBreadcrumbPedido(pedidoOrfaoId), { tenantId, temporadaId, clienteId, bonus: 0 } satisfies BreadcrumbPedido);
    await registrarFatoRankingGamificacao("missao_semanal_consumida", `${clienteId}:${temporadaId}:${pedidoOrfaoId}`);
    await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
    const confirmado = confirmarConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId: pedidoOrfaoId, agora: new Date() });
    const novoRegistro: RegistroMissaoSemanal = { ...registro, estado: confirmado ?? registro.estado, processandoDesdeEm: null };
    if (!(await escreverRegistroSeDono(tenantId, temporadaId, clienteId, token, novoRegistro))) {
      throw new Error("ranking_missao_semanal_lock_perdido_durante_reconciliacao");
    }
    return novoRegistro;
  }

  // BLOCKER: pedido dono ainda "entregue", processo morreu ANTES do
  // crédito real. Só decide com segurança se a breadcrumb (gravada ANTES
  // do ledger, ver consumirMissaoSemanalNoPedido) já prova exatamente
  // quanto creditar — nunca recalcula agora com a base de estrelas ou o
  // multiplicador atuais, que podem ter mudado desde a reserva.
  if (pedidoOrfao?.status === "entregue") {
    const breadcrumb = await redis.get<BreadcrumbPedido>(chaveBreadcrumbPedido(pedidoOrfaoId));
    if (!breadcrumb || !Number.isFinite(breadcrumb.bonusPlanejado)) {
      // Breadcrumb ausente (nunca chegou a ser gravada) ou de um registro
      // legado sem o campo — nunca inventa o valor. Fail-closed.
      return null;
    }
    const bonusPlanejado = breadcrumb.bonusPlanejado as number;
    let bonusCreditado = 0;
    if (bonusPlanejado > 0) {
      const resultado = await creditarBonusCompeticao({
        tenantId,
        temporadaId,
        clienteId,
        eventoId,
        tipo: "missao_semanal",
        pontos: bonusPlanejado,
        motivo: `Caçada ao Pódio — 2x no pedido ${pedidoOrfaoId}`,
      });
      // "invalido" nunca deveria acontecer aqui (os parâmetros vêm do
      // próprio sistema, nunca de entrada externa) — mas se acontecer,
      // fail-closed: nunca confirma a missão sem o crédito real.
      if (resultado !== "creditado" && resultado !== "ja_creditado") return null;
      bonusCreditado = bonusPlanejado;
      await redis.set(chaveBreadcrumbPedido(pedidoOrfaoId), { tenantId, temporadaId, clienteId, bonus: bonusCreditado, bonusPlanejado } satisfies BreadcrumbPedido);
      await registrarFatoRankingGamificacao("missao_semanal_consumida", `${clienteId}:${temporadaId}:${pedidoOrfaoId}`);
      await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
    }
    const confirmado = confirmarConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId: pedidoOrfaoId, agora: new Date() });
    const novoRegistro: RegistroMissaoSemanal = { ...registro, estado: confirmado ?? registro.estado, processandoDesdeEm: null };
    if (!(await escreverRegistroSeDono(tenantId, temporadaId, clienteId, token, novoRegistro))) {
      throw new Error("ranking_missao_semanal_lock_perdido_durante_reconciliacao");
    }
    return novoRegistro;
  }

  // Pedido não encontrado ou status indeterminado (nem entregue, nem
  // cancelado) — nunca decide/credita por conta própria. Nunca rouba;
  // devolve "não decidível".
  return null;
}

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

  return comBloqueioGamificacaoComToken(chaveLock(tenantId, temporadaId, clienteId), async (token) => {
    let registro = await obterRegistro(tenantId, temporadaId, clienteId);
    const atualizado: RegistroMissaoSemanal = { ...registro, ultimoPedidoElegivelEm: agora.toISOString() };

    // BLOCKER 6: outro pedido tem a reserva "processando" — antes de tratar
    // isso silenciosamente como "nada a consumir", verifica se é candidata
    // técnica a órfã e tenta reconciliar o DONO usando só o que o ledger e o
    // pedido real já provam. Nunca "rouba" a reserva para ESTE pedido.
    if (registro.estado.status === "processando" && registro.estado.processandoPedidoId !== pedidoId) {
      const reconciliado = await reconciliarMissaoSemanalOrfa({ tenantId, temporadaId, clienteId, registro, token });
      if (!reconciliado) {
        // Ainda não é candidata a órfã, ou não foi possível decidir com
        // segurança — NUNCA abandona silenciosamente como "concluído sem
        // consumir": vira pendência/retryable, igual ao resto do pipeline.
        throw new Error("ranking_missao_semanal_em_processamento");
      }
      registro = reconciliado;
    }

    const reservado = reservarConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId });
    if (!reservado) {
      // BLOCKER: escrita CAS mesmo para o "nada a reservar" (só atualiza
      // ultimoPedidoElegivelEm) — nunca reporta sucesso sem ter escrito de
      // verdade, mesmo aqui.
      if (!(await escreverRegistroSeDono(tenantId, temporadaId, clienteId, token, { ...atualizado, estado: registro.estado, processandoDesdeEm: registro.processandoDesdeEm }))) {
        throw new Error("ranking_missao_semanal_lock_perdido_durante_atualizacao");
      }
      return { consumida: false, bonusCreditado: 0 };
    }
    const eraProcessandoDoMesmoPedido = registro.estado.status === "processando" && registro.estado.processandoPedidoId === pedidoId;
    // BLOCKER: escrita CAS da reserva — o TTL do lock expirar aqui nunca
    // deve permitir sobrescrever um estado mais novo (ex.: um cancelamento
    // ou reconciliação concorrente que já assumiu o lock).
    if (!(await escreverRegistroSeDono(tenantId, temporadaId, clienteId, token, {
      ...atualizado,
      estado: reservado,
      processandoDesdeEm: eraProcessandoDoMesmoPedido ? (registro.processandoDesdeEm ?? agora.toISOString()) : agora.toISOString(),
    }))) {
      throw new Error("ranking_missao_semanal_lock_perdido_durante_reserva");
    }
    // O cálculo é puro (sem I/O) — feito ANTES da migalha para que ela já
    // grave o `bonusPlanejado` com a base de estrelas REAL e o
    // multiplicador VIGENTE agora, nunca um recalculado depois com uma
    // config que pode ter mudado.
    const bonus = calcularBonusMissaoSemanal(estrelasBaseDoPedido, config.missaoSemanalMultiplicador);

    // BLOCKER 6/BLOCKER: migalha ANTES de qualquer efeito financeiro — é o
    // índice durável que localiza o dono (tenant/temporada/cliente) desta
    // reserva mesmo que o processo morra exatamente entre reservar e
    // creditar (antes, só era gravada DEPOIS do crédito, e tanto um
    // cancelamento quanto uma reconciliação nesse buraco não encontravam
    // nada para resolver). `bonusPlanejado` é o que permite a reconciliação
    // de uma reserva órfã "entregue, mas o processo morreu antes do
    // crédito" creditar exatamente o valor certo, sem recalcular depois.
    await redis.set(chaveBreadcrumbPedido(pedidoId), { tenantId, temporadaId, clienteId, bonus: 0, bonusPlanejado: bonus } satisfies BreadcrumbPedido);

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
      // crédito agora", então os dois precisam convergir para o MESMO estado
      // final íntegro (breadcrumb + fato + score sincronizado), nunca só o
      // primeiro. Correção de blocker: antes, um crash exatamente entre o
      // ledger gravar "creditado" e este bloco terminar deixava um retry
      // receber "ja_creditado" e pular breadcrumb/fato/score — a missão
      // confirmava sem nunca ter a migalha que o cancelamento precisa, e o
      // score podia ficar desatualizado. Cada uma das três operações abaixo
      // já é idempotente por si (SET simples, SET NX por eventoId, e
      // recomputo total), então repeti-las em todo retry é sempre seguro.
      // "invalido" (params ruins) nunca cai aqui — não existe crédito real.
      if (resultado === "creditado" || resultado === "ja_creditado") {
        bonusCreditado = bonus;
        await redis.set(chaveBreadcrumbPedido(pedidoId), { tenantId, temporadaId, clienteId, bonus, bonusPlanejado: bonus } satisfies BreadcrumbPedido);
        await registrarFatoRankingGamificacao("missao_semanal_consumida", `${clienteId}:${temporadaId}:${pedidoId}`);
        await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
      }
    }

    const confirmado = confirmarConsumoMissaoSemanal({ estadoAtual: reservado, pedidoId, agora });
    if (confirmado) {
      const registroAtual = await obterRegistro(tenantId, temporadaId, clienteId);
      // BLOCKER: confirmação também é escrita CAS — nunca reporta a missão
      // como consumida sem ter escrito de verdade (o crédito no ledger, se
      // houve, já é idempotente por eventoId; um retry reprocessa com
      // segurança e converge para o mesmo estado final).
      if (!(await escreverRegistroSeDono(tenantId, temporadaId, clienteId, token, { ...registroAtual, estado: confirmado, processandoDesdeEm: null }))) {
        throw new Error("ranking_missao_semanal_lock_perdido_durante_confirmacao");
      }
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

  await comBloqueioGamificacaoComToken(chaveLock(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId), async (token) => {
    const registro = await obterRegistro(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId);
    const revertido = reverterConsumoMissaoSemanal({ estadoAtual: registro.estado, pedidoId });
    if (revertido) {
      // BLOCKER: escrita CAS da reversão — nunca reporta "revertido" sem
      // ter escrito de verdade (o estorno logo abaixo já é idempotente por
      // eventoId, então um retry deste cancelamento nunca duplica).
      if (!(await escreverRegistroSeDono(breadcrumb.tenantId, breadcrumb.temporadaId, breadcrumb.clienteId, token, { ...registro, estado: revertido, processandoDesdeEm: null }))) {
        throw new Error("ranking_missao_semanal_lock_perdido_durante_reversao");
      }
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
