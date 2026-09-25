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

export type MissaoSemanalStatus = "inativa" | "desbloqueada" | "consumida";

export type EstadoMissaoSemanal = {
  status: MissaoSemanalStatus;
  desbloqueadaEm: string | null;
  consumidaEm: string | null;
  consumidaPedidoId: string | null;
};

export const ESTADO_MISSAO_SEMANAL_INICIAL: EstadoMissaoSemanal = {
  status: "inativa",
  desbloqueadaEm: null,
  consumidaEm: null,
  consumidaPedidoId: null,
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
  if (estadoAtual.status === "desbloqueada") return estadoAtual;
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
  };
}

/** Consome a missão desbloqueada no pedido informado. `null` = nada a consumir (idempotência do chamador). */
export function consumirMissaoSemanal(params: {
  estadoAtual: EstadoMissaoSemanal;
  pedidoId: string;
  agora: Date;
}): EstadoMissaoSemanal | null {
  if (params.estadoAtual.status !== "desbloqueada") return null;
  if (!params.pedidoId) return null;
  return {
    status: "consumida",
    desbloqueadaEm: params.estadoAtual.desbloqueadaEm,
    consumidaEm: params.agora.toISOString(),
    consumidaPedidoId: params.pedidoId,
  };
}

/**
 * Reverte o consumo quando o PEDIDO EXATO que consumiu a missão é cancelado
 * ou estornado — a missão volta a ficar disponível (o cliente não deveria
 * "perder a chance" por causa de um cancelamento). Nunca reverte se o pedido
 * informado não foi o que consumiu (protege contra reversão cruzada).
 */
export function reverterConsumoMissaoSemanal(params: {
  estadoAtual: EstadoMissaoSemanal;
  pedidoId: string;
}): EstadoMissaoSemanal | null {
  if (params.estadoAtual.status !== "consumida") return null;
  if (params.estadoAtual.consumidaPedidoId !== params.pedidoId) return null;
  return {
    status: "desbloqueada",
    desbloqueadaEm: params.estadoAtual.desbloqueadaEm,
    consumidaEm: null,
    consumidaPedidoId: null,
  };
}

/** Bônus da missão semanal (2x = crédito adicional IGUAL ao já creditado na fidelidade base). */
export function calcularBonusMissaoSemanal(estrelasBaseDoPedido: number, multiplicador: number): number {
  if (!Number.isFinite(estrelasBaseDoPedido) || estrelasBaseDoPedido <= 0) return 0;
  if (!Number.isFinite(multiplicador) || multiplicador <= 1) return 0;
  return Math.round(estrelasBaseDoPedido * (multiplicador - 1));
}

// ---------------------------------------------------------------------------
// Missão da temporada "Indique um amigo" (0/1 por temporada)
// ---------------------------------------------------------------------------

export type EstadoMissaoIndicacaoTemporada = {
  concluida: boolean;
  concluidaEm: string | null;
  pedidoId: string | null;
};

export const ESTADO_MISSAO_INDICACAO_INICIAL: EstadoMissaoIndicacaoTemporada = {
  concluida: false,
  concluidaEm: null,
  pedidoId: null,
};

/** Conclui a missão de indicação da temporada. `null` = já estava concluída (nunca duplica o bônus). */
export function concluirMissaoIndicacaoTemporada(params: {
  estadoAtual: EstadoMissaoIndicacaoTemporada;
  pedidoId: string;
  agora: Date;
}): EstadoMissaoIndicacaoTemporada | null {
  if (params.estadoAtual.concluida) return null;
  if (!params.pedidoId) return null;
  return { concluida: true, concluidaEm: params.agora.toISOString(), pedidoId: params.pedidoId };
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
