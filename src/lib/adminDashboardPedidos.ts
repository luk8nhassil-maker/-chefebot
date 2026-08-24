import { chaveExpedienteDoPedido, chaveExpedienteOperacional } from "./expedienteOperacional";

export type PeriodoDashboard = "ontem" | "hoje" | "semana" | "personalizado";

export type PedidoDashboardTemporal = {
  id?: string;
  horario?: string;
  data?: string;
  criadoEm?: string;
  expedienteOperacional?: string;
  pix?: { criadoEm?: string; confirmadoEm?: string } | null;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const HORA_VIRADA_EXPEDIENTE = 3;

function chaveValida(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

function deslocarChave(chave: string, dias: number): string | null {
  const match = chave.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(base + dias * MS_POR_DIA).toISOString().slice(0, 10);
}

function temFonteTemporalAbsoluta(pedido: PedidoDashboardTemporal): boolean {
  if (typeof pedido.criadoEm === "string" && pedido.criadoEm.trim()) return true;
  if (typeof pedido.id === "string" && /^\d{13,15}$/.test(pedido.id)) return true;
  if (typeof pedido.pix?.criadoEm === "string" && pedido.pix.criadoEm.trim()) return true;
  if (typeof pedido.pix?.confirmadoEm === "string" && pedido.pix.confirmadoEm.trim()) return true;
  return false;
}

function chavePorDataLegada(pedido: PedidoDashboardTemporal): string | null {
  if (typeof pedido.data !== "string") return null;
  const data = pedido.data.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!data) return null;

  const horaMatch = typeof pedido.horario === "string" ? pedido.horario.trim().match(/^(\d{1,2}):(\d{2})/) : null;
  const hora = horaMatch ? Number(horaMatch[1]) : HORA_VIRADA_EXPEDIENTE;
  if (!Number.isFinite(hora) || hora < 0 || hora > 23) return null;

  let base = Date.UTC(Number(data[3]), Number(data[2]) - 1, Number(data[1]));
  if (hora < HORA_VIRADA_EXPEDIENTE) base -= MS_POR_DIA;
  return new Date(base).toISOString().slice(0, 10);
}

/**
 * Resolve a data operacional do pedido para relatórios do Dashboard.
 * Fontes absolutas (expediente explícito, criadoEm, ID temporal, Pix) vencem.
 * `data` + `horario` fica como compatibilidade para pedidos antigos.
 */
export function chaveOperacionalPedidoDashboard(
  pedido: PedidoDashboardTemporal,
  agora: number = Date.now(),
): string | null {
  if (chaveValida(pedido.expedienteOperacional)) return pedido.expedienteOperacional;

  if (temFonteTemporalAbsoluta(pedido)) {
    return chaveExpedienteDoPedido(pedido, agora);
  }

  return chavePorDataLegada(pedido) ?? chaveExpedienteDoPedido(pedido, agora);
}

/**
 * Filtro único do Dashboard. "Hoje" segue o mesmo expediente da operação:
 * a virada é às 03:00 em America/Sao_Paulo, não à meia-noite.
 */
export function filtrarPedidosPorPeriodoDashboard<T extends PedidoDashboardTemporal>(
  pedidos: T[],
  periodo: PeriodoDashboard,
  dataInicio: string,
  dataFim: string,
  agora: number = Date.now(),
): T[] {
  if (!Array.isArray(pedidos)) return [];

  const hoje = chaveExpedienteOperacional(agora);
  const ontem = deslocarChave(hoje, -1);
  const inicioSemana = deslocarChave(hoje, -6);

  return pedidos.filter((pedido) => {
    const chave = chaveOperacionalPedidoDashboard(pedido, agora);
    if (!chave) return false;

    if (periodo === "hoje") return chave === hoje;
    if (periodo === "ontem") return ontem !== null && chave === ontem;
    if (periodo === "semana") return inicioSemana !== null && chave >= inicioSemana && chave <= hoje;
    if (periodo === "personalizado") {
      if (!chaveValida(dataInicio) || !chaveValida(dataFim)) return false;
      return chave >= dataInicio && chave <= dataFim;
    }
    return true;
  });
}
