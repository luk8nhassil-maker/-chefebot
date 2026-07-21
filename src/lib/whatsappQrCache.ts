import { createHash } from "crypto";
import { redis } from "./redis";

// Cache de curtíssimo prazo do QR atualmente válido da instância — namespace
// exclusivo, nunca compartilhado com outras chaves do Redis. Fonte única de
// verdade para o que GET /api/whatsapp/state expõe ao painel: nem o
// frontend nem quem chama POST /api/whatsapp/qrcode precisam confiar num
// timer local desacoplado do servidor. Todas as operações são best-effort —
// uma falha do Redis aqui nunca pode impedir a exibição de um QR que a
// Evolution já entregou (degrada para o comportamento sem cache).

export type WhatsappQrRecord = {
  base64: string;
  generatedAt: number;
  expiresAt: number;
  /** Monotônico (timestamp da geração) — uma geração mais antiga nunca sobrescreve uma mais nova. */
  generationId: number;
  /** Hash curto não reversível — só para correlacionar logs, nunca o payload. */
  hash: string;
  size: number;
  instanceName: string;
};

// Baileys/Evolution rotacionam o QR em pareamento a cada ~20s enquanto o
// estado é "connecting"; a margem cobre o tempo de rede até a persistência.
const TTL_QR_SEGUNDOS = 30;
const LOCK_TTL_SEGUNDOS = 8;
const PREFIXO_QR = "whatsapp:qr:";
const PREFIXO_LOCK = "whatsapp:qr:lock:";

function chaveQr(instanceName: string): string {
  return `${PREFIXO_QR}${instanceName}`;
}

function chaveLock(instanceName: string): string {
  return `${PREFIXO_LOCK}${instanceName}`;
}

function hashCurto(base64: string): string {
  return createHash("sha256").update(base64).digest("hex").slice(0, 12);
}

/**
 * Persiste o QR mais recente. Uma geração já salva mais nova (ou igual) nunca
 * é sobrescrita — protege contra reentrega fora de ordem do webhook. Sempre
 * devolve um registro válido ao chamador, mesmo se o Redis falhar.
 */
export async function persistirQrAtual(instanceName: string, base64: string): Promise<WhatsappQrRecord> {
  const generatedAt = Date.now();
  const novo: WhatsappQrRecord = {
    base64,
    generatedAt,
    expiresAt: generatedAt + TTL_QR_SEGUNDOS * 1000,
    generationId: generatedAt,
    hash: hashCurto(base64),
    size: base64.length,
    instanceName,
  };
  try {
    const atual = await redis.get<WhatsappQrRecord>(chaveQr(instanceName));
    if (atual && atual.generationId > novo.generationId) return atual;
    await redis.set(chaveQr(instanceName), novo, { ex: TTL_QR_SEGUNDOS });
  } catch {
    // Best-effort: segue devolvendo o QR recém-obtido mesmo sem cache.
  }
  return novo;
}

/** Leitura pura — nunca toca a instância na Evolution. Expirado conta como ausente. */
export async function lerQrAtual(instanceName: string): Promise<WhatsappQrRecord | null> {
  try {
    const record = await redis.get<WhatsappQrRecord>(chaveQr(instanceName));
    if (!record) return null;
    if (Date.now() > record.expiresAt) return null;
    return record;
  } catch {
    return null;
  }
}

/** Limpa o QR persistido — chamado quando a conexão sai do estado "connecting" (open ou close). */
export async function limparQrAtual(instanceName: string): Promise<void> {
  try {
    await redis.del(chaveQr(instanceName));
  } catch {
    // Best-effort — o TTL curto garante que o registro expira sozinho de qualquer forma.
  }
}

/**
 * Lock curto para impedir que duas requisições concorrentes (duplo clique,
 * duas abas) disparem dois /instance/connect quase simultâneos. Falha do
 * Redis nunca deve bloquear o fluxo principal — nesse caso a função
 * devolve `true` (segue como se o lock tivesse sido adquirido), no pior
 * caso reproduzindo o comportamento anterior (sem lock nenhum).
 */
export async function adquirirLockGeracaoQr(instanceName: string): Promise<boolean> {
  try {
    const ok = await redis.set(chaveLock(instanceName), "1", { nx: true, ex: LOCK_TTL_SEGUNDOS });
    return !!ok;
  } catch {
    return true;
  }
}
