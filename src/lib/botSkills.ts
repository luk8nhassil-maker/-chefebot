// Skill Central de Recebimento
// Centraliza a detecção do tipo de recebimento do pedido.

export type FormaRecebimento = "delivery" | "pickup" | "dine_in";

// Keywords por tipo de recebimento
export const KEYWORDS_DELIVERY: string[] = [
  "entrega", "delivery", "entregar", "minha casa", "em casa",
  "manda ai", "manda aqui", "pra entregar", "para entregar",
  "quero entrega", "quero delivery", "vou querer entrega",
  "e pra entregar", "é pra entregar", "me manda",
];

export const KEYWORDS_PICKUP: string[] = [
  "retirar", "retirada", "buscar", "pegar", "retiro",
  "na loja", "busco ai", "vou buscar", "busco la",
  "vou la buscar", "vou pegar", "e retirada", "é retirada",
  "vou buscar ai", "buscar ai",
];

export const KEYWORDS_DINE_IN: string[] = [
  "consumo no local", "comer ai", "comer aqui", "aqui mesmo",
  "na mesa", "comer no local", "consumir no local",
  "vou comer ai", "vou comer aqui", "vou comer no local",
  "vou comer no restaurante", "comer no restaurante",
  "mesa", "no restaurante", "vou consumir no local",
  "quero uma pizza pra mesa", "pizza pra mesa",
];

// Normaliza texto: minúsculas sem acentos
function normalizar(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .trim();
}

/**
 * Detecta a forma de recebimento a partir de texto livre em português.
 * Retorna null se não detectar nada com confiança.
 *
 * Prioridade: dine_in > pickup > delivery
 * (evita falsos positivos de "na loja" que poderia ser retirada)
 */
export function detectarFormaRecebimento(text: string): FormaRecebimento | null {
  const n = normalizar(text);

  // dine_in tem prioridade porque tem keywords específicas
  for (const kw of KEYWORDS_DINE_IN) {
    if (n.includes(normalizar(kw))) return "dine_in";
  }
  // Padrão regex para variações de "local"
  if (/\blocal\b/.test(n)) return "dine_in";

  for (const kw of KEYWORDS_PICKUP) {
    if (n.includes(normalizar(kw))) return "pickup";
  }

  for (const kw of KEYWORDS_DELIVERY) {
    if (n.includes(normalizar(kw))) return "delivery";
  }

  return null;
}
