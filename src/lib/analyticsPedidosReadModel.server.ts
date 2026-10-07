import "server-only";

import { redis } from "./redis";
import { lerComRetry } from "./datastoreRetry";
import { derivarClienteIdPorTelefone } from "./fidelidade";
import {
  calcularValorElegivelCentsParaHistorico,
  consultarEventosPorPeriodo,
  type EventoAnalitico,
  TENANT_PADRAO_ANALYTICS,
} from "./historicoAnalitico";
import { timestampCriacaoPedido, chaveExpedienteOperacional } from "./expedienteOperacional";
import type { PedidoSnapshotOficial } from "./pedidoSnapshot";

type PedidoFallback = {
  id?: string;
  clienteId?: string;
  telefone?: string;
  total?: number;
  taxaEntrega?: number;
  status?: string;
  origem?: string;
  tipoEntrega?: string;
  criadoEm?: string;
  horario?: string;
  data?: string;
  pix?: { criadoEm?: string; confirmadoEm?: string } | null;
  snapshotOficial?: PedidoSnapshotOficial;
};

export type FonteEventosAnalytics = {
  indiceDisponivel: boolean;
  fallbackPedidosDisponivel: boolean;
  eventosIndice: number;
  eventosFallbackAdicionados: number;
  origem: "analytics" | "analytics+pedidos" | "pedidos";
};

function timestampLegado(pedido: PedidoFallback, agora: number): number | null {
  const direto = timestampCriacaoPedido(pedido, agora);
  if (direto !== null) return direto;
  if (typeof pedido.data !== "string") return null;
  const m = pedido.data.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const hm = typeof pedido.horario === "string" ? pedido.horario.trim().match(/^(\d{1,2}):(\d{2})/) : null;
  const hh = hm ? Number(hm[1]) : 12;
  const mm = hm ? Number(hm[2]) : 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00-03:00`;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : null;
}

function canal(pedido: PedidoFallback): EventoAnalitico["canal"] {
  if (typeof pedido.origem === "string" && pedido.origem.toLowerCase().includes("whatsapp")) return "whatsapp";
  if (pedido.tipoEntrega === "dine_in") return "salao";
  if (pedido.snapshotOficial) return "app";
  return "desconhecido";
}

export function eventosAnaliticosDePedidos(
  pedidos: PedidoFallback[],
  tenantId = TENANT_PADRAO_ANALYTICS,
  agora = Date.now(),
): EventoAnalitico[] {
  const eventos: EventoAnalitico[] = [];
  for (const pedido of pedidos) {
    if (pedido.status !== "entregue" || typeof pedido.id !== "string") continue;
    const clienteId = derivarClienteIdPorTelefone(pedido.telefone)
      ?? (typeof pedido.clienteId === "string" && pedido.clienteId.startsWith("cli_") ? pedido.clienteId : undefined);
    if (!clienteId) continue;
    const criadoEmMs = timestampLegado(pedido, agora);
    if (criadoEmMs === null) continue;
    const valorElegivelCents = calcularValorElegivelCentsParaHistorico({
      id: pedido.id,
      telefone: pedido.telefone,
      total: pedido.total,
      taxaEntrega: pedido.taxaEntrega,
      origem: pedido.origem,
      tipoEntrega: pedido.tipoEntrega,
      snapshotOficial: pedido.snapshotOficial,
    });
    if (valorElegivelCents <= 0) continue;
    eventos.push({
      pedidoId: pedido.id,
      clienteId,
      tenantId,
      criadoEmMs,
      expedienteId: chaveExpedienteOperacional(criadoEmMs),
      valorElegivelCents,
      statusAnalitico: "entregue",
      canal: canal(pedido),
      estrelasGeradas: 0,
      schemaVersao: 1,
      regraVersao: "fallback-pedidos-readonly",
    });
  }
  return eventos;
}

export async function lerEventosFallbackPedidos(
  tenantId = TENANT_PADRAO_ANALYTICS,
  agora = Date.now(),
): Promise<EventoAnalitico[]> {
  const pedidos = await lerComRetry(
    () => redis.get<PedidoFallback[]>("pedidos"),
    { tentativas: 2, esperaBaseMs: 80 },
  );
  return eventosAnaliticosDePedidos(Array.isArray(pedidos) ? pedidos : [], tenantId, agora);
}

export async function consultarEventosAnaliticosComFallback(
  tenantId: string,
  inicioMs: number,
  fimMs: number,
  agora = Date.now(),
): Promise<{ eventos: EventoAnalitico[]; fallbackTodos: EventoAnalitico[]; fonte: FonteEventosAnalytics }> {
  const [indice, fallback] = await Promise.allSettled([
    consultarEventosPorPeriodo(tenantId, inicioMs, fimMs),
    lerEventosFallbackPedidos(tenantId, agora),
  ]);

  if (indice.status === "rejected" && fallback.status === "rejected") {
    throw new Error("analytics_sources_unavailable");
  }

  const eventosIndice = indice.status === "fulfilled" ? indice.value : [];
  const fallbackTodos = fallback.status === "fulfilled" ? fallback.value : [];
  const fallbackPeriodo = fallbackTodos.filter((ev) => ev.criadoEmMs >= inicioMs && ev.criadoEmMs <= fimMs);

  const porPedido = new Map<string, EventoAnalitico>();
  for (const ev of fallbackPeriodo) porPedido.set(ev.pedidoId, ev);
  const idsIndice = new Set(eventosIndice.map((ev) => ev.pedidoId));
  for (const ev of eventosIndice) porPedido.set(ev.pedidoId, ev);

  const extrasFallback = fallbackPeriodo.filter((ev) => !idsIndice.has(ev.pedidoId)).length;
  const origem: FonteEventosAnalytics["origem"] = extrasFallback > 0
    ? (eventosIndice.length > 0 ? "analytics+pedidos" : "pedidos")
    : indice.status === "fulfilled"
      ? "analytics"
      : "pedidos";

  return {
    eventos: [...porPedido.values()],
    fallbackTodos,
    fonte: {
      indiceDisponivel: indice.status === "fulfilled",
      fallbackPedidosDisponivel: fallback.status === "fulfilled",
      eventosIndice: eventosIndice.length,
      eventosFallbackAdicionados: extrasFallback,
      origem,
    },
  };
}
