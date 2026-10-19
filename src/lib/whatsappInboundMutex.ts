import { createHash, randomUUID } from "node:crypto";
import { redis } from "./redis";

// Mutex por conversa: impede que duas mensagens diferentes sobrescrevam a
// sessão do mesmo cliente. Números diferentes nunca compartilham mutex.
// O handler WhatsApp tem maxDuration=30s; 40s de lease protegem o processamento
// inteiro e liberam automaticamente um lock se a função morrer.
const TTL_SEGUNDOS = 40;
const ESPERA_MAX_MS = 5_000;
const LIBERAR_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export type MutexConversaWhatsapp = { chave: string; token: string };

export class ConversaWhatsappOcupadaError extends Error {
  constructor() {
    super("whatsapp_conversation_busy");
    this.name = "ConversaWhatsappOcupadaError";
  }
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function chaveMutexConversaWhatsapp(phone: string): string {
  const digest = createHash("sha256").update(phone).digest("hex").slice(0, 32);
  return `whatsapp:inbound:mutex:${digest}`;
}

/**
 * Aguarda brevemente a conversa anterior terminar. Nunca passa adiante sem
 * SET NX confirmado; em contenção longa, o webhook retorna 503 em vez de
 * confirmar falsamente uma mensagem não processada.
 */
export async function adquirirMutexConversaWhatsapp(
  phone: string,
  tempoMaximoMs = ESPERA_MAX_MS,
): Promise<MutexConversaWhatsapp> {
  const chave = chaveMutexConversaWhatsapp(phone);
  const prazo = Date.now() + Math.max(0, tempoMaximoMs);
  for (let tentativa = 0; ; tentativa++) {
    const token = randomUUID();
    // Não supor sucesso em caso de Redis indisponível. A falha não permite
    // iniciar trabalho concorrente que possa corromper a sessão do cliente.
    const result = await redis.set(chave, token, { nx: true, ex: TTL_SEGUNDOS });
    if (result) return { chave, token };
    const restante = prazo - Date.now();
    if (restante <= 0) throw new ConversaWhatsappOcupadaError();
    await esperar(Math.min(restante, 75 + Math.min(tentativa, 10) * 20));
  }
}

export async function liberarMutexConversaWhatsapp(mutex: MutexConversaWhatsapp): Promise<void> {
  try {
    await redis.eval(LIBERAR_LUA, [mutex.chave], [mutex.token]);
  } catch {
    // O TTL faz a recuperação do lock mesmo quando o Redis oscila.
  }
}
