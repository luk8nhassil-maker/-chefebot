// Carteira de Presentes — fachada sobre jornadaChef.ts.
//
// NÃO cria chaves Redis paralelas; usa os mesmos jornada:recompensa:* e
// jornada:recompensas-cliente:* gerenciados pela jornada.
//
// Segurança (Manual Mestre): nenhum crédito de pontos/estrelas aqui;
// apenas leitura e delegação de estado já validado pelo servidor.

import {
  obterRecompensasCliente,
  abrirRecompensa,
  reservarRecompensaParaProximoPedido,
  cancelarReservaRecompensa,
  type RecompensaJornada,
  type StatusRecompensaJornada,
} from "./jornadaChef";

export type { RecompensaJornada, StatusRecompensaJornada };

export type CarteiraCliente = {
  clienteId: string;
  tenantId: string;
  presentes: RecompensaJornada[];
  totalDisponiveis: number;
};

/** Retorna a carteira com presentes acessíveis (fechados, disponíveis, reservados).
 * Expirados, resgatados e cancelados são omitidos da visão do cliente. */
export async function obterCarteiraCliente(
  clienteId: string,
  tenantId: string,
): Promise<CarteiraCliente> {
  if (!clienteId || !tenantId) {
    return { clienteId, tenantId, presentes: [], totalDisponiveis: 0 };
  }
  const todas = await obterRecompensasCliente(clienteId, tenantId);
  const visiveis: StatusRecompensaJornada[] = ["fechada", "disponivel", "reservada"];
  const presentes = todas.filter((r) => visiveis.includes(r.status));
  const totalDisponiveis = presentes.filter((r) => r.status === "disponivel").length;
  return { clienteId, tenantId, presentes, totalDisponiveis };
}

/** Abre a caixa-surpresa de um presente (fechada → disponível).
 * Idempotente: se já foi aberta devolve o mesmo resultado. */
export async function abrirPresente(
  clienteId: string,
  recompensaId: string,
  tenantId: string,
): Promise<RecompensaJornada> {
  return abrirRecompensa(clienteId, recompensaId, tenantId);
}

/** Reserva o presente para uso no próximo pedido (disponível → reservado). */
export async function reservarPresente(
  clienteId: string,
  recompensaId: string,
  tenantId: string,
): Promise<RecompensaJornada> {
  return reservarRecompensaParaProximoPedido(clienteId, recompensaId, tenantId);
}

/** Cancela a reserva sem perder o presente (reservado → disponível).
 * Só funciona antes de a reserva ser vinculada a um pedido real. */
export async function cancelarReservaPresente(
  clienteId: string,
  recompensaId: string,
  tenantId: string,
): Promise<RecompensaJornada> {
  return cancelarReservaRecompensa(clienteId, recompensaId, tenantId);
}
