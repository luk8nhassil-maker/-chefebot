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
  // Caminho quente do painel: a chave `pedidos` já contém a fonte oficial da
  // operação e é lida em uma única chamada. Não espere o índice analítico
  // evento-a-evento quando essa fonte estiver disponível, porque isso transforma
  // uma tela simples em centenas de round-trips remotos.
  try {
    const fallbackTodos = await lerEventosFallbackPedidos(tenantId, agora);
    if (fallbackTodos.length > 0) {
      const fallbackPeriodo = fallbackTodos.filter(
        (ev) => ev.criadoEmMs >= inicioMs && ev.criadoEmMs <= fimMs,
      );
      return {
        eventos: fallbackPeriodo,
        fallbackTodos,
        fonte: {
          indiceDisponivel: false,
          fallbackPedidosDisponivel: true,
          eventosIndice: 0,
          eventosFallbackAdicionados: fallbackPeriodo.length,
          origem: "pedidos",
        },
      };
    }
  } catch {
    // Se a fonte operacional falhar, caímos para o índice analítico abaixo.
  }

  // Fallback real: usa o índice analítico apenas quando não foi possível servir
  // a leitura pelos pedidos oficiais. Assim o painel continua resiliente sem
  // pagar o custo do N+1 no caminho normal.
  const eventosIndice = await consultarEventosPorPeriodo(tenantId, inicioMs, fimMs);
  return {
    eventos: eventosIndice,
    fallbackTodos: [],
    fonte: {
      indiceDisponivel: true,
      fallbackPedidosDisponivel: false,
      eventosIndice: eventosIndice.length,
      eventosFallbackAdicionados: 0,
      origem: "analytics",
    },
  };
}
