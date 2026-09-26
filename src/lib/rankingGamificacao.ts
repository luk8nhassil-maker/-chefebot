// Motor de domínio da Gamificação V2 do Ranking do Chefe — só funções puras,
// sem I/O. Nada aqui decide "quando" algo acontece no mundo real (isso é do
// chamador, tipicamente rankingGamificacaoEstado.ts ou fidelidadeEfeitos.ts);
// este módulo só decide "o que deveria acontecer" dado um estado + contexto.
//
// Regra central do produto: scoreTemporada = estrelasBaseValidasDaTemporada +
// bonusCompeticaoDaTemporada. As "Estrelas base" (fidelidade legada) NUNCA
// são tocadas por nada neste arquivo — bônus de competição vive num ledger
// separado (rankingBonusTemporada.ts) e nunca desbloqueia recompensa real.

// ---------------------------------------------------------------------------
// Status social da temporada (Campeão / Prata / Bronze / Elite)
// ---------------------------------------------------------------------------

export type StatusTemporada = "campeao" | "prata" | "bronze" | "elite" | null;

/** Deriva o status a partir de uma posição 1..N. Fora do Top 10 → null (sem status, nunca inventa um "quase"). */
export function calcularStatusPorPosicao(posicao: number | null | undefined): StatusTemporada {
  if (posicao === null || posicao === undefined || !Number.isFinite(posicao) || posicao < 1) return null;
  const p = Math.round(posicao);
  if (p === 1) return "campeao";
  if (p === 2) return "prata";
  if (p === 3) return "bronze";
  if (p >= 4 && p <= 10) return "elite";
  return null;
}

export const NOME_STATUS_TEMPORADA: Record<Exclude<StatusTemporada, null>, string> = {
  campeao: "Campeão",
  prata: "Prata",
  bronze: "Bronze",
  elite: "Elite Top 10",
};

// ---------------------------------------------------------------------------
// Missão semanal "Caçada ao Pódio"
// ---------------------------------------------------------------------------

// "processando" é um estado INTERMEDIÁRIO da reserva atômica de consumo:
// entra aqui assim que um pedido reivindica a missão (antes de creditar
// qualquer bônus) e só sai para "consumida" depois do bônus estar
// garantido no ledger. Existe para que um retry (efeito reprocessado após
// falha no meio do caminho) sempre saiba retomar exatamente de onde parou,
// sem nunca perder nem duplicar o bônus (ver reservarConsumoMissaoSemanal /
// confirmarConsumoMissaoSemanal).
export type MissaoSemanalStatus = "inativa" | "desbloqueada" | "processando" | "consumida";

export type EstadoMissaoSemanal = {
  status: MissaoSemanalStatus;
  desbloqueadaEm: string | null;
  consumidaEm: string | null;
  consumidaPedidoId: string | null;
  /** Pedido que reservou a missão (status "processando") — null fora desse estado. */
  processandoPedidoId: string | null;
};

export const ESTADO_MISSAO_SEMANAL_INICIAL: EstadoMissaoSemanal = {
  status: "inativa",
  desbloqueadaEm: null,
  consumidaEm: null,
  consumidaPedidoId: null,
  processandoPedidoId: null,
};

/**
 * Reavalia se a missão semanal deve desbloquear. Regras:
 * - Só para quem participa da campanha (fail-closed: sem consentimento, sem missão).
 * - Só para quem está fora do pódio (posição null ou >= 4) — o Top 3 já está
 *   competindo pela liderança, a missão é o mecanismo de retorno para quem
 *   ficou para trás, nunca uma vantagem extra para quem já lidera.
 * - Precisa de pelo menos 1 pedido elegível registrado (nunca desbloqueia por
 *   "ausência" de quem nunca comprou).
 * - `cooldownDias` decorridos desde o último pedido elegível.
 * - Uma missão já "desbloqueada" nunca é retraída (mesmo que a posição melhore
 *   antes do consumo) — só transições de baixo para cima ("inativa"/"consumida" → "desbloqueada").
 */
