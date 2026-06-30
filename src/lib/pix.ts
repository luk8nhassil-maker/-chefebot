import { temPixNoPagamento, valorPixEsperado } from "./bot";

export type PixMetadata = {
  txid?: string;
  valorEsperado?: number;
  status?: "pendente" | "confirmado";
  confirmadoPor?: "manual" | "webhook" | "comprovante";
  confirmadoEm?: string;
  providerPaymentId?: string;
};

export function gerarTxidPixInterno(pedidoId: string): string {
  return `chefebot_${pedidoId}`;
}

export function criarPixMetadata(pedidoId: string, pagamento: string | undefined, total: number): PixMetadata | undefined {
  if (!temPixNoPagamento(pagamento)) return undefined;

  return {
    txid: gerarTxidPixInterno(pedidoId),
    valorEsperado: valorPixEsperado(pagamento, total),
    status: "pendente",
  };
}
