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

// Versão de exibição para a confirmação do número na aba Pontos: formato real
// brasileiro, mas com o miolo sempre oculto — ex.: "(45) 9••••-0691". Revela
// no máximo DDD, o 9 inicial de celular e os 4 últimos dígitos; o restante é
// substituído por "•". Produzida SEMPRE no servidor a partir do phone
// resolvido do token — o navegador nunca recebe o número completo.
export function mascararTelefoneExibicao(phone: string): string {
  const digitos = (phone || "").replace(/\D/g, "");
  const local = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;
  if (local.length < 8) return "";
  const temDdd = local.length >= 10;
  const ddd = temDdd ? local.slice(0, 2) : "";
  const numero = temDdd ? local.slice(2) : local;
  const final = numero.slice(-4);
  const inicio = numero.length >= 9 ? `${numero[0]}${"•".repeat(numero.length - 5)}` : "•".repeat(numero.length - 4);
  return temDdd ? `(${ddd}) ${inicio}-${final}` : `${inicio}-${final}`;
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

const URL_CARDAPIO_DIGITAL = new URL(LINK_CARDAPIO_DIGITAL);
const PADRAO_URL = /(?<![\p{L}\p{N}])https?:\/\/[^\s<>"']+/gu;
const SUFIXOS_DE_TEXTO = new Set([".", ",", ";", ":", "!", ")", "]", "}", "*", "_", "~", "`", "”", "’", "»"]);
const ABERTURA_DO_FECHAMENTO: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
  "”": "“",
  "’": "‘",
  "»": "«",
};

function separarFechamentoSolto(link: string): { url: string; sufixo: string } {
  const match = link.match(/([)\]}”’»])([.,;:!?]*)$/u);
  if (!match) return { url: link, sufixo: "" };

  const [sufixo, fechamento] = match;
  const abertura = ABERTURA_DO_FECHAMENTO[fechamento];
  const fechamentos = link.split(fechamento).length - 1;
  const aberturas = link.split(abertura).length - 1;
  if (fechamentos <= aberturas) return { url: link, sufixo: "" };

  return { url: link.slice(0, -sufixo.length), sufixo };
}

function lerUrlCardapio(link: string): { url: URL; sufixo: string } | null {
  let { url: candidato, sufixo } = separarFechamentoSolto(link);

  while (candidato) {
    try {
      const url = new URL(candidato);
      if (
        url.origin === URL_CARDAPIO_DIGITAL.origin &&
        url.pathname === URL_CARDAPIO_DIGITAL.pathname
      ) {
        return { url, sufixo };
      }

      if (url.search || url.hash) return null;
    } catch {
      return null;
    }

    const ultimo = candidato.at(-1)!;
    if (!SUFIXOS_DE_TEXTO.has(ultimo)) return null;
    candidato = candidato.slice(0, -1);
    sufixo = `${ultimo}${sufixo}`;
  }

  return null;
}

// Injeta `t=TOKEN` em todas as ocorrências do link do cardápio numa mensagem
// já pronta. URLSearchParams preserva parâmetros adicionais e o fragmento,
// usando `&` quando a URL já tem query. Idempotente: um token existente nunca
// é substituído ou duplicado, e mensagens sem o link permanecem intactas.
export function anexarTokenAoLinkCardapio(mensagem: string, token: string): string {
  if (!mensagem || !token || !mensagem.includes(LINK_CARDAPIO_DIGITAL)) return mensagem;
  return mensagem.replace(PADRAO_URL, (link) => {
    const resultado = lerUrlCardapio(link);
    if (!resultado) return link;

    try {
      const { url, sufixo } = resultado;
      const tokenExistente = url.searchParams.getAll("t").find(Boolean);
      url.searchParams.set("t", tokenExistente ?? token);
      return `${url.toString()}${sufixo}`;
    } catch {
      return link;
    }
  });
}
