import type { PixMetadata } from "@/lib/pix";
import type { PedidoComEdicao } from "@/lib/pedidoEdicao";
import type { ItemApp } from "@/lib/pedidoAppItens";

/** Forma do pedido tal como persistido em Redis (chave "pedidos"), usada pelos endpoints de edição. */
export type PedidoRedis = PedidoComEdicao & {
  id: string;
  numero?: number;
  cliente: string;
  telefone: string;
  itens: string[];
  itensDetalhados?: ItemApp[];
  total: number;
  status: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  horario: string;
  data?: string;
  endereco: string;
  rua?: string;
  enderecoNumero?: string;
  bairro?: string;
  referencia?: string;
  tipoEntrega?: "delivery" | "retirada" | "pickup" | "dine_in";
  taxaEntrega?: number;
  pagamento?: string;
  troco?: string;
  observacao?: string;
  statusToken?: string;
  origem?: string;
  clienteId?: string;
  pizzasCount?: number;
  resgateId?: string;
  descontoFidelidade?: number;
  whatsappVinculado?: boolean;
  pix?: PixMetadata;
  pixConfirmado?: boolean;
  isArchived?: boolean;
};
