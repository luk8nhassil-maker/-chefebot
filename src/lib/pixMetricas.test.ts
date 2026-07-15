import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  calcularLatenciasConfirmacaoPix,
  contarConfirmacoesPorOrigemPix,
  contarPendentesPorJanelaPix,
  incrementarContadorPix,
  obterContadoresPix,
  mascararIdentificador,
  registrarEventoObservabilidadePix,
  obterUltimoEventoPix,
  obterUltimaConfirmacaoAutomaticaPix,
  chaveBucketHoraPix,
  chaveBucketDiaPix,
} from "./pixMetricas";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

function pixMP(overrides: Record<string, unknown> = {}) {
  return { provider: "mercadopago", status: "pendente", ...overrides };
}

describe("calcularLatenciasConfirmacaoPix", () => {
  test("sem amostras (nenhum confirmado com os dois carimbos), retorna null em tudo", () => {
    const r = calcularLatenciasConfirmacaoPix([{ id: "1", pix: pixMP() }]);
    expect(r).toEqual({ amostras: 0, mediaMs: null, p50Ms: null, p95Ms: null, p99Ms: null });
  });

  test("calcula latência a partir de criadoEm/confirmadoEm de Pix Mercado Pago confirmados", () => {
    const base = Date.parse("2026-01-01T10:00:00.000Z");
    const pedidos = [
      { id: "1", pix: pixMP({ status: "confirmado", criadoEm: new Date(base).toISOString(), confirmadoEm: new Date(base + 10_000).toISOString() }) },
      { id: "2", pix: pixMP({ status: "confirmado", criadoEm: new Date(base).toISOString(), confirmadoEm: new Date(base + 20_000).toISOString() }) },
    ];
    const r = calcularLatenciasConfirmacaoPix(pedidos);
    expect(r.amostras).toBe(2);
    expect(r.mediaMs).toBe(15_000);
    expect(r.p50Ms).toBeGreaterThan(0);
  });

  test("ignora Pix manual (provider !== mercadopago)", () => {
    const r = calcularLatenciasConfirmacaoPix([
      { id: "1", pix: { provider: "manual", status: "confirmado", criadoEm: "2026-01-01T00:00:00.000Z", confirmadoEm: "2026-01-01T00:01:00.000Z" } },
    ]);
    expect(r.amostras).toBe(0);
  });

  test("ignora pedidos ainda não confirmados", () => {
    const r = calcularLatenciasConfirmacaoPix([{ id: "1", pix: pixMP({ criadoEm: "2026-01-01T00:00:00.000Z" }) }]);
    expect(r.amostras).toBe(0);
  });

  test("ignora quando falta criadoEm ou confirmadoEm (pedidos legados)", () => {
    const r = calcularLatenciasConfirmacaoPix([{ id: "1", pix: pixMP({ status: "confirmado", confirmadoEm: "2026-01-01T00:01:00.000Z" }) }]);
    expect(r.amostras).toBe(0);
  });
});

describe("contarConfirmacoesPorOrigemPix", () => {
  test("agrupa por confirmadoPor, só Pix Mercado Pago confirmados", () => {
    const r = contarConfirmacoesPorOrigemPix([
      { id: "1", pix: pixMP({ status: "confirmado", confirmadoPor: "webhook" }) },
      { id: "2", pix: pixMP({ status: "confirmado", confirmadoPor: "conciliador_mercadopago" }) },
      { id: "3", pix: pixMP({ status: "confirmado", confirmadoPor: "webhook" }) },
      { id: "4", pix: pixMP({ status: "pendente" }) },
      { id: "5", pix: { provider: "manual", status: "confirmado", confirmadoPor: "comprovante" } },
    ]);
    expect(r).toEqual({ webhook: 2, conciliador_mercadopago: 1 });
  });
});

describe("contarPendentesPorJanelaPix", () => {
  test("classifica pendentes por idade (1, 2 e 5 minutos)", () => {
    const agora = Date.parse("2026-01-01T10:10:00.000Z");
    const pedidos = [
      { id: "1", pix: pixMP({ criadoEm: new Date(agora - 30_000).toISOString() }) }, // 30s: nenhuma janela
      { id: "2", pix: pixMP({ criadoEm: new Date(agora - 90_000).toISOString() }) }, // 1min30s: só >1min
      { id: "3", pix: pixMP({ criadoEm: new Date(agora - 150_000).toISOString() }) }, // 2min30s: >1 e >2min
      { id: "4", pix: pixMP({ criadoEm: new Date(agora - 400_000).toISOString() }) }, // >5min: todas
    ];
    const r = contarPendentesPorJanelaPix(pedidos, agora);
    expect(r).toEqual({ acimaDe1Min: 3, acimaDe2Min: 2, acimaDe5Min: 1 });
  });

  test("não conta pedidos já confirmados", () => {
    const agora = Date.now();
    const r = contarPendentesPorJanelaPix(
      [{ id: "1", pixConfirmado: true, pix: pixMP({ criadoEm: new Date(agora - 400_000).toISOString(), status: "confirmado" }) }],
      agora
    );
    expect(r).toEqual({ acimaDe1Min: 0, acimaDe2Min: 0, acimaDe5Min: 0 });
  });
});

