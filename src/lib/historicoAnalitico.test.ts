import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PedidoSnapshotOficial } from "./pedidoSnapshot";

// ── In-memory Redis mock with sorted set support ──────────────────────────────

const {
  store,
  sortedSets,
  redisMock,
  derivarClienteIdMock,
} = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  // sortedSets: key -> Array<{ score: number; member: string }>
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();

  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      const deleted = store.delete(key);
      return deleted ? 1 : 0;
    }),
    zadd: vi.fn(
      async (
        key: string,
        opts: { score: number; member: string } | Array<{ score: number; member: string }>
      ) => {
        const entries = Array.isArray(opts) ? opts : [opts];
        const ss = sortedSets.get(key) ?? [];
        let added = 0;
        for (const entry of entries) {
          const idx = ss.findIndex((e) => e.member === entry.member);
          if (idx === -1) {
            ss.push({ ...entry });
            added++;
          } else {
            ss[idx].score = entry.score; // update score
          }
        }
        ss.sort((a, b) => a.score - b.score);
        sortedSets.set(key, ss);
        return added;
      }
    ),
    zrange: vi.fn(
      async (
        key: string,
        min: number | string,
        max: number | string,
        opts?: { byScore?: boolean; rev?: boolean; limit?: { offset: number; count: number } }
      ) => {
        const ss = sortedSets.get(key) ?? [];
        let result: Array<{ score: number; member: string }>;

        if (opts?.byScore) {
          const lo = typeof min === "number" ? min : -Infinity;
          const hi = typeof max === "number" ? max : Infinity;
          result = ss.filter((e) => e.score >= lo && e.score <= hi);
        } else {
          const start = typeof min === "number" ? min : 0;
          const end = typeof max === "number" ? max : ss.length - 1;
          result = ss.slice(start, end + 1);
        }

        if (opts?.rev) result = [...result].reverse();

        if (opts?.limit) {
          result = result.slice(opts.limit.offset, opts.limit.offset + opts.limit.count);
        }

        return result.map((e) => e.member);
      }
    ),
  };

  // Mock produz ID opaco sem incluir os dígitos do telefone, para que testes
  // de PII possam checar que o telefone bruto nunca aparece no armazenamento.
  const derivarClienteIdMock = vi.fn((telefone?: string): string | undefined => {
    if (!telefone) return undefined;
    const digits = telefone.replace(/\D/g, "");
    if (digits.length < 10) return undefined;
    // Soma dos char codes — determinística, única por número e sem expor dígitos
    const hash = digits.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return `cid_${hash}`;
  });

  return { store, sortedSets, redisMock, derivarClienteIdMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./fidelidade", () => ({ derivarClienteIdPorTelefone: derivarClienteIdMock }));
vi.mock("./estrelas", () => ({
  REGRA_ESTRELAS_V1: "estrelas-faixas-v1",
  calcularEstrelasPorValorElegivel: vi.fn((cents: number): number => {
    if (cents <= 0) return 0;
    if (cents < 4000) return 3;
    if (cents < 7000) return 5;
    if (cents < 10000) return 7;
    if (cents < 15000) return 9;
    return 12;
  }),
}));
vi.mock("./expedienteOperacional", () => ({
  chaveExpedienteOperacional: vi.fn(() => "2026-09-19"),
}));

import {
  calcularMetricas,
  calcularValorElegivelCentsParaHistorico,
  chaveEvento,
  chaveIndiceCliente,
  chaveIndiceGlobal,
  consultarEventosCliente,
  consultarEventosAntesDe,
  consultarEventosPorPeriodo,
  estornarEventoAnalitico,
  periodo30Dias,
  periodo60Dias,
  periodo7Dias,
  periodo90Dias,
  registrarEventoEntregue,
  TENANT_PADRAO_ANALYTICS,
  type EventoAnalitico,
} from "./historicoAnalitico";

const AGORA = 1758290400000; // fixed timestamp for determinism
const TENANT = "t1";

function snapshotOficial(
  financeiro: Omit<PedidoSnapshotOficial, "entrega" | "pagamento" | "criadoEm">
): PedidoSnapshotOficial {
  return {
    ...financeiro,
    entrega: { tipo: "delivery" },
    pagamento: "Pix",
    criadoEm: new Date(AGORA).toISOString(),
  };
}

const pedidoBase = {
  id: "ped_001",
  telefone: "5511987654321",
  tenantId: TENANT,
  total: 80,
  taxaEntrega: 10,
} as const;

beforeEach(() => {
  store.clear();
  sortedSets.clear();
  vi.clearAllMocks();
});

// ── calcularValorElegivelCentsParaHistorico ───────────────────────────────────

describe("calcularValorElegivelCentsParaHistorico", () => {
  test("total - taxaEntrega (legado)", () => {
    expect(calcularValorElegivelCentsParaHistorico({ id: "x", total: 80, taxaEntrega: 10 })).toBe(7000);
  });

  test("zero quando total === taxa", () => {
    expect(calcularValorElegivelCentsParaHistorico({ id: "x", total: 10, taxaEntrega: 10 })).toBe(0);
  });

  test("snapshot prevalece sobre total legado", () => {
    const pedido = {
      id: "x",
      total: 999,
      taxaEntrega: 999,
      snapshotOficial: snapshotOficial({
        subtotalCents: 6000,
        descontoFidelidadeCents: 0,
        taxaEntregaCents: 1000,
        totalCents: 7000,
        itens: [],
      }),
    };
    expect(calcularValorElegivelCentsParaHistorico(pedido)).toBe(6000);
  });

  test("snapshot: desconto fidelidade é subtraído", () => {
    const pedido = {
      id: "x",
      snapshotOficial: snapshotOficial({
        subtotalCents: 10000,
        descontoFidelidadeCents: 2000,
        taxaEntregaCents: 1000,
        totalCents: 9000,
        itens: [],
      }),
    };
    expect(calcularValorElegivelCentsParaHistorico(pedido)).toBe(8000);
  });

  test("zero quando desconto iguala subtotal", () => {
    const pedido = {
      id: "x",
      snapshotOficial: snapshotOficial({
        subtotalCents: 5000,
        descontoFidelidadeCents: 5000,
        taxaEntregaCents: 1000,
        totalCents: 1000,
        itens: [],
      }),
    };
    expect(calcularValorElegivelCentsParaHistorico(pedido)).toBe(0);
  });
});

// ── registrarEventoEntregue ───────────────────────────────────────────────────

describe("registrarEventoEntregue", () => {
  test("pedido válido: grava evento e ambos índices", async () => {
    await registrarEventoEntregue(pedidoBase, AGORA);

    const evento = store.get(chaveEvento(TENANT, pedidoBase.id)) as EventoAnalitico;
    expect(evento.pedidoId).toBe(pedidoBase.id);
    expect(evento.clienteId).toBe(`cid_681`);
    expect(evento.tenantId).toBe(TENANT);
    expect(evento.valorElegivelCents).toBe(7000);
    expect(evento.estrelasGeradas).toBe(7);
    expect(evento.statusAnalitico).toBe("entregue");
    expect(evento.schemaVersao).toBe(1);
    expect(evento.regraVersao).toBe("estrelas-faixas-v1");

    // Both indexes contain the pedidoId
    const globalIdx = sortedSets.get(chaveIndiceGlobal(TENANT)) ?? [];
    expect(globalIdx.some((e) => e.member === pedidoBase.id)).toBe(true);

    const clienteIdx = sortedSets.get(chaveIndiceCliente(TENANT, `cid_681`)) ?? [];
    expect(clienteIdx.some((e) => e.member === pedidoBase.id)).toBe(true);
  });

  test("idempotente: segunda chamada não duplica nem sobrescreve", async () => {
    await registrarEventoEntregue(pedidoBase, AGORA);
    await registrarEventoEntregue(pedidoBase, AGORA + 60000); // different timestamp

    // SET should have been called (nx:true) twice, second should return null
    const setCalls = (redisMock.set as ReturnType<typeof vi.fn>).mock.calls;
    const nxCalls = setCalls.filter((args) => args[2]?.nx === true);
    expect(nxCalls.length).toBe(2); // called twice

    // But zadd should only have been called 2 times (first registration only)
    expect((redisMock.zadd as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  test("sem telefone: não grava nada", async () => {
    await registrarEventoEntregue({ id: "ped_002", tenantId: TENANT, total: 80 }, AGORA);
    expect(store.size).toBe(0);
    expect(sortedSets.size).toBe(0);
  });

  test("valor elegível zero: não grava nada", async () => {
    await registrarEventoEntregue(
      { id: "ped_003", telefone: "5511987654321", tenantId: TENANT, total: 10, taxaEntrega: 10 },
      AGORA
    );
    expect(store.size).toBe(0);
  });

  test("valor elegível negativo (taxa > total): não grava", async () => {
    await registrarEventoEntregue(
      { id: "ped_004", telefone: "5511987654321", tenantId: TENANT, total: 5, taxaEntrega: 10 },
      AGORA
    );
    expect(store.size).toBe(0);
  });

  test("tenant padrão quando não informado", async () => {
    await registrarEventoEntregue(
      { id: "ped_005", telefone: "5511987654321", total: 80, taxaEntrega: 10 },
      AGORA
    );
    expect(store.has(chaveEvento(TENANT_PADRAO_ANALYTICS, "ped_005"))).toBe(true);
  });

  test("pedido com snapshotOficial usa valor do snapshot", async () => {
    const pedidoComSnapshot = {
      id: "ped_snap",
      telefone: "5511987654321",
      tenantId: TENANT,
      total: 999,
      taxaEntrega: 999,
      snapshotOficial: snapshotOficial({
        subtotalCents: 14500,
        descontoFidelidadeCents: 0,
        taxaEntregaCents: 1000,
        totalCents: 15500,
        itens: [],
      }),
    };
    await registrarEventoEntregue(pedidoComSnapshot, AGORA);
    const evento = store.get(chaveEvento(TENANT, "ped_snap")) as EventoAnalitico;
    expect(evento.valorElegivelCents).toBe(14500);
    expect(evento.estrelasGeradas).toBe(9); // 14500 < 15000
  });

  test("canal whatsapp detectado por origem", async () => {
    await registrarEventoEntregue(
      { ...pedidoBase, id: "ped_wpp", origem: "whatsapp-bot" },
      AGORA
    );
    const evento = store.get(chaveEvento(TENANT, "ped_wpp")) as EventoAnalitico;
    expect(evento.canal).toBe("whatsapp");
  });

  test("canal salao detectado por tipoEntrega dine_in", async () => {
    await registrarEventoEntregue(
      { ...pedidoBase, id: "ped_sal", tipoEntrega: "dine_in" },
      AGORA
    );
    const evento = store.get(chaveEvento(TENANT, "ped_sal")) as EventoAnalitico;
    expect(evento.canal).toBe("salao");
  });

  test("canal app detectado por snapshotOficial presente", async () => {
    await registrarEventoEntregue(
      {
        ...pedidoBase,
        id: "ped_app",
        snapshotOficial: snapshotOficial({
          subtotalCents: 7000,
          descontoFidelidadeCents: 0,
          taxaEntregaCents: 1000,
          totalCents: 8000,
          itens: [],
        }),
      },
      AGORA
    );
    const evento = store.get(chaveEvento(TENANT, "ped_app")) as EventoAnalitico;
    expect(evento.canal).toBe("app");
  });

  test("tenant isolation: dois tenants não se misturam", async () => {
    await registrarEventoEntregue(
      { ...pedidoBase, id: "shared_id", tenantId: "tenant_A" },
      AGORA
    );
    await registrarEventoEntregue(
      { ...pedidoBase, id: "shared_id", tenantId: "tenant_B" },
      AGORA
    );
    expect(store.has(chaveEvento("tenant_A", "shared_id"))).toBe(true);
    expect(store.has(chaveEvento("tenant_B", "shared_id"))).toBe(true);
    expect(store.size).toBe(2);
  });

  test("dois clientes diferentes no mesmo tenant não se misturam", async () => {
    await registrarEventoEntregue({ id: "ped_c1", telefone: "5511100000001", tenantId: TENANT, total: 50 }, AGORA);
    await registrarEventoEntregue({ id: "ped_c2", telefone: "5511100000002", tenantId: TENANT, total: 60 }, AGORA);

    const c1Idx = sortedSets.get(chaveIndiceCliente(TENANT, "cid_638")) ?? [];
    const c2Idx = sortedSets.get(chaveIndiceCliente(TENANT, "cid_639")) ?? [];
    expect(c1Idx.map((e) => e.member)).toEqual(["ped_c1"]);
    expect(c2Idx.map((e) => e.member)).toEqual(["ped_c2"]);
  });

  test("mesmo cliente vários pedidos ficam no índice do cliente", async () => {
    await registrarEventoEntregue({ ...pedidoBase, id: "p1" }, AGORA);
    await registrarEventoEntregue({ ...pedidoBase, id: "p2" }, AGORA + 1000);
    await registrarEventoEntregue({ ...pedidoBase, id: "p3" }, AGORA + 2000);

    const clienteIdx = sortedSets.get(chaveIndiceCliente(TENANT, `cid_681`)) ?? [];
    expect(clienteIdx.length).toBe(3);
  });

  test("não armazena nome, endereço, telefone bruto (sem PII)", async () => {
    await registrarEventoEntregue(pedidoBase, AGORA);
    const evento = store.get(chaveEvento(TENANT, pedidoBase.id)) as EventoAnalitico;
    const json = JSON.stringify(evento);
    expect(json).not.toContain("5511987654321");
    expect(json).not.toContain("telefone");
    expect(json).not.toContain("endereco");
    expect(json).not.toContain("nome");
  });
});

// ── estornarEventoAnalitico ───────────────────────────────────────────────────

describe("estornarEventoAnalitico", () => {
  test("marca evento existente como estornado", async () => {
    await registrarEventoEntregue(pedidoBase, AGORA);

    await estornarEventoAnalitico(pedidoBase.id, TENANT, AGORA + 5000);

    const evento = store.get(chaveEvento(TENANT, pedidoBase.id)) as EventoAnalitico;
    expect(evento.statusAnalitico).toBe("estornado");
    expect(evento.estornadoEmMs).toBe(AGORA + 5000);
  });

  test("no-op quando pedidoId não existe (nunca entregue)", async () => {
    await estornarEventoAnalitico("ped_inexistente", TENANT, AGORA);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  test("idempotente: segunda reversão não muda estornadoEmMs", async () => {
    await registrarEventoEntregue(pedidoBase, AGORA);
    await estornarEventoAnalitico(pedidoBase.id, TENANT, AGORA + 1000);
    await estornarEventoAnalitico(pedidoBase.id, TENANT, AGORA + 9999);

    const evento = store.get(chaveEvento(TENANT, pedidoBase.id)) as EventoAnalitico;
    expect(evento.estornadoEmMs).toBe(AGORA + 1000); // first reversal preserved
  });

  test("usa TENANT_PADRAO_ANALYTICS quando tenantId omitido", async () => {
    await registrarEventoEntregue(
      { id: "ped_tp", telefone: "5511987654321", total: 80, taxaEntrega: 10 },
      AGORA
    );
    await estornarEventoAnalitico("ped_tp", undefined, AGORA + 1000);
    const evento = store.get(chaveEvento(TENANT_PADRAO_ANALYTICS, "ped_tp")) as EventoAnalitico;
    expect(evento.statusAnalitico).toBe("estornado");
  });
});

// ── consultarEventosPorPeriodo ────────────────────────────────────────────────

describe("consultarEventosPorPeriodo", () => {
  test("consulta o histórico anterior ao início do período", async () => {
    await registrarEventoEntregue({ ...pedidoBase, id: "p_old" }, AGORA - 1000);
    await registrarEventoEntregue({ ...pedidoBase, id: "p_current" }, AGORA + 1000);
    const resultado = await consultarEventosAntesDe(TENANT, AGORA);
    expect(resultado.some((ev) => ev.pedidoId === "p_old")).toBe(true);
    expect(resultado.some((ev) => ev.pedidoId === "p_current")).toBe(false);
  });

  test("retorna eventos dentro do período", async () => {
    await registrarEventoEntregue({ ...pedidoBase, id: "p_inside" }, AGORA + 1000);
    const resultado = await consultarEventosPorPeriodo(TENANT, AGORA, AGORA + 5000);
    expect(resultado.some((ev) => ev.pedidoId === "p_inside")).toBe(true);
  });

  test("exclui eventos fora do período", async () => {
    await registrarEventoEntregue({ ...pedidoBase, id: "p_before" }, AGORA - 1);
    await registrarEventoEntregue({ ...pedidoBase, id: "p_after" }, AGORA + 10000);
    const resultado = await consultarEventosPorPeriodo(TENANT, AGORA, AGORA + 5000);
    expect(resultado.find((ev) => ev.pedidoId === "p_before")).toBeUndefined();
    expect(resultado.find((ev) => ev.pedidoId === "p_after")).toBeUndefined();
  });

  test("retorna array vazio quando não há eventos", async () => {
    const resultado = await consultarEventosPorPeriodo(TENANT, AGORA, AGORA + 5000);
    expect(resultado).toEqual([]);
  });

  test("inicioMs > fimMs retorna array vazio sem chamar Redis", async () => {
    const resultado = await consultarEventosPorPeriodo(TENANT, AGORA + 1000, AGORA);
    expect(resultado).toEqual([]);
    expect(redisMock.zrange).not.toHaveBeenCalled();
  });

  test("inclui estornados (o caller decide filtrar)", async () => {
    await registrarEventoEntregue({ ...pedidoBase, id: "p_est" }, AGORA + 500);
    await estornarEventoAnalitico("p_est", TENANT, AGORA + 600);
    const resultado = await consultarEventosPorPeriodo(TENANT, AGORA, AGORA + 5000);
    expect(resultado.some((ev) => ev.pedidoId === "p_est" && ev.statusAnalitico === "estornado")).toBe(true);
  });
});

// ── consultarEventosCliente ───────────────────────────────────────────────────

describe("consultarEventosCliente", () => {
  test("retorna só os eventos do cliente solicitado", async () => {
    await registrarEventoEntregue({ id: "p_a", telefone: "5511100000001", tenantId: TENANT, total: 50 }, AGORA);
    await registrarEventoEntregue({ id: "p_b", telefone: "5511100000002", tenantId: TENANT, total: 60 }, AGORA + 100);

    const resultA = await consultarEventosCliente(TENANT, "cid_638", AGORA - 1, AGORA + 1000);
    expect(resultA.length).toBe(1);
    expect(resultA[0].pedidoId).toBe("p_a");

    const resultB = await consultarEventosCliente(TENANT, "cid_639", AGORA - 1, AGORA + 1000);
    expect(resultB.length).toBe(1);
    expect(resultB[0].pedidoId).toBe("p_b");
  });

  test("retorna vazio para cliente sem histórico", async () => {
    const resultado = await consultarEventosCliente(TENANT, "cid_inexistente", AGORA, AGORA + 5000);
    expect(resultado).toEqual([]);
  });
});

// ── Paginação >1000 eventos ───────────────────────────────────────────────────

describe("paginação — mais de 1000 eventos", () => {
  const TOTAL = 1250; // maior que PAGINA_ZRANGE=500 e que o antigo cap=1000

  test("consultarEventosPorPeriodo retorna todos os " + TOTAL + " eventos sem truncamento", async () => {
    // Insere TOTAL pedidos diretamente no mock (sem passar por registrarEventoEntregue
    // para não sofrer limitação de performance — queremos testar a leitura)
    const indice: Array<{ score: number; member: string }> = [];
    for (let i = 0; i < TOTAL; i++) {
      const id = `bulk_${i}`;
      const ts = AGORA + i * 100;
      indice.push({ score: ts, member: id });
      store.set(chaveEvento(TENANT, id), {
        pedidoId: id,
        clienteId: "cid_bulk",
        tenantId: TENANT,
        criadoEmMs: ts,
        expedienteId: "2026-09-19",
        valorElegivelCents: 5000,
        statusAnalitico: "entregue",
        canal: "desconhecido",
        estrelasGeradas: 3,
        schemaVersao: 1,
        regraVersao: "estrelas-faixas-v1",
      });
    }
    sortedSets.set(chaveIndiceGlobal(TENANT), indice);

    const resultado = await consultarEventosPorPeriodo(TENANT, AGORA - 1, AGORA + TOTAL * 100 + 1);
    expect(resultado.length).toBe(TOTAL);
  });

  test("calcularMetricas sobre " + TOTAL + " eventos produz resultado correto", async () => {
    const eventos = Array.from({ length: TOTAL }, (_, i) => ({
      pedidoId: `m_${i}`,
      clienteId: `cid_${i % 100}`, // 100 clientes únicos, cada um com TOTAL/100 pedidos
      tenantId: TENANT,
      criadoEmMs: AGORA + i,
      expedienteId: "2026-09-19",
      valorElegivelCents: 5000,
      statusAnalitico: "entregue" as const,
      canal: "whatsapp" as const,
      estrelasGeradas: 3,
      schemaVersao: 1 as const,
      regraVersao: "estrelas-faixas-v1",
    }));
    const m = calcularMetricas(eventos);
    expect(m.pedidosValidos).toBe(TOTAL);
    expect(m.clientesUnicos).toBe(100);
    expect(m.receitaElegivelCents).toBe(TOTAL * 5000);
    // todos os 100 clientes têm TOTAL/100 >= 2 pedidos → recorrência = 100%
    expect(m.percentualReceitaRecorrentes).toBe(100);
  });
});

// ── Helpers de período ────────────────────────────────────────────────────────

describe("helpers de período", () => {
  const AGORA_TESTE = 1758290400000;
  const DIA = 24 * 60 * 60 * 1000;

  test("periodo7Dias", () => {
    const p = periodo7Dias(AGORA_TESTE);
    expect(p.fimMs).toBe(AGORA_TESTE);
    expect(p.fimMs - p.inicioMs).toBe(7 * DIA);
  });

  test("periodo30Dias", () => {
    const p = periodo30Dias(AGORA_TESTE);
    expect(p.fimMs - p.inicioMs).toBe(30 * DIA);
  });

  test("periodo60Dias", () => {
    const p = periodo60Dias(AGORA_TESTE);
    expect(p.fimMs - p.inicioMs).toBe(60 * DIA);
  });

  test("periodo90Dias", () => {
    const p = periodo90Dias(AGORA_TESTE);
    expect(p.fimMs - p.inicioMs).toBe(90 * DIA);
  });
});

// ── calcularMetricas ──────────────────────────────────────────────────────────

const makeEvento = (overrides: Partial<EventoAnalitico> = {}): EventoAnalitico => ({
  pedidoId: "p1",
  clienteId: "cid_A",
  tenantId: TENANT,
  criadoEmMs: AGORA,
  expedienteId: "2026-09-19",
  valorElegivelCents: 7000,
  statusAnalitico: "entregue",
  canal: "app",
  estrelasGeradas: 7,
  schemaVersao: 1,
  regraVersao: "estrelas-faixas-v1",
  ...overrides,
});

describe("calcularMetricas", () => {
  test("lista vazia retorna zeros", () => {
    const m = calcularMetricas([]);
    expect(m.pedidosValidos).toBe(0);
    expect(m.clientesUnicos).toBe(0);
    expect(m.receitaElegivelCents).toBe(0);
  });

  test("pedido único válido", () => {
    const m = calcularMetricas([makeEvento()]);
    expect(m.pedidosValidos).toBe(1);
    expect(m.clientesUnicos).toBe(1);
    expect(m.ticketMedioCents).toBe(7000);
    expect(m.ticketMedianoCents).toBe(7000);
    expect(m.receitaElegivelCents).toBe(7000);
    expect(m.estrelasDistribuidas).toBe(7);
    expect(m.cohortePorPedidos).toEqual({ "1": 1 });
    expect(m.percentualReceitaRecorrentes).toBe(0);
    expect(m.clientesNovos).toBe(1);
    expect(m.clientesRecorrentes).toBe(0);
    expect(m.percentualClientesRecorrentes).toBe(0);
  });

  test("classifica clientes novos e recorrentes pelo histórico anterior", () => {
    const eventos = [
      makeEvento({ pedidoId: "p1", clienteId: "cid_A" }),
      makeEvento({ pedidoId: "p2", clienteId: "cid_B" }),
      makeEvento({ pedidoId: "p3", clienteId: "cid_B" }),
    ];
    const m = calcularMetricas(eventos, new Set(["cid_A"]));
    expect(m.clientesUnicos).toBe(2);
    expect(m.clientesNovos).toBe(1);
    expect(m.clientesRecorrentes).toBe(1);
    expect(m.percentualClientesRecorrentes).toBe(50);
  });

  test("estornados são excluídos de todas as métricas", () => {
    const eventos = [
      makeEvento({ pedidoId: "p1", statusAnalitico: "entregue", valorElegivelCents: 7000 }),
      makeEvento({ pedidoId: "p2", statusAnalitico: "estornado", valorElegivelCents: 9000 }),
    ];
    const m = calcularMetricas(eventos);
    expect(m.pedidosValidos).toBe(1);
    expect(m.receitaElegivelCents).toBe(7000);
  });

  test("ticket médio e mediano corretos com vários pedidos", () => {
    const eventos = [
      makeEvento({ pedidoId: "p1", valorElegivelCents: 4000 }),
      makeEvento({ pedidoId: "p2", valorElegivelCents: 8000 }),
      makeEvento({ pedidoId: "p3", valorElegivelCents: 12000 }),
    ];
    const m = calcularMetricas(eventos);
    expect(m.ticketMedioCents).toBe(8000);
    expect(m.ticketMedianoCents).toBe(8000);
  });

  test("ticket mediano par: média dos dois centrais (piso)", () => {
    const eventos = [
      makeEvento({ pedidoId: "p1", valorElegivelCents: 5000 }),
      makeEvento({ pedidoId: "p2", valorElegivelCents: 7000 }),
      makeEvento({ pedidoId: "p3", valorElegivelCents: 9000 }),
      makeEvento({ pedidoId: "p4", valorElegivelCents: 11000 }),
    ];
    const m = calcularMetricas(eventos);
    expect(m.ticketMedianoCents).toBe(8000); // floor((7000+9000)/2)
  });

  test("clientes únicos: mesmo cliente em vários pedidos conta como 1", () => {
    const eventos = [
      makeEvento({ pedidoId: "p1", clienteId: "cid_A" }),
      makeEvento({ pedidoId: "p2", clienteId: "cid_A" }),
      makeEvento({ pedidoId: "p3", clienteId: "cid_B" }),
    ];
    expect(calcularMetricas(eventos).clientesUnicos).toBe(2);
  });

  test("separa segunda compra dentro do período e cria série diária/canais", () => {
    const eventos = [
      makeEvento({ pedidoId: "p1", clienteId: "cid_A", criadoEmMs: AGORA, canal: "whatsapp", valorElegivelCents: 5000 }),
      makeEvento({ pedidoId: "p2", clienteId: "cid_A", criadoEmMs: AGORA + 86400000, canal: "whatsapp", valorElegivelCents: 6000 }),
      makeEvento({ pedidoId: "p3", clienteId: "cid_B", criadoEmMs: AGORA + 86400000, canal: "salao", valorElegivelCents: 7000 }),
    ];
    const m = calcularMetricas(eventos);
    expect(m.clientesComSegundoPedido).toBe(1);
    expect(m.percentualClientesComSegundoPedido).toBe(50);
    expect(m.pedidosMediosPorCliente).toBe(1.5);
    expect(m.receitaMediaPorClienteCents).toBe(9000);
    expect(m.serieDiaria).toHaveLength(2);
    expect(m.serieDiaria[1]).toMatchObject({ pedidos: 2, receitaCents: 13000, clientesUnicos: 2 });
    expect(m.porCanal.whatsapp).toEqual({ pedidos: 2, receitaCents: 11000 });
    expect(m.porCanal.salao).toEqual({ pedidos: 1, receitaCents: 7000 });
  });

  test("cohorte por pedidos: categoriza 1/2/3/4/5+", () => {
    const eventos = [
      // cid_A: 1 pedido
      makeEvento({ pedidoId: "p1", clienteId: "cid_A" }),
      // cid_B: 2 pedidos
      makeEvento({ pedidoId: "p2", clienteId: "cid_B" }),
      makeEvento({ pedidoId: "p3", clienteId: "cid_B" }),
      // cid_C: 5 pedidos
      makeEvento({ pedidoId: "p4", clienteId: "cid_C" }),
      makeEvento({ pedidoId: "p5", clienteId: "cid_C" }),
      makeEvento({ pedidoId: "p6", clienteId: "cid_C" }),
      makeEvento({ pedidoId: "p7", clienteId: "cid_C" }),
      makeEvento({ pedidoId: "p8", clienteId: "cid_C" }),
    ];
    const m = calcularMetricas(eventos);
    expect(m.cohortePorPedidos["1"]).toBe(1);
    expect(m.cohortePorPedidos["2"]).toBe(1);
    expect(m.cohortePorPedidos["5+"]).toBe(1);
  });

  test("percentual receita recorrentes: clientes com 2+ pedidos", () => {
    const eventos = [
      // único: R$70 (não recorrente)
      makeEvento({ pedidoId: "p1", clienteId: "cid_A", valorElegivelCents: 7000 }),
      // recorrente: 2 × R$50 = R$100
      makeEvento({ pedidoId: "p2", clienteId: "cid_B", valorElegivelCents: 5000 }),
      makeEvento({ pedidoId: "p3", clienteId: "cid_B", valorElegivelCents: 5000 }),
    ];
    const m = calcularMetricas(eventos);
    // recorrentes = 10000, total = 17000 → ~59%
    expect(m.percentualReceitaRecorrentes).toBe(59);
  });

  test("estrelas distribuídas somam todos os entregues", () => {
    const eventos = [
      makeEvento({ pedidoId: "p1", estrelasGeradas: 5 }),
      makeEvento({ pedidoId: "p2", estrelasGeradas: 7 }),
      makeEvento({ pedidoId: "p3", estrelasGeradas: 12, statusAnalitico: "estornado" }),
    ];
    expect(calcularMetricas(eventos).estrelasDistribuidas).toBe(12);
  });

  test("só estornados: retorna zeros sem divisão por zero", () => {
    const m = calcularMetricas([makeEvento({ statusAnalitico: "estornado" })]);
    expect(m.pedidosValidos).toBe(0);
    expect(m.ticketMedioCents).toBe(0);
    expect(m.percentualReceitaRecorrentes).toBe(0);
    expect(m.clientesNovos).toBe(0);
    expect(m.clientesRecorrentes).toBe(0);
  });
});

// ── Cenários de cancelamento/reversão ────────────────────────────────────────

describe("cancelamento e reversão — cenários completos", () => {
  test("pedido entregue depois cancelado: métrica corrigi receita", async () => {
    await registrarEventoEntregue({ ...pedidoBase, id: "ped_rev" }, AGORA);
    await estornarEventoAnalitico("ped_rev", TENANT, AGORA + 1000);

    const eventos = await consultarEventosPorPeriodo(TENANT, AGORA - 1, AGORA + 5000);
    const m = calcularMetricas(eventos);
    expect(m.pedidosValidos).toBe(0);
    expect(m.receitaElegivelCents).toBe(0);
  });

  test("pedido cancelado antes de entrega: nada é gravado", async () => {
    // cancel-before-delivery: no registrarEventoEntregue called = no analytics
    expect(store.size).toBe(0);
    const eventos = await consultarEventosPorPeriodo(TENANT, AGORA - 1, AGORA + 5000);
    expect(eventos).toEqual([]);
  });
});

// ── Presente gratuito (valorElegivelCents = 0) ────────────────────────────────

describe("presente gratuito e pedido operacional", () => {
  test("pedido com 100% desconto fidelidade não é gravado", async () => {
    const pedidoGratuito = {
      id: "ped_free",
      telefone: "5511987654321",
      tenantId: TENANT,
      snapshotOficial: snapshotOficial({
        subtotalCents: 7000,
        descontoFidelidadeCents: 7000,
        taxaEntregaCents: 1000,
        totalCents: 1000,
        itens: [],
      }),
    };
    await registrarEventoEntregue(pedidoGratuito, AGORA);
    expect(store.size).toBe(0);
  });
});

// ── Concorrência (retry / webhook repetido) ───────────────────────────────────

describe("concorrência e idempotência", () => {
  test("dois workers gravando o mesmo pedido: apenas um grava", async () => {
    // Simulate concurrent calls
    await Promise.all([
      registrarEventoEntregue(pedidoBase, AGORA),
      registrarEventoEntregue(pedidoBase, AGORA),
    ]);
    // Only one event record, one entry per index
    const globalIdx = sortedSets.get(chaveIndiceGlobal(TENANT)) ?? [];
    const matches = globalIdx.filter((e) => e.member === pedidoBase.id);
    expect(matches.length).toBe(1);
  });

  test("retry de estorno: idempotente", async () => {
    await registrarEventoEntregue(pedidoBase, AGORA);
    await Promise.all([
      estornarEventoAnalitico(pedidoBase.id, TENANT, AGORA + 100),
      estornarEventoAnalitico(pedidoBase.id, TENANT, AGORA + 200),
    ]);
    const evento = store.get(chaveEvento(TENANT, pedidoBase.id)) as EventoAnalitico;
    expect(evento.statusAnalitico).toBe("estornado");
  });
});
