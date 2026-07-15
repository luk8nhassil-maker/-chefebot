import { randomUUID, timingSafeEqual } from "crypto";
import { redis } from "@/lib/redis";
import type { PixMetadata } from "@/lib/pix";

// Edição de pedido pelo cliente antes da aceitação da loja (ver AGENTS.md).
// Regra central de concorrência: quem obtiver primeiro a operação válida no
// servidor mantém o controle — o cliente que adquire o lock de edição bloqueia
// a aceitação da Kellyne; a aceitação concluída primeiro bloqueia a edição.
//
// O mutex abaixo reaproveita o MESMO padrão já usado em
// src/lib/fidelidade.ts (comBloqueioCliente): SET NX + TTL curto, comparação
// pelo próprio token antes de liberar (nunca um DEL cego). Ele protege só a
// seção crítica de leitura-modificação-escrita do array "pedidos" — não é o
// mesmo lock de 5 minutos da sessão de edição (esse fica armazenado no
// próprio pedido, ver EditStatus abaixo).

export const EDICAO_DURACAO_MS = 5 * 60 * 1000; // 5 minutos
const MUTEX_TTL_SEGUNDOS = 8;
const MUTEX_RETRY_MAX = 20;
const MUTEX_RETRY_DELAY_MS = 50;

export type EditStatus = "none" | "editing" | "edited";

export type EditHistoryEntry = {
  tipo: "iniciado" | "salvo" | "descartado" | "expirado";
  horario: string;
  revisaoAnterior?: number;
  revisaoNova?: number;
  resumo?: string[];
};

export type PixSubstituido = {
  providerPaymentId?: string;
  txid?: string;
  valorEsperado?: number;
  substituidoEm: string;
};

/** Campos de edição adicionados ao Pedido — todos opcionais/retrocompatíveis. */
export type PedidoComEdicao = {
  id: string;
  status: string;
  isArchived?: boolean;
  revision?: number;
  editStatus?: EditStatus;
  editSessionId?: string;
  editStartedAt?: string;
  editExpiresAt?: string;
  editedAt?: string;
  editedBy?: "cliente";
  changesSummary?: string[];
  editHistory?: EditHistoryEntry[];
  lastEditSessionId?: string;
  pixSubstituido?: PixSubstituido[];
  pixConfirmado?: boolean;
  pix?: PixMetadata;
};

function mutexKey(pedidoId: string): string {
  return `pedido:edit:mutex:${pedidoId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adquire o mutex curto de edição do pedido — retorna o token dono ou null se não conseguiu. */
export async function adquirirMutexEdicao(pedidoId: string): Promise<string | null> {
  const token = randomUUID();
  for (let tentativa = 0; tentativa < MUTEX_RETRY_MAX; tentativa++) {
    const ok = await redis.set(mutexKey(pedidoId), token, { nx: true, ex: MUTEX_TTL_SEGUNDOS });
    if (ok) return token;
    await sleep(MUTEX_RETRY_DELAY_MS);
  }
  return null;
}

/** Libera o mutex só se o token ainda for o dono atual (compare-and-delete seguro). */
export async function liberarMutexEdicao(pedidoId: string, token: string): Promise<void> {
  try {
    const atual = await redis.get<string>(mutexKey(pedidoId));
    if (atual === token) await redis.del(mutexKey(pedidoId));
  } catch {
    // Liberação é best-effort — o TTL curto garante que o mutex não fica preso.
  }
}

/** Executa `fn` sob o mutex do pedido; lança se não conseguir adquirir (fila cheia). */
export async function comMutexEdicao<T>(pedidoId: string, fn: () => Promise<T>): Promise<T> {
  const token = await adquirirMutexEdicao(pedidoId);
  if (!token) {
    throw new Error("mutex_indisponivel");
  }
  try {
    return await fn();
  } finally {
    await liberarMutexEdicao(pedidoId, token);
  }
}

/** Pedido ainda aguardando confirmação da loja (única janela em que a edição é permitida). */
export function pedidoAguardandoAceite(pedido: PedidoComEdicao): boolean {
  return pedido.status === "novo" && !pedido.isArchived;
}

export function pagamentoJaConfirmado(pedido: PedidoComEdicao): boolean {
  return pedido.pixConfirmado === true || pedido.pix?.status === "confirmado";
}

/** Lock de edição ativo (dentro da janela dos 5 minutos), fonte da verdade = horário do servidor. */
export function lockEdicaoAtivo(pedido: PedidoComEdicao, agora: number = Date.now()): boolean {
  if (pedido.editStatus !== "editing") return false;
  if (!pedido.editExpiresAt) return false;
  return new Date(pedido.editExpiresAt).getTime() > agora;
}

/**
 * Limpeza preguiçosa (lazy) do lock expirado: se o pedido está com
 * editStatus "editing" mas o horário de expiração já passou, devolve o
 * pedido com o lock removido e o pedido original restaurado (nenhum dado do
 * rascunho existia no pedido — ele nunca foi sobrescrito antes do salvar).
 */
export function limparEdicaoExpiradaSeNecessario<T extends PedidoComEdicao>(
  pedido: T,
  agora: number = Date.now()
): { pedido: T; mudou: boolean } {
  if (pedido.editStatus !== "editing") return { pedido, mudou: false };
  if (lockEdicaoAtivo(pedido, agora)) return { pedido, mudou: false };

  const historico = [...(pedido.editHistory || []), {
    tipo: "expirado" as const,
    horario: new Date(agora).toISOString(),
    revisaoAnterior: pedido.revision ?? 1,
  }];
  const limpo: T = {
    ...pedido,
    editStatus: "none",
    editSessionId: undefined,
    editStartedAt: undefined,
    editExpiresAt: undefined,
    editHistory: historico,
  };
  return { pedido: limpo, mudou: true };
}

/** Remove o token interno de bloqueio antes de expor o pedido ao painel da Kellyne. */
export function sanitizarPedidoParaPainel<T extends PedidoComEdicao>(pedido: T): T {
  if (!("editSessionId" in pedido) && !("lastEditSessionId" in pedido)) return pedido;
  const { editSessionId: _editSessionId, lastEditSessionId: _lastEditSessionId, ...resto } = pedido;
  return resto as T;
}

export function criarSessaoEdicao(): string {
  return randomUUID();
}

/** Mesma comparação de tempo constante usada em /api/pedido-app/status — nunca aceitar token por igualdade simples. */
export function tokensIguais(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
