// Ledger do "Bônus de competição da temporada" — a segunda metade de
// scoreTemporada = estrelasBaseValidasDaTemporada + bonusCompeticaoDaTemporada.
//
// Regras inegociáveis:
// - NUNCA toca no saldo de fidelidade (Estrelas base) nem em `fidelidade.ts`.
// - NUNCA desbloqueia recompensa real — só soma pontos de disputa dentro da
//   temporada corrente, apagados quando a temporada é reiniciada.
// - Cada crédito é idempotente por `eventoId` (nunca duplica o mesmo fato).
// - Todo crédito é estornável apontando para o `eventoId` original — o
//   estorno é um movimento novo (nunca reescreve/apaga o original), então o
//   ledger inteiro fica auditável do início ao fim.
import "server-only";
import { redis } from "./redis";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";

export type TipoBonusCompeticao =
  | "missao_semanal"
  | "missao_indicacao"
  | "impulso_podio"
  | "carryover"
  | "ajuste";

export type MovimentoBonusTemporada = {
  movimentoId: string;
  eventoId: string;
  tipo: TipoBonusCompeticao;
  /** Sempre positivo num crédito; negativo quando é o estorno de outro movimento. */
  pontos: number;
  motivo: string;
  createdAt: string;
  /** Presente só nos movimentos de estorno — aponta para o eventoId creditado originalmente. */
  estornadoDeEventoId?: string;
};

type EstadoBonusTemporada = { movimentos: MovimentoBonusTemporada[] };

function chaveBonus(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:bonus:temporada:${tenantId}:${temporadaId}:${clienteId}`;
}

function chaveLock(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:bonus:temporada:lock:${tenantId}:${temporadaId}:${clienteId}`;
}

