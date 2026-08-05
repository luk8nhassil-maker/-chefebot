import { redis } from "./redis";
import type { AutorMensagem, MensagemRelevante } from "./bot";
import { atualizarHistorico } from "./conversasHistorico";
import { sincronizarCronometroInatividade } from "./inatividadeConversa";

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
  const ts = Date.now();
  try {
    const log = (await redis.get<MensagemRelevante[]>(chave(phone))) || [];
    log.push({ autor, texto: texto.slice(0, 400), ts });
    await redis.set(chave(phone), log.slice(-MAX_MENSAGENS), { ex: TTL_SEGUNDOS });
  } catch {
    // log de conversa é best-effort; nunca propaga erro
  }
  // Aguarda a tentativa de gravação do histórico permanente (conversa_full)
  // antes de registrarMensagem() finalizar — antes era fire-and-forget
  // (.catch() sem await), o que podia deixar a escrita pendente quando a
  // função serverless já havia encerrado, perdendo a mensagem em silêncio.
  // atualizarHistorico() já isola suas próprias falhas de Redis internamente
  // e nunca lança; o try/catch aqui é só uma segunda camada de segurança,
  // sem nunca logar telefone ou texto da mensagem.
  try {
    await atualizarHistorico(phone, autor, texto, ts);
  } catch {
    console.error("[ChefeBot] Falha ao gravar histórico permanente da conversa.");
  }
  // Ponto único de sincronização do cronômetro de cancelamento por
  // inatividade (ver src/lib/inatividadeConversa.ts) — cobre automaticamente
  // todo caminho que registra mensagem (bot, atendente via app ou painel,
  // cliente), sem precisar duplicar a chamada em cada rota. A função já é
  // best-effort internamente; o try/catch aqui é só uma segunda camada de
  // segurança, mesmo padrão do histórico permanente acima.
  try {
    await sincronizarCronometroInatividade(phone, autor);
  } catch {
    // nunca propaga — perder um agendamento de cronômetro não pode derrubar o registro da mensagem
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
