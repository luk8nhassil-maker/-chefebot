import type { PixMetadata } from "@/lib/pix";
import type { PedidoComEdicao } from "@/lib/pedidoEdicao";
import type { ItemApp } from "@/lib/pedidoAppItens";
import type { ItemElegibilidadeJornada } from "@/lib/jornadaChef";
import type { PedidoSnapshotOficial } from "@/lib/pedidoSnapshot";

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
  // Jornada do Chef (fidelidade por recorrência, camada separada dos pontos):
  // `itensJornada` é preenchido pelo bot de WhatsApp no momento da criação do
  // pedido (não há itensDetalhados estruturado nesse canal); `recompensaJornadaId`
  // identifica qual presente da Jornada foi usado neste pedido (rule 13/14).
  itensJornada?: ItemElegibilidadeJornada[];
  recompensaJornadaId?: string;
  whatsappVinculado?: boolean;
  pix?: PixMetadata;
  pixConfirmado?: boolean;
  isArchived?: boolean;
  // Fase 3 — representação estruturada e aditiva do que o servidor validou e
  // cobrou (preços em centavos, IDs do catálogo quando disponíveis). Nunca
  // substitui itens/total/taxaEntrega/itensDetalhados acima, que continuam
  // sendo a fonte lida por WhatsApp/Pix/impressão/fidelidade/Salão/pedido
  // manual — ver src/lib/pedidoSnapshot.ts. Ausente em pedidos antigos e em
  // pedidos recuperados via idempotência de retry (Modo Sobrevivência).
  snapshotOficial?: PedidoSnapshotOficial;
};
