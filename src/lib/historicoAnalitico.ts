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
export type CanalPedido = "painel" | "app" | "whatsapp" | "salao" | "desconhecido";

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

/** Evento lido para métricas; pedidos manuais sem identificação não são persistidos no índice por cliente. */
export type EventoAnaliticoLeitura = Omit<EventoAnalitico, "clienteId"> & { clienteId?: string };

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
  pedidosSemClienteIdentificado: number;
  pedidosComClienteIdentificado: number;
  receitaElegivelClientesIdentificadosCents: number;
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
  porCanal: Record<CanalPedido, { pedidos: number; receitaCents: number; pedidoIds: string[] }>;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;
export const FUSO_ANALYTICS = "America/Sao_Paulo";
// Page size for ZRANGEBYSCORE pagination — each page = 1 ZRANGE + N GETs.
// 500 balances Redis round-trips vs command budget on Upstash Free plan.
const PAGINA_ZRANGE = 500;
// Parallel GET batch size per page — avoids building huge Promise.all arrays.
const BATCH_GET = 200;

export const TENANT_PADRAO_ANALYTICS = "default";

function partesDataNoFuso(ms: number, fuso: string): { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number } | null {
  if (!Number.isFinite(ms)) return null;
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const pegar = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
    const resultado = {
      ano: pegar("year"),
      mes: pegar("month"),
      dia: pegar("day"),
      hora: pegar("hour") % 24,
      minuto: pegar("minute"),
      segundo: pegar("second"),
    };
    return Object.values(resultado).every(Number.isFinite) ? resultado : null;
  } catch {
    return null;
  }
}

/** Início do dia civil no fuso da pizzaria, sem depender do fuso do servidor. */
export function inicioDiaAnalytics(ms: number, fuso: string = FUSO_ANALYTICS): number | null {
  const data = partesDataNoFuso(ms, fuso);
  if (!data) return null;
  // Usa o meio-dia UTC para descobrir o deslocamento daquela data sem cair
  // na véspera; isso também mantém a função correta se o fuso mudar no futuro.
  const meioDiaUtc = Date.UTC(data.ano, data.mes - 1, data.dia, 12);
  const partesMeioDia = partesDataNoFuso(meioDiaUtc, fuso);
  if (!partesMeioDia) return null;
  const horaLocalComoUtc = Date.UTC(
    data.ano,
    data.mes - 1,
    data.dia,
    partesMeioDia.hora,
    partesMeioDia.minuto,
    partesMeioDia.segundo,
  );
  const deslocamento = horaLocalComoUtc - meioDiaUtc;
  return Date.UTC(data.ano, data.mes - 1, data.dia) - deslocamento;
}

/** Janela dos primeiros N dias da campanha, limitada ao instante atual. */
export function periodoDesdeInicioCampanha(
  inicioCampanhaMs: number,
  dias: number,
  agora: number = Date.now(),
): { inicioMs: number; fimMs: number; diasCorridosDisponiveis: number } {
  const inicioMs = inicioCampanhaMs;
  const fimLimiteMs = inicioMs + Math.max(1, dias) * MS_POR_DIA - 1;
  const fimMs = Math.min(agora, fimLimiteMs);
  const diasCorridosDisponiveis = fimMs < inicioMs
    ? 0
    : Math.min(Math.max(1, dias), Math.floor((fimMs - inicioMs) / MS_POR_DIA) + 1);
  return { inicioMs, fimMs, diasCorridosDisponiveis };
}

// ── Typed Redis cast (Upstash SDK supports these ops natively) ───────────────

