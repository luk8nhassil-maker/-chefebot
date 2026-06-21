import { redis } from "./redis";
import type { AutorMensagem, MensagemRelevante } from "./bot";

// Log curto e rotativo das mensagens da conversa por telefone. Serve apenas para
// dar CONTEXTO à retomada inteligente pós-handoff (ver retomarFluxoAposHandoff).
// Não é a fonte da verdade do pedido — isso continua na BotSession.
const MAX_MENSAGENS = 8;
const TTL_SEGUNDOS = 1800; // 30 min, alinhado com a expiração da sessão

function chave(phone: string): string {
  return `conversa:${phone}`;
}

// Registra uma mensagem (cliente, atendente humano ou bot) no log da conversa.
// Falhas de Redis nunca quebram o fluxo do bot.
export async function registrarMensagem(
  phone: string,
  autor: AutorMensagem,
  texto: string,
): Promise<void> {
  if (!phone || !texto) return;
  try {
    const log = (await redis.get<MensagemRelevante[]>(chave(phone))) || [];
    log.push({ autor, texto: texto.slice(0, 400), ts: Date.now() });
    await redis.set(chave(phone), log.slice(-MAX_MENSAGENS), { ex: TTL_SEGUNDOS });
  } catch {
    // log de conversa é best-effort; nunca propaga erro
  }
}

// Retorna as N mensagens mais recentes da conversa (mais antiga → mais nova).
export async function ultimasMensagensRelevantes(
  phone: string,
  n = 2,
): Promise<MensagemRelevante[]> {
  try {
    const log = (await redis.get<MensagemRelevante[]>(chave(phone))) || [];
    return log.slice(-n);
  } catch {
    return [];
  }
}
