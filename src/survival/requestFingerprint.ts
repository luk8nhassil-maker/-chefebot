// Fingerprint canônico de uma tentativa de checkout — usado para confirmar
// que um clientRequestId reaproveitado corresponde à MESMA tentativa (mesmo
// cliente, mesmos itens, mesmo endereço, mesma forma de pagamento, mesma
// observação/e-mail/presente da Jornada do Chef), nunca apenas confiando no
// identificador isolado. Guarda-se só o hash SHA-256 (64 chars hexadecimais)
// — nunca os dados legíveis (telefone, endereço, itens, observação, e-mail)
// dentro da chave de idempotência nem do pedido persistido.

import { createHash } from "crypto";

export type PedidoFingerprintInput = {
  cliente: string;
  telefonePedido: string;
  /** Itens brutos do carrinho, como recebidos do cliente (antes de
   * recalcular preço no servidor) — suficiente para detectar diferença
   * entre tentativas; não precisa ser o preço oficial. A ORDEM dos itens é
   * preservada de propósito (não ordenada) — trocar a ordem dos itens no
   * carrinho é tratado como uma tentativa potencialmente diferente. */
  itens: unknown;
  tipoEntrega: string;
  bairro?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  observacao?: string;
  /** E-mail normalizado (trim + lowercase) antes de chegar aqui — ver
   * `normalizarEmailParaFingerprint`. */
  email?: string;
  pagamento: string;
  troco?: string;
  resgateId?: string;
  recompensaJornadaId?: string;
  /** Sabor escolhido para o presente da Jornada do Chef (quando a recompensa
   * for uma pizza) — falta disso no fingerprint permitiria reaproveitar o
   * mesmo clientRequestId trocando só o sabor do presente sem detecção. */
  recompensaEscolhaSabor?: string;
};

export function normalizarEmailParaFingerprint(email: string | undefined): string | undefined {
  const trimmed = (email || "").trim().toLowerCase();
  return trimmed || undefined;
}

/**
 * Normalização canônica recursiva:
 * - chaves de objetos são ordenadas alfabeticamente (nunca depende da ordem
 *   de inserção original do JSON recebido);
 * - a ORDEM dos elementos de arrays é preservada (nunca ordenada) — a
 *   sequência dos itens do carrinho importa;
 * - strings são normalizadas com `trim()` (espaços nas bordas nunca criam um
 *   fingerprint diferente por acidente de digitação/reenvio);
 * - `undefined` é representado de forma consistente como `null` (em vez de
 *   a chave simplesmente desaparecer, o que mudaria a forma do objeto
 *   dependendo de qual campo estava ausente).
 */
function normalizarRecursivo(valor: unknown): unknown {
  if (typeof valor === "string") return valor.trim();
  if (valor === undefined || valor === null) return null;
  if (Array.isArray(valor)) return valor.map(normalizarRecursivo);
  if (typeof valor === "object") {
    const chaves = Object.keys(valor as Record<string, unknown>).sort();
    const resultado: Record<string, unknown> = {};
    for (const chave of chaves) {
      resultado[chave] = normalizarRecursivo((valor as Record<string, unknown>)[chave]);
    }
    return resultado;
  }
  return valor;
}

function chaveCanonica(input: PedidoFingerprintInput): string {
  const objetoCanonico = {
    cliente: input.cliente,
    telefonePedido: input.telefonePedido,
    itens: input.itens,
    tipoEntrega: input.tipoEntrega,
    bairro: input.bairro,
    rua: input.rua,
    numero: input.numero,
    referencia: input.referencia,
    observacao: input.observacao,
    email: normalizarEmailParaFingerprint(input.email),
    pagamento: input.pagamento,
    troco: input.troco,
    resgateId: input.resgateId,
    recompensaJornadaId: input.recompensaJornadaId,
    recompensaEscolhaSabor: input.recompensaEscolhaSabor,
  };
  return JSON.stringify(normalizarRecursivo(objetoCanonico));
}

export function calcularRequestFingerprint(input: PedidoFingerprintInput): string {
  return createHash("sha256").update(chaveCanonica(input)).digest("hex");
}
