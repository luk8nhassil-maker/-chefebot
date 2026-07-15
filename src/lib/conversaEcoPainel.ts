import { redis } from "./redis";

// Etapa 2B: evita que o eco de uma mensagem enviada pelo painel
// (/api/conversas/enviar-mensagem-humana) seja registrado uma segunda vez
// quando a Evolution devolve o mesmo envio como evento fromMe no webhook.
// TTL curto (5–10 min) — só precisa sobreviver ao tempo entre o envio e o
// eco da Evolution chegar no webhook.
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

function idDeChaveMensagem(valor: unknown): string | undefined {
  const id = obterCampo(obterCampo(valor, "key"), "id");
  return typeof id === "string" && id.trim() ? id : undefined;
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
// confirmação de envio bem-sucedido pela Evolution. Nunca armazena texto,
// telefone ou nome: só a chave (o próprio ID) e um valor booleano.
export async function marcarEcoPainel(messageId: string): Promise<void> {
  if (!messageId) return;
  try {
    await redis.set(chaveEcoPainel(messageId), true, { ex: CONVERSA_ECO_PAINEL_TTL_SEGUNDOS });
  } catch {
    // best-effort: falha aqui no máximo permite um eco duplicado, nunca quebra o envio
  }
}

// Verifica se este messageId foi marcado pelo painel e, se sim, apaga a
// chave (consumo único) e retorna true. Usado pelo webhook fromMe para
// distinguir o eco de uma mensagem do painel de uma mensagem enviada
// diretamente pelo WhatsApp da pizzaria.
export async function consumirEcoPainel(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  try {
    const chave = chaveEcoPainel(messageId);
    const existe = await redis.get(chave);
    if (!existe) return false;
    await redis.del(chave);
    return true;
  } catch {
    return false;
  }
}