describe("contadores cumulativos (Redis, best-effort)", () => {
  test("incrementa e lê de volta", async () => {
    await incrementarContadorPix("timeout");
    await incrementarContadorPix("timeout");
    await incrementarContadorPix("rate_limited", 3);

    const contadores = await obterContadoresPix();
    expect(contadores.timeout).toBe(2);
    expect(contadores.rate_limited).toBe(3);
    expect(contadores.locks_recuperados).toBe(0);
  });

  test("falha do Redis nunca lança (best-effort)", async () => {
    redisMock.set.mockRejectedValueOnce(new Error("down"));
    await expect(incrementarContadorPix("timeout")).resolves.toBeUndefined();
  });
});

describe("registrarEventoObservabilidadePix — observabilidade adicional (Nível 6.10), fallback sem pipeline", () => {
  test("grava bucket de hora e de dia e o último evento (sem pedidoId nenhum)", async () => {
    const agora = Date.parse("2026-03-15T10:30:00.000Z");
    await registrarEventoObservabilidadePix("sentinela_confirmou", { agora });

    const chH = chaveBucketHoraPix("sentinela_confirmou", agora);
    const chD = chaveBucketDiaPix("sentinela_confirmou", agora);
    expect(await redisMock.get(chH)).toBe(1);
    expect(await redisMock.get(chD)).toBe(1);

    const ultimo = await obterUltimoEventoPix();
    expect(ultimo).toEqual({ tipo: "sentinela_confirmou", ts: agora });
    // "último evento" nunca inclui pedidoId, nem mascarado.
    expect(JSON.stringify(ultimo)).not.toMatch(/pedido/i);
  });

  test("incrementa o bucket em chamadas repetidas na mesma hora/dia", async () => {
    const agora = Date.parse("2026-03-15T10:30:00.000Z");
    await registrarEventoObservabilidadePix("sentinela_bloqueio_lock", { agora });
    await registrarEventoObservabilidadePix("sentinela_bloqueio_lock", { agora: agora + 1000 });
    expect(await redisMock.get(chaveBucketHoraPix("sentinela_bloqueio_lock", agora))).toBe(2);
    expect(await redisMock.get(chaveBucketDiaPix("sentinela_bloqueio_lock", agora))).toBe(2);
  });

  test("só grava 'última confirmação automática' quando explicitamente pedido", async () => {
    const agora = Date.now();
    await registrarEventoObservabilidadePix("sentinela_bloqueio_cooldown", { agora });
    expect(await obterUltimaConfirmacaoAutomaticaPix()).toBeNull();

    await registrarEventoObservabilidadePix("sentinela_confirmou", { agora, ultimaConfirmacaoAutomatica: true });
    expect(await obterUltimaConfirmacaoAutomaticaPix()).toEqual({ tipo: "sentinela_confirmou", ts: agora });
  });

  test("falha do Redis nunca lança — telemetria é best-effort", async () => {
    redisMock.set.mockRejectedValueOnce(new Error("redis indisponível"));
    await expect(registrarEventoObservabilidadePix("sentinela_bloqueio_rate_limit")).resolves.toBeUndefined();
  });

  test("falha ao gravar não impede chamadas seguintes de continuarem funcionando", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("timeout"));
    await registrarEventoObservabilidadePix("sentinela_confirmou", { agora: Date.now() });
    // Chamada seguinte, sem a falha simulada, funciona normalmente.
    const agora2 = Date.now();
    await registrarEventoObservabilidadePix("sentinela_confirmou", { agora: agora2 });
    expect(await obterUltimoEventoPix()).toEqual({ tipo: "sentinela_confirmou", ts: agora2 });
  });

  test("nunca escreve nas chaves dos contadores cumulativos existentes (pix:metricas:contador:*)", async () => {
    await incrementarContadorPix("sentinela_consulta_evitada");
    const antes = await obterContadoresPix();
    await registrarEventoObservabilidadePix("sentinela_bloqueio_cooldown");
    const depois = await obterContadoresPix();
    expect(depois).toEqual(antes);
  });
});