type RedisAnalitico = typeof redis & {
  mget: <T>(...keys: string[]) => Promise<Array<T | null>>;
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
  if (pedido.origem?.toLowerCase() === "painel") return "painel";
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
  // O histórico completo começa no início da linha do tempo. Nesse caso,
  // leia o índice inteiro de uma vez: pedir páginas com offset faz o Redis
  // repetir trabalho para cada página e pode estourar o tempo da função.
  if (inicioMs === 0) {
    const ids = await aredis.zrange(indiceKey, 0, Number.MAX_SAFE_INTEGER) as string[];
    const todos: EventoAnalitico[] = [];
    for (let i = 0; i < ids.length; i += BATCH_GET) {
      const chaves = ids.slice(i, i + BATCH_GET).map((id) => chaveEvento(tenantId, id));
      const mget = (aredis as Partial<RedisAnalitico>).mget;
      const resultados = typeof mget === "function"
        ? await mget<EventoAnalitico>(...chaves)
        : await Promise.all(chaves.map((chave) => redis.get<EventoAnalitico>(chave)));
      for (const ev of resultados) {
        if (ev !== null && ev.criadoEmMs <= fimMs) todos.push(ev);
      }
    }
    return todos;
  }

  const todos: EventoAnalitico[] = [];
  let offset = 0;

  while (true) {
    const pagina = await aredis.zrange(indiceKey, inicioMs, fimMs, {
      byScore: true,
      limit: { offset, count: PAGINA_ZRANGE },
    });

    if (pagina.length === 0) break;

    // Fetch this page's events in batches. MGET keeps the complete-history
    // view from turning into one network request per order. The fallback is
    // kept for the small in-memory test client and older compatible clients.
    for (let i = 0; i < pagina.length; i += BATCH_GET) {
      const slice = pagina.slice(i, i + BATCH_GET);
      const chaves = slice.map((id) => chaveEvento(tenantId, id));
      const mget = (aredis as Partial<RedisAnalitico>).mget;
      const resultados = typeof mget === "function"
        ? await mget<EventoAnalitico>(...chaves)
        : await Promise.all(chaves.map((chave) => redis.get<EventoAnalitico>(chave)));
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
 * Verifica recorrência somente para os clientes presentes no período atual.
 * Evita ler todo o histórico antigo e todos os eventos apenas para responder
 * "este cliente já comprou antes?".
 */
export async function consultarClientesComHistoricoAnterior(
  tenantId: string,
  clienteIds: Iterable<string>,
  antesDeMs: number,
): Promise<Set<string>> {
  const ids = [...new Set([...clienteIds].filter(Boolean))];
  const resultado = new Set<string>();
  if (antesDeMs <= 0 || ids.length === 0) return resultado;

  const BATCH_CLIENTES = 50;
  for (let i = 0; i < ids.length; i += BATCH_CLIENTES) {
    const lote = ids.slice(i, i + BATCH_CLIENTES);
    const respostas = await Promise.all(
      lote.map((clienteId) =>
        aredis.zrange(
          chaveIndiceCliente(tenantId, clienteId),
          0,
          antesDeMs - 1,
          { byScore: true, limit: { offset: 0, count: 1 } },
        ),
      ),
    );
    respostas.forEach((itens, idx) => {
      if (itens.length > 0) resultado.add(lote[idx]!);
    });
  }
  return resultado;
}

/**
 * Confirma, com custo O(1), se o coletor analítico já possuía histórico antes
 * de um instante. Usado por regras semanais que não podem tratar uma semana
 * parcialmente instrumentada como se fosse uma semana completa.
 *
 * Não lê todos os eventos antigos: consulta no máximo 1 membro do Sorted Set.
 */
export async function existeHistoricoAnaliticoAntesDe(
  tenantId: string,
  antesDeMs: number
): Promise<boolean> {
  if (!Number.isFinite(antesDeMs) || antesDeMs <= 0) return false;
  const primeiro = await aredis.zrange(
    chaveIndiceGlobal(tenantId),
    0,
    antesDeMs - 1,
    { byScore: true, limit: { offset: 0, count: 1 } },
  );
  return primeiro.length > 0;
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
  eventos: EventoAnaliticoLeitura[],
  clientesComHistoricoAnterior: ReadonlySet<string> = new Set()
): MetricasAnaliticas {
  const validos = eventos.filter((ev) => ev.statusAnalitico === "entregue");

  if (validos.length === 0) {
    return {
      pedidosValidos: 0,
      pedidosSemClienteIdentificado: 0,
      pedidosComClienteIdentificado: 0,
      receitaElegivelClientesIdentificadosCents: 0,
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
        painel: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
        app: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
        whatsapp: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
        salao: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
        desconhecido: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
      },
    };
  }

  const validosComCliente = validos.filter((ev): ev is EventoAnaliticoLeitura & { clienteId: string } => Boolean(ev.clienteId));
  const receitaPorCliente = new Map<string, number>();
  const pedidosPorCliente = new Map<string, number>();

  for (const ev of validosComCliente) {
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
    painel: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
    app: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
    whatsapp: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
    salao: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
    desconhecido: { pedidos: 0, receitaCents: 0, pedidoIds: [] },
  };

  for (const ev of validos) {
    const data = new Date(ev.criadoEmMs).toISOString().slice(0, 10);
    const dia = porDia.get(data) ?? { pedidos: 0, receitaCents: 0, clientes: new Set<string>() };
    dia.pedidos += 1;
    dia.receitaCents += ev.valorElegivelCents;
    if (ev.clienteId) dia.clientes.add(ev.clienteId);
    porDia.set(data, dia);

    porCanal[ev.canal].pedidos += 1;
    porCanal[ev.canal].receitaCents += ev.valorElegivelCents;
    if (ev.canal === "painel") porCanal.painel.pedidoIds.push(ev.pedidoId);
  }

  const serieDiaria = [...porDia.entries()]
    .sort(([dataA], [dataB]) => dataA.localeCompare(dataB))
    .map(([data, dia]) => ({ data, pedidos: dia.pedidos, receitaCents: dia.receitaCents, clientesUnicos: dia.clientes.size }));

  return {
    pedidosValidos: validos.length,
    pedidosSemClienteIdentificado: validos.length - validosComCliente.length,
    pedidosComClienteIdentificado: validosComCliente.length,
    receitaElegivelClientesIdentificadosCents: [...receitaPorCliente.values()].reduce((s, valor) => s + valor, 0),
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
    pedidosMediosPorCliente: receitaPorCliente.size > 0 ? Number((validosComCliente.length / receitaPorCliente.size).toFixed(2)) : 0,
    receitaMediaPorClienteCents: receitaPorCliente.size > 0
      ? Math.round([...receitaPorCliente.values()].reduce((s, valor) => s + valor, 0) / receitaPorCliente.size)
      : 0,
    serieDiaria,
    porCanal,
  };
}
