import { redis } from "./redis";

// Etapa 2B: evita que o eco de uma mensagem enviada pelo painel
// (/api/conversas/enviar-mensagem-humana) seja registrado uma segunda vez
// quando a Evolution devolve o mesmo envio como evento fromMe no webhook.
// TTL curto (5–10 min) — só precisa sobreviver ao tempo entre o envio e o
// eco da Evolution chegar no webhook. A chave permanece até o TTL (nunca é
// apagada no primeiro eco) porque a Evolution pode reentregar o mesmo
// webhook mais de uma vez (reenvio/retry) e todas as entregas repetidas do
// mesmo messageId precisam continuar suprimidas.
export const CONVERSA_ECO_PAINEL_TTL_SEGUNDOS = 600;

function chaveEcoPainel(messageId: string): string {
  return `conversa:echo-painel:${messageId}`;
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function obterCampo(valor: unknown, chave: string): unknown {
  return ehObjeto(valor) ? valor[chave] : undefined;
}

// Único ponto de validação de um ID de mensagem vindo de dado externo
// (`unknown`): só aceita string não vazia após trim(). Usado tanto para o
// retorno de envio da Evolution quanto para `data.key.id` do webhook —
// nunca cria uma chave Redis a partir de `undefined`, `null`, número ou
// objeto convertidos silenciosamente em string (ex.: "[object Object]").
export function validarMessageId(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() ? valor.trim() : undefined;
}

function idDeChaveMensagem(valor: unknown): string | undefined {
  return validarMessageId(obterCampo(obterCampo(valor, "key"), "id"));
}

// Extrai o ID real da mensagem a partir do JSON retornado por
// message/sendText da Evolution API. O payload é `unknown` (resposta HTTP
// externa) — só aceita o ID quando existe como string não vazia em um dos
// formatos comprovados: `key.id` no topo da resposta (formato Baileys/
// Evolution usado no envio) ou `data.key.id` (mesmo aninhamento do payload
// de webhook messages.upsert, caso a Evolution espelhe esse formato aqui
// também). Nenhum outro formato é assumido.
export function extrairMessageIdEnvio(payload: unknown): string | undefined {
  return idDeChaveMensagem(payload) ?? idDeChaveMensagem(obterCampo(payload, "data"));
}

// Marca que este messageId foi enviado pelo painel — chamado só depois de
// confirmação de envio bem-sucedido pela Evolution, e ANTES de registrar a
// mensagem no histórico (fecha a janela de corrida: se o webhook fromMe
// chegar entre o envio e o registro, ele já encontra a marca). Nunca
// armazena texto, telefone ou nome: só a chave (o próprio ID) e um valor
// booleano.
export async function marcarEcoPainel(messageId: string): Promise<void> {
  if (!messageId) return;
  try {
    await redis.set(chaveEcoPainel(messageId), true, { ex: CONVERSA_ECO_PAINEL_TTL_SEGUNDOS });
  } catch {
    // best-effort: falha aqui no máximo permite um eco duplicado, nunca quebra o envio
  }
}

// Verifica se este messageId foi marcado pelo painel. Só consulta — nunca
// apaga a chave, para que reentregas repetidas do mesmo webhook (retry da
// Evolution) continuem suprimidas até o TTL expirar naturalmente.
export async function ehEcoPainel(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  try {
    const existe = await redis.get(chaveEcoPainel(messageId));
    return !!existe;
  } catch {
    return false;
  }
}