describe("registrarEventoObservabilidadePix — usa pipeline quando o cliente Redis suporta (produção)", () => {
  test("grava tudo em uma única chamada de pipeline.exec()", async () => {
    const chamadas: string[] = [];
    const pipelineMock = {
      incr: vi.fn(function (this: unknown, key: string) { chamadas.push(`incr:${key}`); return this; }),
      expire: vi.fn(function (this: unknown, key: string) { chamadas.push(`expire:${key}`); return this; }),
      set: vi.fn(function (this: unknown, key: string) { chamadas.push(`set:${key}`); return this; }),
      exec: vi.fn(async () => []),
    };
    const clientComPipeline = { ...redisMock, pipeline: vi.fn(() => pipelineMock) };

    vi.resetModules();
    vi.doMock("./redis", () => ({ redis: clientComPipeline }));
    const mod = await import("./pixMetricas");
    await mod.registrarEventoObservabilidadePix("sentinela_confirmou", { agora: Date.now(), ultimaConfirmacaoAutomatica: true });

    expect(clientComPipeline.pipeline).toHaveBeenCalledTimes(1);
    expect(pipelineMock.exec).toHaveBeenCalledTimes(1);
    expect(chamadas.filter((c) => c.startsWith("incr:")).length).toBe(2);
    expect(chamadas.filter((c) => c.startsWith("set:")).length).toBe(2); // último evento + última confirmação automática
    vi.doUnmock("./redis");
  });
});

describe("registrarEventoObservabilidadePix — teto rígido de 100ms mesmo quando a operação Redis nunca resolve", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("./redis");
  });

  test("pipeline.exec() que nunca resolve não trava o helper — resolve em até 100ms (relógio falso)", async () => {
    vi.useFakeTimers();
    const pipelineMock = {
      incr: vi.fn(function (this: unknown) { return this; }),
      expire: vi.fn(function (this: unknown) { return this; }),
      set: vi.fn(function (this: unknown) { return this; }),
      exec: vi.fn(() => new Promise<unknown[]>(() => {})), // nunca resolve
    };
    const clienteComPipeline = { ...redisMock, pipeline: vi.fn(() => pipelineMock) };

    vi.resetModules();
    vi.doMock("./redis", () => ({ redis: clienteComPipeline }));
    const mod = await import("./pixMetricas");

    let resolvido = false;
    const chamada = mod.registrarEventoObservabilidadePix("sentinela_confirmou", { agora: Date.now() }).then(() => { resolvido = true; });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolvido).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await chamada;
    expect(resolvido).toBe(true);
  });

  test("fallback sem pipeline: redis.get() que nunca resolve não trava o helper — resolve em até 100ms", async () => {
    vi.useFakeTimers();
    const getOriginal = redisMock.get.getMockImplementation();
    redisMock.get.mockImplementation(() => new Promise(() => {})); // nunca resolve

    let resolvido = false;
    const chamada = registrarEventoObservabilidadePix("sentinela_bloqueio_lock", { agora: Date.now() }).then(() => { resolvido = true; });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolvido).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await chamada;
    expect(resolvido).toBe(true);

    redisMock.get.mockImplementation(getOriginal!);
  });

  test("fallback sem pipeline: redis.set() que nunca resolve não trava o helper — resolve em até 100ms", async () => {
    vi.useFakeTimers();
    const setOriginal = redisMock.set.getMockImplementation();
    redisMock.set.mockImplementation(() => new Promise(() => {})); // nunca resolve

    let resolvido = false;
    const chamada = registrarEventoObservabilidadePix("sentinela_bloqueio_rate_limit", { agora: Date.now() }).then(() => { resolvido = true; });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolvido).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await chamada;
    expect(resolvido).toBe(true);

    redisMock.set.mockImplementation(setOriginal!);
  });

  test("nunca gera rejeição não tratada quando a gravação trava e só rejeita depois que o timeout já venceu a corrida", async () => {
    const rejeicoesNaoTratadas: unknown[] = [];
    const handler = (reason: unknown) => rejeicoesNaoTratadas.push(reason);
    process.on("unhandledRejection", handler);

    let rejeitarDepois: ((e: Error) => void) | null = null;
    const getOriginal = redisMock.get.getMockImplementation();
    redisMock.get.mockImplementation(() => new Promise((_resolve, reject) => { rejeitarDepois = reject; }));

    try {
      const chamada = registrarEventoObservabilidadePix("sentinela_bloqueio_proxima_consulta", { agora: Date.now() });
      // Sem relógio falso aqui: espera o timeout real (curto, 100ms) vencer a corrida.
      await chamada;
      // Só agora, bem depois do helper já ter resolvido, a operação original rejeita.
      rejeitarDepois!(new Error("chegou tarde, depois do timeout"));
      await new Promise((r) => setTimeout(r, 10));
      expect(rejeicoesNaoTratadas).toEqual([]);
    } finally {
      process.off("unhandledRejection", handler);
      redisMock.get.mockImplementation(getOriginal!);
    }
  });
});

describe("mascararIdentificador — nunca loga identificador completo", () => {
  test("mantém só um sufixo curto", () => {
    expect(mascararIdentificador("1234567890123")).toBe("***0123");
  });

  test("valores curtos viram só ***", () => {
    expect(mascararIdentificador("12")).toBe("***");
    expect(mascararIdentificador(undefined)).toBe("—");
    expect(mascararIdentificador(null)).toBe("—");
  });
});
