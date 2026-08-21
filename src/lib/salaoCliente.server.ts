import { randomUUID } from "crypto";
import { redis } from "./redis";
import type { Comanda } from "./comandas";

// Usa exatamente o MESMO mutex da lista de comandas. A operação continua
// serializada com inclusão de itens, envio e demais mutações read-modify-write.
const CHAVE_COMANDAS = "salao:comandas";
const CHAVE_MUTEX_COMANDAS = "salao:comandas:mutex";
const MUTEX_TTL_SEGUNDOS = 5;
const MUTEX_RETRY_MAX = 20;
const MUTEX_RETRY_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AtualizarClienteSalaoResultado =
  | { ok: true; comanda: Comanda }
  | { ok: false; motivo: "cliente_invalido" | "nao_encontrada" | "comanda_fechada" | "mutex_indisponivel" };

/**
 * Atualiza SOMENTE o nome do cliente no fim do fluxo do Salão.
 * Não toca em itens, preços, rodadas, status, mesa ou pagamento.
 */
export async function atualizarClienteSalao(
  comandaId: string,
  cliente: string,
): Promise<AtualizarClienteSalaoResultado> {
  const clienteTrim = cliente.trim();
  if (!clienteTrim) return { ok: false, motivo: "cliente_invalido" };

  const token = randomUUID();
  let adquirido = false;
  for (let tentativa = 0; tentativa < MUTEX_RETRY_MAX; tentativa++) {
    const ok = await redis.set(CHAVE_MUTEX_COMANDAS, token, { nx: true, ex: MUTEX_TTL_SEGUNDOS });
    if (ok) {
      adquirido = true;
      break;
    }
    await sleep(MUTEX_RETRY_DELAY_MS);
  }
  if (!adquirido) return { ok: false, motivo: "mutex_indisponivel" };

  try {
    const lista = (await redis.get<Comanda[]>(CHAVE_COMANDAS)) || [];
    const idx = lista.findIndex((c) => c.id === comandaId);
    if (idx < 0) return { ok: false, motivo: "nao_encontrada" };
    if (lista[idx].status === "fechada") return { ok: false, motivo: "comanda_fechada" };

    const atualizada: Comanda = { ...lista[idx], cliente: clienteTrim };
    lista[idx] = atualizada;
    await redis.set(CHAVE_COMANDAS, lista);
    return { ok: true, comanda: atualizada };
  } finally {
    try {
      const atual = await redis.get<string>(CHAVE_MUTEX_COMANDAS);
      if (atual === token) await redis.del(CHAVE_MUTEX_COMANDAS);
    } catch {
      // Best-effort: o TTL curto impede mutex preso.
    }
  }
}
