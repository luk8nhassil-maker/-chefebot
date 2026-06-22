/**
 * REGRA DE HIGIENIZAÇÃO DE MENSAGEM DO CLIENTE
 *
 * Remove emojis e caracteres não textuais de uma mensagem antes de qualquer
 * interpretação pelo bot. Preserva letras (incluindo acentuadas), números e
 * pontuação. Normaliza espaços duplicados.
 *
 * Casos tratados:
 *  - Emoji com apresentação visual padrão (😋, 🍕, 🔥, 👍, ✅, etc.)
 *  - Variation selectors (U+FE00–U+FE0F) que forçam apresentação emoji
 *  - Zero-width joiner (U+200D) usado em sequências compostas (👨‍👩‍👧)
 *  - Modificadores de cor de pele (U+1F3FB–U+1F3FF)
 *  - Indicadores regionais de bandeiras (U+1F1E0–U+1F1FF)
 */
export function normalizarMensagemCliente(texto: string): string {
  if (!texto) return "";

  return texto
    // Emoji com apresentação visual por padrão (não afeta dígitos 0-9)
    .replace(/\p{Emoji_Presentation}/gu, "")
    // Indicadores regionais de bandeiras
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    // Modificadores de cor de pele
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
    // Variation selector-16 (força apresentação emoji) e demais variation selectors
    .replace(/[︀-️]/gu, "")
    // Zero-width joiner (une partes em sequências de emoji compostos)
    .replace(/‍/gu, "")
    // Normaliza espaços múltiplos gerados pela remoção de emoji inline
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Retorna true se o texto original tinha conteúdo mas após a remoção de
 * emojis ficou completamente vazio — ou seja, era composto apenas de emoji.
 */
export function ehMensagemSomenteEmoji(texto: string): boolean {
  if (!texto.trim()) return false;
  return normalizarMensagemCliente(texto).length === 0;
}
