// ============================================================================
// TOKEN DE VÍNCULO CARDÁPIO DIGITAL ↔ WHATSAPP
// ----------------------------------------------------------------------------
// Quando o bot envia o link do cardápio, anexa `?t=TOKEN` — um token OPACO
// (128 bits aleatórios, sem nenhum dado do cliente embutido) que o Redis
// resolve de volta para o phone do WhatsApp. O navegador nunca vê o phone
// completo: o endpoint de sessão devolve apenas os 4 últimos dígitos, e o
// vínculo real do pedido é resolvido server-side no POST /api/pedido-app.
//
// TTL de 24h: o link é reenviado a cada conversa (gate central do cardápio),
// então o token se renova naturalmente; janela curta minimiza replay de links
// encaminhados. Token expirado NUNCA quebra o site — o checkout apenas volta
// a pedir o WhatsApp manualmente.
// ============================================================================

import { randomUUID } from "crypto";
import { redis } from "./redis";
import { LINK_CARDAPIO_DIGITAL } from "./bot";

export const CARDAPIO_TOKEN_TTL_SEGUNDOS = 24 * 60 * 60; // 24h

type TokenPayload = { phone: string; createdAt: number };

const FORMATO_TOKEN = /^[a-f0-9]{32}$/;

function chaveToken(token: string): string {
  return `cardapio:token:${token}`;
}
function chaveTokenDoPhone(phone: string): string {
  return `cardapio:token_por_phone:${phone}`;
}

// Só os 4 últimos dígitos — é o máximo que o navegador pode conhecer.
export function mascararPhone(phone: string): string {
  const digitos = (phone || "").replace(/\D/g, "");
  return digitos.slice(-4);
}

// Gera (ou reutiliza, se ainda válido) o token de cardápio do phone.
// Reutilizar evita encher o Redis a cada mensagem e mantém o mesmo link
// funcionando durante a conversa. Renova o TTL a cada reuso.
export async function criarOuReutilizarTokenCardapio(phone: string): Promise<string> {
  const existente = await redis.get<string>(chaveTokenDoPhone(phone));
  if (existente && FORMATO_TOKEN.test(existente)) {
    const payload = await redis.get<TokenPayload>(chaveToken(existente));
    if (payload && payload.phone === phone) {
      await redis.set(chaveToken(existente), payload, { ex: CARDAPIO_TOKEN_TTL_SEGUNDOS });
      await redis.set(chaveTokenDoPhone(phone), existente, { ex: CARDAPIO_TOKEN_TTL_SEGUNDOS });
      return existente;
    }
  }
  const token = randomUUID().replace(/-/g, "");
  const payload: TokenPayload = { phone, createdAt: Date.now() };
  await redis.set(chaveToken(token), payload, { ex: CARDAPIO_TOKEN_TTL_SEGUNDOS });
  await redis.set(chaveTokenDoPhone(phone), token, { ex: CARDAPIO_TOKEN_TTL_SEGUNDOS });
  return token;
}

// Resolve um token para o phone. Retorna null para token ausente, com formato
// inválido (sem nem consultar o Redis) ou expirado/inexistente.
export async function validarTokenCardapio(token: string | null | undefined): Promise<{ phone: string } | null> {
  if (!token || !FORMATO_TOKEN.test(token)) return null;
  const payload = await redis.get<TokenPayload>(chaveToken(token));
  if (!payload || typeof payload.phone !== "string" || !payload.phone) return null;
  return { phone: payload.phone };
}

// Injeta `?t=TOKEN` em todas as ocorrências do link do cardápio numa mensagem
// já pronta. Idempotente: não injeta se o link já tiver token, e não altera
// mensagens sem o link.
export function anexarTokenAoLinkCardapio(mensagem: string, token: string): string {
  if (!mensagem || !token || !mensagem.includes(LINK_CARDAPIO_DIGITAL)) return mensagem;
  if (mensagem.includes(`${LINK_CARDAPIO_DIGITAL}?t=`)) return mensagem;
  return mensagem.split(LINK_CARDAPIO_DIGITAL).join(`${LINK_CARDAPIO_DIGITAL}?t=${token}`);
}
