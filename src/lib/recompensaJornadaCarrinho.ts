// Referência LOCAL do presente reservado da Jornada do Chef — a ponte entre a
// Área do Cliente (/cliente/jornada) e o carrinho oficial do cardápio
// (/pedido, sessionStorage "cf_draft"). Guarda só recompensaId + escolha
// permitida (sabor) + rótulos de exibição — NUNCA é fonte de verdade de
// produto/preço: o servidor sempre rematerializa o item do snapshot da
// própria recompensa no POST /api/pedido-app.
//
// Vive em localStorage (não sessionStorage) de propósito: o rascunho da
// sacola morre com a aba, mas a reserva continua válida no servidor — sem uma
// referência que sobreviva a fechar/reabrir o navegador, o cliente via o card
// "presente está no carrinho" com a sacola vazia (bug real de Production).
// A referência sozinha nunca injeta nada: o cardápio só materializa o item
// depois de confirmar na API autenticada que a reserva ainda está de pé.

export const CF_RECOMPENSA_JORNADA_KEY = "cf_recompensa_jornada";

export type ReferenciaRecompensaJornada = {
  recompensaId: string;
  escolha?: { sabor?: string };
  produtoNome?: string;
  validaAte?: string;
};

export interface StorageRecompensaLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function lerReferenciaRecompensa(storage: StorageRecompensaLike): ReferenciaRecompensaJornada | null {
  try {
    const raw = storage.getItem(CF_RECOMPENSA_JORNADA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReferenciaRecompensaJornada;
    if (!parsed || typeof parsed.recompensaId !== "string" || !parsed.recompensaId) {
      storage.removeItem(CF_RECOMPENSA_JORNADA_KEY);
      return null;
    }
    if (parsed.validaAte && new Date(parsed.validaAte).getTime() <= Date.now()) {
      storage.removeItem(CF_RECOMPENSA_JORNADA_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Retorna se a escrita realmente aconteceu — storage pode falhar silenciosamente
 * em navegadores restritos (ex.: webview com armazenamento bloqueado). */
export function gravarReferenciaRecompensa(storage: StorageRecompensaLike, ref: ReferenciaRecompensaJornada): boolean {
  try {
    storage.setItem(CF_RECOMPENSA_JORNADA_KEY, JSON.stringify(ref));
    return storage.getItem(CF_RECOMPENSA_JORNADA_KEY) !== null;
  } catch {
    return false;
  }
}

export function limparReferenciaRecompensa(storage: StorageRecompensaLike): void {
  try {
    storage.removeItem(CF_RECOMPENSA_JORNADA_KEY);
  } catch {}
}

/** Migra a chave da era sessionStorage (one-shot, morria com a aba) para o
 * localStorage, sem sobrescrever uma referência mais nova que já exista lá. */
export function migrarReferenciaLegada(sessao: StorageRecompensaLike, local: StorageRecompensaLike): void {
  try {
    const legado = sessao.getItem(CF_RECOMPENSA_JORNADA_KEY);
    if (!legado) return;
    sessao.removeItem(CF_RECOMPENSA_JORNADA_KEY);
    if (!local.getItem(CF_RECOMPENSA_JORNADA_KEY)) local.setItem(CF_RECOMPENSA_JORNADA_KEY, legado);
  } catch {}
}

export type ReservadaParaReconciliar = {
  recompensaId: string;
  tipo: string | null;
  produtoNome: string | null;
  validaAte?: string;
  reservaPedidoId?: string;
};

export type DecisaoReconciliacao =
  | { acao: "manter" }
  | { acao: "reconstruir"; referencia: ReferenciaRecompensaJornada }
  | { acao: "liberar" };

/**
 * Reconciliação do estado "reservada" do servidor com o carrinho real do
 * navegador (rule: nunca manter um falso "presente está no carrinho"):
 * - referência local presente e apontando para a mesma recompensa → manter;
 * - referência perdida e o presente NÃO exige escolha (bebida/sobremesa/
 *   composição) → reconstruir a referência com segurança (o cardápio volta a
 *   materializar o item ao abrir a sacola);
 * - referência perdida e o presente é pizza (o sabor escolhido se perdeu
 *   junto) → liberar a reserva no servidor: a recompensa volta a "disponivel"
 *   e o cliente escolhe o sabor de novo — nunca reconstruímos uma escolha que
 *   o cliente não fez.
 * Reserva já vinculada a um pedido real (reservaPedidoId) nunca é tocada.
 */
export function reconciliarReservaComReferencia(
  reservada: ReservadaParaReconciliar,
  referencia: ReferenciaRecompensaJornada | null
): DecisaoReconciliacao {
  if (reservada.reservaPedidoId) return { acao: "manter" };
  if (referencia && referencia.recompensaId === reservada.recompensaId) return { acao: "manter" };
  if (reservada.tipo === "pizza") return { acao: "liberar" };
  return {
    acao: "reconstruir",
    referencia: {
      recompensaId: reservada.recompensaId,
      ...(reservada.produtoNome ? { produtoNome: reservada.produtoNome } : {}),
      ...(reservada.validaAte ? { validaAte: reservada.validaAte } : {}),
    },
  };
}