export function avaliarDesbloqueioMissaoSemanal(params: {
  estadoAtual: EstadoMissaoSemanal;
  participaCampanha: boolean;
  posicaoAtual: number | null;
  ultimoPedidoElegivelEm: string | null;
  agora: Date;
  cooldownDias: number;
}): EstadoMissaoSemanal {
  const { estadoAtual, participaCampanha, posicaoAtual, ultimoPedidoElegivelEm, agora, cooldownDias } = params;
  if (!participaCampanha) return estadoAtual;
  // "processando" nunca é reavaliado aqui — está no meio de uma reserva
  // atômica de consumo, mexer nele por fora quebraria a máquina de estado.
  if (estadoAtual.status === "desbloqueada" || estadoAtual.status === "processando") return estadoAtual;
  if (!Number.isFinite(cooldownDias) || cooldownDias <= 0) return estadoAtual;
  const foraDoPodio = posicaoAtual === null || posicaoAtual >= 4;
  if (!foraDoPodio) return estadoAtual;
  if (!ultimoPedidoElegivelEm) return estadoAtual;
  const ultimoMs = new Date(ultimoPedidoElegivelEm).getTime();
  if (!Number.isFinite(ultimoMs)) return estadoAtual;
  const decorridoMs = agora.getTime() - ultimoMs;
  const cooldownMs = cooldownDias * 24 * 60 * 60 * 1000;
  if (decorridoMs < cooldownMs) return estadoAtual;
  return {
    status: "desbloqueada",
    desbloqueadaEm: agora.toISOString(),
    consumidaEm: estadoAtual.consumidaEm,
    consumidaPedidoId: estadoAtual.consumidaPedidoId,
    processandoPedidoId: null,
  };
}

/**
 * Passo 1 do consumo atômico: reserva a missão desbloqueada para ESTE
 * pedido (desbloqueada → processando). Só o chamador que detém o lock
 * exclusivo do cliente/temporada pode chamar isto — é o que impede dois
 * pedidos concorrentes de reivindicarem a mesma missão (blocker crítico da
 * auditoria do #446).
 *
 * Idempotente para retry do MESMO pedido: se já estiver "processando" com
 * este `pedidoId`, retorna o estado inalterado (nunca lança, nunca
 * regride) — o chamador então repete a etapa de crédito com segurança
 * (o ledger de bônus já é idempotente por eventoId).
 *
 * `null` = nada a reservar: ou a missão não está desbloqueada, ou já está
 * sendo processada por OUTRO pedido, ou já foi consumida.
 */
export function reservarConsumoMissaoSemanal(params: {
  estadoAtual: EstadoMissaoSemanal;
  pedidoId: string;
}): EstadoMissaoSemanal | null {
  const { estadoAtual, pedidoId } = params;
  if (!pedidoId) return null;
  if (estadoAtual.status === "processando") {
    return estadoAtual.processandoPedidoId === pedidoId ? estadoAtual : null;
  }
  if (estadoAtual.status !== "desbloqueada") return null;
  return {
    status: "processando",
    desbloqueadaEm: estadoAtual.desbloqueadaEm,
    consumidaEm: estadoAtual.consumidaEm,
    consumidaPedidoId: estadoAtual.consumidaPedidoId,
    processandoPedidoId: pedidoId,
  };
}

/**
 * Passo 2 do consumo atômico: confirma que o bônus já foi garantido no
 * ledger (processando → consumida). Só confirma se for o MESMO pedido que
 * reservou — protege contra confirmar a reserva de outro pedido.
 */
