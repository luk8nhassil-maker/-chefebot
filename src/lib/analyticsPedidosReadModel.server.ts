import "server-only";

import { redis } from "./redis";
import { lerComRetry } from "./datastoreRetry";
import { derivarClienteIdPorTelefone } from "./fidelidade";
import {
  calcularValorElegivelCentsParaHistorico,
  consultarEventosPorPeriodo,
  type EventoAnalitico,
  type EventoAnaliticoLeitura,
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
  // Pedidos legados podem ter somente `data + horario`. Se chamarmos
  // timestampCriacaoPedido primeiro, o fallback de "horario" interpreta esse
  // pedido como hoje/ontem e comprime todo o histórico em 7 dias. Por isso a
  // data legada completa vence o fallback de horário solto.
  if (typeof pedido.data === "string") {
    const m = pedido.data.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      const hm = typeof pedido.horario === "string" ? pedido.horario.trim().match(/^(\d{1,2}):(\d{2})/) : null;
      const hh = hm ? Number(hm[1]) : 12;
      const mm = hm ? Number(hm[2]) : 0;
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        const iso = `${m[3]}-${m[2]}-${m[1]}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00-03:00`;
        const ts = Date.parse(iso);
        if (Number.isFinite(ts)) return ts;
      }
    }
  }

  return timestampCriacaoPedido(pedido, agora);
}

function canal(pedido: PedidoFallback): EventoAnalitico["canal"] {
  if (typeof pedido.origem === "string" && pedido.origem.toLowerCase() === "painel") return "painel";
  if (typeof pedido.origem === "string" && pedido.origem.toLowerCase().includes("whatsapp")) return "whatsapp";
  if (pedido.tipoEntrega === "dine_in") return "salao";
  if (pedido.snapshotOficial) return "app";
  return "desconhecido";
}

export function eventosAnaliticosDePedidos(
  pedidos: PedidoFallback[],
  tenantId = TENANT_PADRAO_ANALYTICS,
  agora = Date.now(),
): EventoAnaliticoLeitura[] {
  const eventos: EventoAnaliticoLeitura[] = [];
  for (const pedido of pedidos) {
    if (pedido.status !== "entregue" || typeof pedido.id !== "string") continue;
    const clienteId = derivarClienteIdPorTelefone(pedido.telefone)
      ?? (typeof pedido.clienteId === "string" && pedido.clienteId.startsWith("cli_") ? pedido.clienteId : undefined);
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
    eventos.push({
      pedidoId: pedido.id,
      ...(clienteId ? { clienteId } : {}),
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
): Promise<EventoAnaliticoLeitura[]> {
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
  opcoes: { incluirIndiceCompleto?: boolean } = {},
): Promise<{ eventos: EventoAnaliticoLeitura[]; fallbackTodos: EventoAnaliticoLeitura[]; fonte: FonteEventosAnalytics }> {
  // O modo histórico precisa consultar as duas fontes: o índice permanente
  // começou a ser gravado em 19/09, enquanto a lista operacional pode conter
  // somente a janela mais recente de pedidos. Os períodos curtos permanecem
  // no caminho rápido abaixo para não aumentar o consumo normal do Redis.
  if (opcoes.incluirIndiceCompleto) {
    const [indice, fallback] = await Promise.allSettled([
      consultarEventosPorPeriodo(tenantId, inicioMs, fimMs),
      lerEventosFallbackPedidos(tenantId, agora),
    ]);

    if (indice.status === "rejected" && fallback.status === "rejected") {
      throw new Error("analytics_sources_unavailable");
    }

    const eventosIndice = indice.status === "fulfilled" ? indice.value : [];
    const fallbackTodos = fallback.status === "fulfilled" ? fallback.value : [];
    const fallbackPeriodo = fallbackTodos.filter(
      (ev) => ev.criadoEmMs >= inicioMs && ev.criadoEmMs <= fimMs,
    );

    // O evento permanente é a fonte mais rica (regra/estrelas/canal). O
    // pedido operacional só completa o que ainda não estiver no índice.
    const porPedido = new Map<string, EventoAnaliticoLeitura>();
    for (const ev of fallbackPeriodo) porPedido.set(ev.pedidoId, ev);
    const idsIndice = new Set(eventosIndice.map((ev) => ev.pedidoId));
    for (const ev of eventosIndice) porPedido.set(ev.pedidoId, ev);

    const extrasFallback = fallbackPeriodo.filter((ev) => !idsIndice.has(ev.pedidoId)).length;
    const origem: FonteEventosAnalytics["origem"] = extrasFallback > 0
      ? (eventosIndice.length > 0 ? "analytics+pedidos" : "pedidos")
      : eventosIndice.length > 0
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