const LOCK_TTL_SEGUNDOS = 10;
const LOCK_MAX_TENTATIVAS = 5;
const LOCK_ESPERA_MS = 80;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenLock(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

const LIBERAR_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

async function liberarLock(chave: string, token: string): Promise<void> {
  const clienteComEval = redis as typeof redis & {
    eval?: (script: string, keys: string[], args: string[]) => Promise<unknown>;
  };
  if (clienteComEval.eval) {
    await clienteComEval.eval(LIBERAR_LOCK_LUA, [chave], [token]);
  } else if ((await redis.get<string>(chave)) === token) {
    await redis.del(chave);
  }
}

async function comBloqueioBonus<T>(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const chave = chaveLock(tenantId, temporadaId, clienteId);
  for (let tentativa = 0; tentativa < LOCK_MAX_TENTATIVAS; tentativa++) {
    const token = tokenLock();
    const adquirido = await redis.set(chave, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
    if (adquirido) {
      try {
        return await fn();
      } finally {
        await liberarLock(chave, token);
      }
    }
    await esperar(LOCK_ESPERA_MS);
  }
  throw new Error(`ranking_bonus_temporada_lock_indisponivel:${tenantId}:${temporadaId}:${clienteId}`);
}

export async function obterMovimentosBonusTemporada(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<MovimentoBonusTemporada[]> {
  if (!tenantId || !temporadaId || !clienteId) return [];
  const estado = await redis.get<EstadoBonusTemporada>(chaveBonus(tenantId, temporadaId, clienteId));
  return estado?.movimentos ?? [];
}

/** Soma líquida (créditos − estornos). Nunca negativa — um estorno nunca deixa o bônus "devendo". */
export function calcularTotalBonusTemporada(movimentos: MovimentoBonusTemporada[]): number {
  const total = movimentos.reduce((soma, m) => soma + m.pontos, 0);
  return Math.max(0, Math.round(total));
}

export function calcularTotalBonusPorTipo(movimentos: MovimentoBonusTemporada[], tipo: TipoBonusCompeticao): number {
  const total = movimentos.filter((m) => m.tipo === tipo).reduce((soma, m) => soma + m.pontos, 0);
  return Math.max(0, Math.round(total));
}

export async function obterBonusCompeticaoDaTemporada(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<number> {
  return calcularTotalBonusTemporada(await obterMovimentosBonusTemporada(tenantId, temporadaId, clienteId));
}

export type ResultadoCreditoBonus = "creditado" | "ja_creditado" | "invalido";

/**
 * Credita pontos de bônus, idempotente por `eventoId`.
 *
 * Três resultados com significados DIFERENTES para o chamador (correção de
 * blocker da auditoria — antes, parâmetro inválido e retry do mesmo evento
 * eram indistinguíveis, ambos "ja_creditado"):
 * - "creditado": primeira vez, o movimento foi gravado agora.
 * - "ja_creditado": o MESMO eventoId já tinha um crédito no ledger — o fato
 *   já existe de verdade, então o chamador pode confiar nele (breadcrumb,
 *   sincronizar score, confirmar estado) como se tivesse acabado de creditar.
 * - "invalido": parâmetros ruins (tenant/temporada/cliente/eventoId ausente,
 *   pontos não-positivo) — NUNCA existe um crédito real para este eventoId,
 *   o chamador não pode tratar como se o fato tivesse acontecido.
 */
export async function creditarBonusCompeticao(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  eventoId: string;
  tipo: TipoBonusCompeticao;
  pontos: number;
  motivo: string;
}): Promise<ResultadoCreditoBonus> {
  const { tenantId, temporadaId, clienteId, eventoId, tipo, motivo } = params;
  if (!tenantId || !temporadaId || !clienteId || !eventoId) return "invalido";
  if (!Number.isFinite(params.pontos) || params.pontos <= 0) return "invalido";
  return comBloqueioBonus(tenantId, temporadaId, clienteId, async () => {
    const movimentos = await obterMovimentosBonusTemporada(tenantId, temporadaId, clienteId);
    if (movimentos.some((m) => m.eventoId === eventoId)) return "ja_creditado";
    const novo: MovimentoBonusTemporada = {
      movimentoId: `bonus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventoId,
      tipo,
      pontos: Math.round(params.pontos),
      motivo,
      createdAt: new Date().toISOString(),
    };
    await redis.set(chaveBonus(tenantId, temporadaId, clienteId), { movimentos: [...movimentos, novo] });
    // Fato de negócio único para qualquer tipo de bônus — o próprio eventoId
    // do crédito já é a chave de idempotência, então nunca duplica mesmo em
    // retry (Telemetria V2: fato server-side, nunca inferido pelo cliente).
    await registrarFatoRankingGamificacao("bonus_competicao_aplicado", eventoId);
    return "creditado";
  });
}

export type ResultadoEstornoBonus = "estornado" | "ja_estornado" | "credito_nao_encontrado";

/**
 * Estorna um crédito específico pelo seu `eventoId` original. Idempotente:
 * um segundo estorno do mesmo evento é no-op. Nunca estorna algo que nunca
 * foi creditado (protege contra estorno "fantasma").
 */
export async function estornarBonusCompeticao(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  eventoIdOriginal: string;
  motivo: string;
}): Promise<ResultadoEstornoBonus> {
  const { tenantId, temporadaId, clienteId, eventoIdOriginal, motivo } = params;
  if (!tenantId || !temporadaId || !clienteId || !eventoIdOriginal) return "credito_nao_encontrado";
  const eventoIdEstorno = `estorno:${eventoIdOriginal}`;
  return comBloqueioBonus(tenantId, temporadaId, clienteId, async () => {
    const movimentos = await obterMovimentosBonusTemporada(tenantId, temporadaId, clienteId);
    if (movimentos.some((m) => m.eventoId === eventoIdEstorno)) return "ja_estornado";
    const original = movimentos.find((m) => m.eventoId === eventoIdOriginal);
    if (!original) return "credito_nao_encontrado";
    const estorno: MovimentoBonusTemporada = {
      movimentoId: `bonus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventoId: eventoIdEstorno,
      tipo: original.tipo,
      pontos: -original.pontos,
      motivo,
      createdAt: new Date().toISOString(),
      estornadoDeEventoId: eventoIdOriginal,
    };
    await redis.set(chaveBonus(tenantId, temporadaId, clienteId), { movimentos: [...movimentos, estorno] });
    return "estornado";
  });
}