export function confirmarConsumoMissaoSemanal(params: {
  estadoAtual: EstadoMissaoSemanal;
  pedidoId: string;
  agora: Date;
}): EstadoMissaoSemanal | null {
  const { estadoAtual, pedidoId, agora } = params;
  if (estadoAtual.status !== "processando" || estadoAtual.processandoPedidoId !== pedidoId) return null;
  return {
    status: "consumida",
    desbloqueadaEm: estadoAtual.desbloqueadaEm,
    consumidaEm: agora.toISOString(),
    consumidaPedidoId: pedidoId,
    processandoPedidoId: null,
  };
}

/**
 * Reverte o consumo quando o PEDIDO EXATO que consumiu (ou está no meio de
 * consumir) a missão é cancelado ou estornado — a missão volta a ficar
 * disponível (o cliente não deveria "perder a chance" por causa de um
 * cancelamento). Cobre tanto "consumida" quanto "processando" (cancelamento
 * no meio do processamento). Nunca reverte se o pedido informado não foi o
 * que reservou/consumiu (protege contra reversão cruzada).
 */
export function reverterConsumoMissaoSemanal(params: {
  estadoAtual: EstadoMissaoSemanal;
  pedidoId: string;
}): EstadoMissaoSemanal | null {
  const { estadoAtual, pedidoId } = params;
  if (estadoAtual.status === "consumida" && estadoAtual.consumidaPedidoId === pedidoId) {
    return {
      status: "desbloqueada",
      desbloqueadaEm: estadoAtual.desbloqueadaEm,
      consumidaEm: null,
      consumidaPedidoId: null,
      processandoPedidoId: null,
    };
  }
  if (estadoAtual.status === "processando" && estadoAtual.processandoPedidoId === pedidoId) {
    return {
      status: "desbloqueada",
      desbloqueadaEm: estadoAtual.desbloqueadaEm,
      consumidaEm: null,
      consumidaPedidoId: null,
      processandoPedidoId: null,
    };
  }
  return null;
}

/** Bônus da missão semanal (2x = crédito adicional IGUAL ao já creditado na fidelidade base). */
export function calcularBonusMissaoSemanal(estrelasBaseDoPedido: number, multiplicador: number): number {
  if (!Number.isFinite(estrelasBaseDoPedido) || estrelasBaseDoPedido <= 0) return 0;
  if (!Number.isFinite(multiplicador) || multiplicador <= 1) return 0;
  return Math.round(estrelasBaseDoPedido * (multiplicador - 1));
}

/**
 * Data do último pedido REAL confirmado, a partir do extrato de fidelidade
 * (fonte canônica, nunca inventada) — usada para "batizar" a missão semanal
 * de um cliente que já comprava antes da feature existir, sem o que ele
 * ficaria bloqueado para sempre por nunca ter um "pedido elegível
 * registrado" depois da ativação (mata o próprio objetivo de reativação).
 */
/**
 * "Pedido próprio" = crédito de fidelidade que representa uma COMPRA do
 * próprio cliente — nunca um crédito de indicação (`indicacao:*`) nem de
 * apoio recorrente (`apoio:*`), que também são movimentos `tipo:
 * "confirmado"` no mesmo extrato mas não provam que o cliente comprou algo
 * ele mesmo. Correção de blocker: usar só `eventoId` estruturado (nunca o
 * texto de `motivo`, que pode mudar de redação sem aviso).
 */
function eventoIdRepresentaPedidoProprio(eventoId: string | null | undefined): boolean {
  // Sem eventoId, nunca há prova de que é indicação/apoio — não exclui
  // (fail-closed só contra as duas origens conhecidas que contaminam a
  // data, nunca contra um movimento sem essa metadata).
  if (!eventoId) return true;
  return !eventoId.startsWith("indicacao:") && !eventoId.startsWith("apoio:");
}

export function calcularUltimoPedidoConfirmadoDosMovimentos(
  movimentos: { tipo: string; createdAt: string; eventoId?: string }[],
): string | null {
  let maisRecente: string | null = null;
  for (const m of movimentos) {
    if (m.tipo !== "confirmado") continue;
    if (!eventoIdRepresentaPedidoProprio(m.eventoId)) continue;
    const ms = new Date(m.createdAt).getTime();
    if (!Number.isFinite(ms)) continue;
    if (!maisRecente || ms > new Date(maisRecente).getTime()) maisRecente = m.createdAt;
  }
  return maisRecente;
}

