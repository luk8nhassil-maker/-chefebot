// Rascunho de checkout do Modo Sobrevivência — armazenamento local
// versionado e com expiração, isolado do mecanismo "cf_draft" já existente
// em src/app/cardapio/page.tsx (sessionStorage, sem versão/expiração
// explícitas). Este módulo não substitui nem altera "cf_draft" — é a base
// que a UI de fallback manual (Etapa 2) vai usar para sobreviver ao
// fechamento do navegador, algo que sessionStorage não garante.
//
// Guarda só o necessário para reconstruir a tentativa de pedido: carrinho,
// entrega/retirada, endereço, observação, forma de pagamento, troco, etapa
// atual e o identificador da tentativa (clientRequestId). NUNCA guarda
// token, cookie, QR Pix, payload confidencial, dado de cartão, segredo ou
// credencial — o tipo do payload não tem campo para nada disso.
//
// Segue o mesmo padrão de src/lib/pixPendenteLocal.ts: funções puras que
// recebem um `StorageLike` injetado (testável sem jsdom), nunca lançam, e
// falham em silêncio quando o storage está indisponível (modo privado,
// quota) — perder o rascunho nunca pode travar o checkout.

export const SURVIVAL_DRAFT_KEY = "survival:pedido:rascunho:v1";
export const SURVIVAL_DRAFT_SCHEMA_VERSION = 1;
export const SURVIVAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — expiração segura, nunca "para sempre"

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Payload deliberadamente sem token/cookie/QR/cartão/segredo — só o que o
 * próprio cliente digitou/escolheu no checkout. `cart` é mantido opaco
 * (unknown[]) de propósito: este módulo não conhece o formato de item do
 * cardápio, para não criar dependência circular com src/app/cardapio. */
export type SurvivalDraftPayload = {
  cart: unknown[];
  screen?: string;
  tipoEntrega?: string;
  bairro?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  observacao?: string;
  pagamento?: string;
  trocoOpcao?: string;
  troco?: string;
  /** Identificador da tentativa atual (ver src/survival/clientRequestId.ts). */
  clientRequestId?: string;
};

type SurvivalDraftEnvelope = {
  v: number;
  savedAt: number;
  payload: SurvivalDraftPayload;
};

/** Grava o rascunho. Carrinho vazio limpa o rascunho em vez de gravar um
 * envelope inútil — mesma regra do "cf_draft" existente. */
export function salvarRascunhoSobrevivencia(storage: StorageLike, payload: SurvivalDraftPayload): void {
  try {
    if (!Array.isArray(payload.cart) || payload.cart.length === 0) {
      limparRascunhoSobrevivencia(storage);
      return;
    }
    const envelope: SurvivalDraftEnvelope = {
      v: SURVIVAL_DRAFT_SCHEMA_VERSION,
      savedAt: Date.now(),
      payload,
    };
    storage.setItem(SURVIVAL_DRAFT_KEY, JSON.stringify(envelope));
  } catch {
    // Storage indisponível (modo privado, quota) — o rascunho simplesmente
    // não é salvo; nunca impede o checkout de continuar.
  }
}

/** Lê o rascunho. Retorna null (e limpa a chave) se: não existir, vier
 * corrompido, tiver versão de schema diferente da atual, ou tiver expirado
 * (> SURVIVAL_DRAFT_TTL_MS desde que foi salvo). Nunca lança. */
export function lerRascunhoSobrevivencia(storage: StorageLike): SurvivalDraftPayload | null {
  let raw: string | null;
  try {
    raw = storage.getItem(SURVIVAL_DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SurvivalDraftEnvelope> | null;
    if (!parsed || typeof parsed.v !== "number" || parsed.v !== SURVIVAL_DRAFT_SCHEMA_VERSION) {
      limparRascunhoSobrevivencia(storage);
      return null;
    }
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > SURVIVAL_DRAFT_TTL_MS) {
      limparRascunhoSobrevivencia(storage);
      return null;
    }
    const payload = parsed.payload;
    if (!payload || !Array.isArray(payload.cart)) {
      limparRascunhoSobrevivencia(storage);
      return null;
    }
    return payload;
  } catch {
    limparRascunhoSobrevivencia(storage);
    return null;
  }
}

export function limparRascunhoSobrevivencia(storage: StorageLike): void {
  try {
    storage.removeItem(SURVIVAL_DRAFT_KEY);
  } catch {
    // Ignorado — mesma regra de "nunca travar o checkout" acima.
  }
}
