// Fingerprint canônico de uma tentativa de checkout — usado para confirmar
// que um clientRequestId reaproveitado corresponde à MESMA tentativa (mesmo
// cliente, mesmos itens, mesmo endereço, mesma forma de pagamento), nunca
// apenas confiando no identificador isolado. Guarda-se só o hash SHA-256
// (64 chars hexadecimais) — nunca os dados legíveis (telefone, endereço,
// itens) dentro da chave de idempotência.

import { createHash } from "crypto";

export type PedidoFingerprintInput = {
  cliente: string;
  telefonePedido: string;
  /** Itens brutos do carrinho, como recebidos do cliente (antes de
   * recalcular preço no servidor) — suficiente para detectar diferença
   * entre tentativas; não precisa ser o preço oficial. */
  itens: unknown;
  tipoEntrega: string;
  bairro?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  pagamento: string;
  troco?: string;
  resgateId?: string;
  recompensaJornadaId?: string;
};

/** Serialização com ordem de chaves fixa — nunca depende da ordem de
 * inserção do objeto original, garantindo que o mesmo conteúdo lógico
 * sempre produza o mesmo fingerprint. */
function chaveCanonica(input: PedidoFingerprintInput): string {
  return JSON.stringify({
    cliente: input.cliente,
    telefonePedido: input.telefonePedido,
    itens: input.itens,
    tipoEntrega: input.tipoEntrega,
    bairro: input.bairro ?? null,
    rua: input.rua ?? null,
    numero: input.numero ?? null,
    referencia: input.referencia ?? null,
    pagamento: input.pagamento,
    troco: input.troco ?? null,
    resgateId: input.resgateId ?? null,
    recompensaJornadaId: input.recompensaJornadaId ?? null,
  });
}

export function calcularRequestFingerprint(input: PedidoFingerprintInput): string {
  return createHash("sha256").update(chaveCanonica(input)).digest("hex");
}