// ---------------------------------------------------------------------------
// Missão da temporada "Indique um amigo" (0/1 por temporada)
// ---------------------------------------------------------------------------

export type EstadoMissaoIndicacaoTemporada = {
  concluida: boolean;
  concluidaEm: string | null;
  pedidoId: string | null;
  /** Pedido que reservou a conclusão (evita duas indicações quase simultâneas concluírem/creditarem em duplicidade). */
  processandoPedidoId: string | null;
};

export const ESTADO_MISSAO_INDICACAO_INICIAL: EstadoMissaoIndicacaoTemporada = {
  concluida: false,
  concluidaEm: null,
  pedidoId: null,
  processandoPedidoId: null,
};

/**
 * Passo 1 do consumo atômico: reserva a conclusão da missão para ESTE
 * pedido. Idempotente para retry do mesmo pedido. `null` quando já
 * concluída, ou já reservada por outro pedido.
 */
export function reservarMissaoIndicacaoTemporada(params: {
  estadoAtual: EstadoMissaoIndicacaoTemporada;
  pedidoId: string;
}): EstadoMissaoIndicacaoTemporada | null {
  const { estadoAtual, pedidoId } = params;
  if (!pedidoId) return null;
  if (estadoAtual.concluida) return null;
  if (estadoAtual.processandoPedidoId) {
    return estadoAtual.processandoPedidoId === pedidoId ? estadoAtual : null;
  }
  return { ...estadoAtual, processandoPedidoId: pedidoId };
}

/** Passo 2: confirma a conclusão depois do bônus (se houver) estar garantido no ledger. */
export function confirmarMissaoIndicacaoTemporada(params: {
  estadoAtual: EstadoMissaoIndicacaoTemporada;
  pedidoId: string;
  agora: Date;
}): EstadoMissaoIndicacaoTemporada | null {
  const { estadoAtual, pedidoId, agora } = params;
  if (estadoAtual.concluida || estadoAtual.processandoPedidoId !== pedidoId) return null;
  return { concluida: true, concluidaEm: agora.toISOString(), pedidoId, processandoPedidoId: null };
}

/**
 * Reverte a missão quando o PEDIDO EXATO que a concluiu (ou reservou) é
 * corrigido para cancelado depois de já ter creditado a indicação —
 * cancelamento tardio nunca pode deixar uma vantagem indevida no jogo.
 */
