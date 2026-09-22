// Histórico analítico de pedidos — separado da fila operacional `pedidos`.
//
// Objetivo: registrar eventos imutáveis de pedidos entregues para análise de
// recorrência, ticket e fidelidade em janelas de 7/30/60/90 dias.
//
// Arquitetura Redis (sem SCAN):
//   analytics:idx:{tenantId}             — Sorted Set global: score=criadoEmMs, member=pedidoId
//   analytics:cliente:{tenantId}:{cId}   — Sorted Set por cliente: mesmo padrão
//   analytics:evento:{tenantId}:{pid}    — String JSON: EventoAnalitico
//
// Segurança:
//   - clienteId é derivado (derivarClienteIdPorTelefone), nunca telefone em texto
//   - Não armazena: nome, endereço, telefone bruto, itens, observação
//   - tenant-scoped: toda chave contém tenantId
//   - Idempotente: SET NX na criação; estorno só atualiza statusAnalitico
//
// Ponto de gravação: processarEfeitosPedidoEntregue (fidelidadeEfeitos.ts) — autoridade
// única de efeitos. Nunca espalhar gravações em outras rotas.

import { redis } from "./redis";
import { chaveExpedienteOperacional } from "./expedienteOperacional";
import { derivarClienteIdPorTelefone } from "./fidelidade";
import { calcularEstrelasPorValorElegivel, REGRA_ESTRELAS_V1 } from "./estrelas";
import type { PedidoSnapshotOficial } from "./pedidoSnapshot";

export const SCHEMA_VERSAO_ATUAL = 1 as const;

export type StatusAnalitico = "entregue" | "estornado";
export type CanalPedido = "app" | "whatsapp" | "salao" | "desconhecido";

export type EventoAnalitico = {
  pedidoId: string;
  clienteId: string;
  tenantId: string;
  criadoEmMs: number;
  expedienteId: string;
  valorElegivelCents: number;
  statusAnalitico: StatusAnalitico;
  canal: CanalPedido;
  estrelasGeradas: number;
  schemaVersao: typeof SCHEMA_VERSAO_ATUAL;
  regraVersao: string;
  estornadoEmMs?: number;
};

export type PedidoParaHistorico = {
  id: string;
  telefone?: string;
  tenantId?: string;
  total?: number;
  taxaEntrega?: number;
  origem?: string;
  tipoEntrega?: string;
  snapshotOficial?: PedidoSnapshotOficial;
};