export function reverterMissaoIndicacaoTemporada(params: {
  estadoAtual: EstadoMissaoIndicacaoTemporada;
  pedidoId: string;
}): EstadoMissaoIndicacaoTemporada | null {
  const { estadoAtual, pedidoId } = params;
  if (estadoAtual.concluida && estadoAtual.pedidoId === pedidoId) {
    return { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: null };
  }
  if (!estadoAtual.concluida && estadoAtual.processandoPedidoId === pedidoId) {
    return { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Impulso do Pódio — bônus limitado e com teto por temporada
// ---------------------------------------------------------------------------

/** Bônus disponível respeitando o teto já aplicado nesta temporada (nunca ultrapassa o cap configurado). */
export function calcularImpulsoPodioDisponivel(params: {
  bonusConfigurado: number;
  capMaximoTemporada: number;
  jaAplicadoNaTemporada: number;
}): number {
  const { bonusConfigurado, capMaximoTemporada, jaAplicadoNaTemporada } = params;
  if (!Number.isFinite(bonusConfigurado) || bonusConfigurado <= 0) return 0;
  if (!Number.isFinite(capMaximoTemporada) || capMaximoTemporada <= 0) return 0;
  const restante = capMaximoTemporada - Math.max(0, jaAplicadoNaTemporada);
  if (restante <= 0) return 0;
  return Math.min(Math.round(bonusConfigurado), Math.round(restante));
}

// ---------------------------------------------------------------------------
// Vantagem de largada (carryover comprimido do Top 10 anterior)
// ---------------------------------------------------------------------------

export type ConfigCarryoverPosicao = { posicao: number; bonus: number };

/** Sem config para a posição (ou config zerada/negativa) → 0, nunca inventa vantagem (fail-closed). */
export function calcularBonusCarryover(
  posicaoNaTemporadaAnterior: number | null,
  tabela: ConfigCarryoverPosicao[] | null | undefined,
): number {
  if (posicaoNaTemporadaAnterior === null || !Array.isArray(tabela)) return 0;
  const entrada = tabela.find((t) => t.posicao === posicaoNaTemporadaAnterior);
  if (!entrada || !Number.isFinite(entrada.bonus) || entrada.bonus <= 0) return 0;
  return Math.round(entrada.bonus);
}

// ---------------------------------------------------------------------------
// Nível de Chef — progressão permanente, separada do ranking da temporada
// ---------------------------------------------------------------------------

export type LimiarNivelChef = { nivel: number; nome: string; xpMinimo: number };

export type NivelChef = {
  nivel: number;
  nome: string | null;
  xpAtual: number;
  xpProximoNivel: number | null;
};

/** XP = pontos confirmados na vida do cliente, líquido de estornos — nunca de resgates (resgatar não apaga conquista). */
export function calcularXpChefDosMovimentos(movimentos: { tipo: string; pontos: number }[]): number {
  let xp = 0;
  for (const m of movimentos) {
    if (m.tipo === "confirmado" || m.tipo === "ajuste") xp += m.pontos;
    if (m.tipo === "estornado") xp -= m.pontos;
  }
  return Math.max(0, Math.round(xp));
}

/** Sem limiares configurados → nível 0/oculto (fail-closed: nunca inventa uma escala default). */
export function calcularNivelChef(xpTotal: number, limiares: LimiarNivelChef[] | null | undefined): NivelChef {
  const xp = Number.isFinite(xpTotal) && xpTotal > 0 ? Math.round(xpTotal) : 0;
  if (!Array.isArray(limiares) || limiares.length === 0) {
    return { nivel: 0, nome: null, xpAtual: xp, xpProximoNivel: null };
  }
  const ordenados = [...limiares].sort((a, b) => a.xpMinimo - b.xpMinimo);
  let atualIndex = -1;
  for (let i = 0; i < ordenados.length; i++) {
    if (xp >= ordenados[i].xpMinimo) atualIndex = i;
    else break;
  }
  if (atualIndex < 0) {
    return { nivel: 0, nome: null, xpAtual: xp, xpProximoNivel: ordenados[0].xpMinimo };
  }
  const atual = ordenados[atualIndex];
  const proximo = ordenados[atualIndex + 1] ?? null;
  return { nivel: atual.nivel, nome: atual.nome, xpAtual: xp, xpProximoNivel: proximo ? proximo.xpMinimo : null };
}

// ---------------------------------------------------------------------------
// "Defenda sua Coroa" — a vantagem real do líder sobre o #2 já é calculada
// em rankingRetencao.ts (AlvoRankingAtual). Esta função só decide se essa
// distância é pequena o bastante para a UI chamar de "ameaçada" — nunca sem
// uma condição matemática configurada (fail-closed: sem config, só a
// distância neutra aparece, nunca uma afirmação de ameaça inventada).
// ---------------------------------------------------------------------------

export function calcularCoroaAmeacada(vantagem: number | null, maxGapConfigurado: number): boolean {
  if (!Number.isFinite(maxGapConfigurado) || maxGapConfigurado <= 0) return false;
  if (vantagem === null || !Number.isFinite(vantagem)) return false;
  return vantagem <= maxGapConfigurado;
}