export type MetricasAnaliticas = {
  pedidosValidos: number;
  clientesUnicos: number;
  clientesNovos: number;
  clientesRecorrentes: number;
  percentualClientesRecorrentes: number;
  ticketMedioCents: number;
  ticketMedianoCents: number;
  receitaElegivelCents: number;
  estrelasDistribuidas: number;
  cohortePorPedidos: Record<string, number>;
  percentualReceitaRecorrentes: number;
  clientesComSegundoPedido: number;
  percentualClientesComSegundoPedido: number;
  pedidosMediosPorCliente: number;
  receitaMediaPorClienteCents: number;
  serieDiaria: Array<{
    data: string;
    pedidos: number;
    receitaCents: number;
    clientesUnicos: number;
  }>;
  porCanal: Record<CanalPedido, { pedidos: number; receitaCents: number }>;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;
// Page size for ZRANGEBYSCORE pagination — each page = 1 ZRANGE + N GETs.
// 500 balances Redis round-trips vs command budget on Upstash Free plan.
const PAGINA_ZRANGE = 500;
// Parallel GET batch size per page — avoids building huge Promise.all arrays.
const BATCH_GET = 200;

export const TENANT_PADRAO_ANALYTICS = "default";

// ── Typed Redis cast (Upstash SDK supports these ops natively) ───────────────

type RedisAnalitico = typeof redis & {
  zadd: (
    key: string,
    opts: { score: number; member: string } | Array<{ score: number; member: string }>
  ) => Promise<number>;
  zrange: (
    key: string,
    min: number | string,
    max: number | string,
    opts?: { byScore?: boolean; count?: number; rev?: boolean; offset?: number; limit?: { offset: number; count: number } }
  ) => Promise<string[]>;
};

const aredis = redis as RedisAnalitico;

// ── Key builders ─────────────────────────────────────────────────────────────

export function chaveIndiceGlobal(tenantId: string): string {
  return `analytics:idx:${tenantId}`;
}

export function chaveIndiceCliente(tenantId: string, clienteId: string): string {
  return `analytics:cliente:${tenantId}:${clienteId}`;
}

export function chaveEvento(tenantId: string, pedidoId: string): string {
  return `analytics:evento:${tenantId}:${pedidoId}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferirCanal(pedido: PedidoParaHistorico): CanalPedido {
  if (typeof pedido.origem === "string" && pedido.origem.toLowerCase().includes("whatsapp")) return "whatsapp";
  if (pedido.tipoEntrega === "dine_in") return "salao";
  if (pedido.snapshotOficial) return "app";
  return "desconhecido";
}

export function calcularValorElegivelCentsParaHistorico(pedido: PedidoParaHistorico): number {
  if (pedido.snapshotOficial) {
    return Math.max(
      (pedido.snapshotOficial.subtotalCents ?? 0) - (pedido.snapshotOficial.descontoFidelidadeCents ?? 0),
      0
    );
  }
  return Math.max(
    Math.round(((Number(pedido.total) || 0) - (Number(pedido.taxaEntrega) || 0)) * 100),
    0
  );
}

// ── Write operations ─────────────────────────────────────────────────────────

/**
 * Records a delivered order into the permanent analytics history.
 *
 * Idempotent: SET NX — if already recorded for this pedidoId, no-op.
 * Index ZADDs are also idempotent (same score+member pair = no change).
 *
 * Called exclusively from processarEfeitosPedidoEntregue (fidelidadeEfeitos.ts)
 * as the "analytics" effect — tracked in the effect state machine.
 */
export async function registrarEventoEntregue(
  pedido: PedidoParaHistorico,
  agora: number = Date.now()
): Promise<void> {
  const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
  if (!clienteId) return;

  const tenantId = pedido.tenantId ?? TENANT_PADRAO_ANALYTICS;
  const valorElegivelCents = calcularValorElegivelCentsParaHistorico(pedido);
  if (valorElegivelCents <= 0) return;

  const estrelasGeradas = calcularEstrelasPorValorElegivel(valorElegivelCents);
  const expedienteId = chaveExpedienteOperacional(agora);

  const evento: EventoAnalitico = {
    pedidoId: pedido.id,
    clienteId,
    tenantId,
    criadoEmMs: agora,
    expedienteId,
    valorElegivelCents,
    statusAnalitico: "entregue",
    canal: inferirCanal(pedido),
    estrelasGeradas,
    schemaVersao: SCHEMA_VERSAO_ATUAL,
    regraVersao: REGRA_ESTRELAS_V1,
  };

  const chaveEv = chaveEvento(tenantId, pedido.id);
  const criado = await redis.set(chaveEv, evento, { nx: true });
  if (!criado) return; // already recorded

  await aredis.zadd(chaveIndiceGlobal(tenantId), { score: agora, member: pedido.id });
  await aredis.zadd(chaveIndiceCliente(tenantId, clienteId), { score: agora, member: pedido.id });
}

/**
 * Marks a previously-delivered order as reversed (estornado).
 *
 * Only applies when statusAnterior === "entregue" was passed through the cancel
 * flow — i.e., an order erroneously marked delivered and then corrected.
 * Orders cancelled before delivery have no analytics record and this is a no-op.
 *
 * Idempotent: if not found or already estornado, no-op.
 */
export async function estornarEventoAnalitico(
  pedidoId: string,
  tenantId: string = TENANT_PADRAO_ANALYTICS,
  agora: number = Date.now()
): Promise<void> {
  const chaveEv = chaveEvento(tenantId, pedidoId);
  const evento = await redis.get<EventoAnalitico>(chaveEv);
  if (!evento) return;
  if (evento.statusAnalitico === "estornado") return;

  await redis.set(chaveEv, {
    ...evento,
    statusAnalitico: "estornado" as StatusAnalitico,
    estornadoEmMs: agora,
  });
}

// ── Read helpers ─────────────────────────────────────────────────────────────

/**
 * Paginates a Sorted Set by score range — no SCAN, no silent truncation.
 *
 * Each page issues one ZRANGEBYSCORE with LIMIT offset/count.
 * Stops when a page returns fewer entries than the page size.
 * GETs are batched in parallel chunks of BATCH_GET to bound memory.
 */
async function lerTodosEventosDaChave(
  indiceKey: string,
  tenantId: string,
  inicioMs: number,
  fimMs: number
): Promise<EventoAnalitico[]> {
  const todos: EventoAnalitico[] = [];
  let offset = 0;

  while (true) {
    const pagina = await aredis.zrange(indiceKey, inicioMs, fimMs, {
      byScore: true,
      limit: { offset, count: PAGINA_ZRANGE },
    });

    if (pagina.length === 0) break;

    // Fetch this page's events in parallel batches
    for (let i = 0; i < pagina.length; i += BATCH_GET) {
      const slice = pagina.slice(i, i + BATCH_GET);
      const resultados = await Promise.all(
        slice.map((id) => redis.get<EventoAnalitico>(chaveEvento(tenantId, id)))
      );
      for (const ev of resultados) {
        if (ev !== null) todos.push(ev);
      }
    }

    if (pagina.length < PAGINA_ZRANGE) break; // last page
    offset += pagina.length;
  }

  return todos;
}

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * Returns all analytics events in [inicioMs, fimMs].
 * Paginates ZRANGEBYSCORE — no SCAN, no silent truncation above 1000 events.
 */
export async function consultarEventosPorPeriodo(
  tenantId: string,
  inicioMs: number,
  fimMs: number
): Promise<EventoAnalitico[]> {
  if (inicioMs > fimMs) return [];
  return lerTodosEventosDaChave(chaveIndiceGlobal(tenantId), tenantId, inicioMs, fimMs);
}

/**
 * Returns the analytics history before a selected period.
 * Used only to classify current-period clients as new or returning.
 */
export async function consultarEventosAntesDe(
  tenantId: string,
  antesDeMs: number
): Promise<EventoAnalitico[]> {
  if (antesDeMs <= 0) return [];
  return lerTodosEventosDaChave(chaveIndiceGlobal(tenantId), tenantId, 0, antesDeMs - 1);
}

/**
 * Returns analytics events for a single client in [inicioMs, fimMs].
 * Paginates per-client sorted set — no SCAN, no cross-client data.
 */
export async function consultarEventosCliente(
  tenantId: string,
  clienteId: string,
  inicioMs: number,
  fimMs: number
): Promise<EventoAnalitico[]> {
  if (inicioMs > fimMs) return [];
  return lerTodosEventosDaChave(chaveIndiceCliente(tenantId, clienteId), tenantId, inicioMs, fimMs);
}

// ── Period helpers ────────────────────────────────────────────────────────────

export function periodo7Dias(agora: number = Date.now()): { inicioMs: number; fimMs: number } {
  return { inicioMs: agora - 7 * MS_POR_DIA, fimMs: agora };
}

export function periodo30Dias(agora: number = Date.now()): { inicioMs: number; fimMs: number } {
  return { inicioMs: agora - 30 * MS_POR_DIA, fimMs: agora };
}

export function periodo60Dias(agora: number = Date.now()): { inicioMs: number; fimMs: number } {
  return { inicioMs: agora - 60 * MS_POR_DIA, fimMs: agora };
}

export function periodo90Dias(agora: number = Date.now()): { inicioMs: number; fimMs: number } {
  return { inicioMs: agora - 90 * MS_POR_DIA, fimMs: agora };
}

// ── Pure analytics computation ────────────────────────────────────────────────

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const sorted = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/**
 * Pure function — computes all analytics metrics from a list of events.
 * Excludes estornados from all revenue/ticket/recurrence metrics.
 */
export function calcularMetricas(
  eventos: EventoAnalitico[],
  clientesComHistoricoAnterior: ReadonlySet<string> = new Set()
): MetricasAnaliticas {
  const validos = eventos.filter((ev) => ev.statusAnalitico === "entregue");

  if (validos.length === 0) {
    return {
      pedidosValidos: 0,
      clientesUnicos: 0,
      clientesNovos: 0,
      clientesRecorrentes: 0,
      percentualClientesRecorrentes: 0,
      ticketMedioCents: 0,
      ticketMedianoCents: 0,
      receitaElegivelCents: 0,
      estrelasDistribuidas: 0,
      cohortePorPedidos: {},
      percentualReceitaRecorrentes: 0,
      clientesComSegundoPedido: 0,
      percentualClientesComSegundoPedido: 0,
      pedidosMediosPorCliente: 0,
      receitaMediaPorClienteCents: 0,
      serieDiaria: [],
      porCanal: {
        app: { pedidos: 0, receitaCents: 0 },
        whatsapp: { pedidos: 0, receitaCents: 0 },
        salao: { pedidos: 0, receitaCents: 0 },
        desconhecido: { pedidos: 0, receitaCents: 0 },
      },
    };
  }

  const receitaPorCliente = new Map<string, number>();
  const pedidosPorCliente = new Map<string, number>();

  for (const ev of validos) {
    receitaPorCliente.set(ev.clienteId, (receitaPorCliente.get(ev.clienteId) ?? 0) + ev.valorElegivelCents);
    pedidosPorCliente.set(ev.clienteId, (pedidosPorCliente.get(ev.clienteId) ?? 0) + 1);
  }

  const tickets = validos.map((ev) => ev.valorElegivelCents);
  const receitaTotal = tickets.reduce((s, v) => s + v, 0);
  const estrelasTotal = validos.reduce((s, ev) => s + ev.estrelasGeradas, 0);
  const clientesRecorrentes = [...receitaPorCliente.keys()].filter((clienteId) => clientesComHistoricoAnterior.has(clienteId)).length;
  const clientesNovos = receitaPorCliente.size - clientesRecorrentes;

  const cohortePorPedidos: Record<string, number> = {};
  for (const count of pedidosPorCliente.values()) {
    const chave = count >= 5 ? "5+" : String(count);
    cohortePorPedidos[chave] = (cohortePorPedidos[chave] ?? 0) + 1;
  }

  const receitaRecorrentes = [...receitaPorCliente.entries()]
    .filter(([cId]) => (pedidosPorCliente.get(cId) ?? 0) >= 2)
    .reduce((s, [, v]) => s + v, 0);

  const clientesComSegundoPedido = [...pedidosPorCliente.values()].filter((count) => count >= 2).length;
  const porDia = new Map<string, { pedidos: number; receitaCents: number; clientes: Set<string> }>();
  const porCanal: MetricasAnaliticas["porCanal"] = {
    app: { pedidos: 0, receitaCents: 0 },
    whatsapp: { pedidos: 0, receitaCents: 0 },
    salao: { pedidos: 0, receitaCents: 0 },
    desconhecido: { pedidos: 0, receitaCents: 0 },
  };

  for (const ev of validos) {
    const data = new Date(ev.criadoEmMs).toISOString().slice(0, 10);
    const dia = porDia.get(data) ?? { pedidos: 0, receitaCents: 0, clientes: new Set<string>() };
    dia.pedidos += 1;
    dia.receitaCents += ev.valorElegivelCents;
    dia.clientes.add(ev.clienteId);
    porDia.set(data, dia);

    porCanal[ev.canal].pedidos += 1;
    porCanal[ev.canal].receitaCents += ev.valorElegivelCents;
  }

  const serieDiaria = [...porDia.entries()]
    .sort(([dataA], [dataB]) => dataA.localeCompare(dataB))
    .map(([data, dia]) => ({ data, pedidos: dia.pedidos, receitaCents: dia.receitaCents, clientesUnicos: dia.clientes.size }));

  return {
    pedidosValidos: validos.length,
    clientesUnicos: receitaPorCliente.size,
    clientesNovos,
    clientesRecorrentes,
    percentualClientesRecorrentes:
      receitaPorCliente.size > 0 ? Math.round((clientesRecorrentes / receitaPorCliente.size) * 100) : 0,
    ticketMedioCents: Math.round(receitaTotal / validos.length),
    ticketMedianoCents: mediana(tickets),
    receitaElegivelCents: receitaTotal,
    estrelasDistribuidas: estrelasTotal,
    cohortePorPedidos,
    percentualReceitaRecorrentes:
      receitaTotal > 0 ? Math.round((receitaRecorrentes / receitaTotal) * 100) : 0,
    clientesComSegundoPedido,
    percentualClientesComSegundoPedido:
      receitaPorCliente.size > 0 ? Math.round((clientesComSegundoPedido / receitaPorCliente.size) * 100) : 0,
    pedidosMediosPorCliente: receitaPorCliente.size > 0 ? Number((validos.length / receitaPorCliente.size).toFixed(2)) : 0,
    receitaMediaPorClienteCents: receitaPorCliente.size > 0 ? Math.round(receitaTotal / receitaPorCliente.size) : 0,
    serieDiaria,
    porCanal,
  };
}
