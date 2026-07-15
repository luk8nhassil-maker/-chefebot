import { beforeEach, describe, expect, test, vi } from "vitest";

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
  calcularResumoPixDashboard,
  calcularHistogramaLatenciaPix,
  obterSeriesTemporaisPix,
  montarPainelPixDashboard,
} from "./pixDashboardMetricas";
import { chaveBucketDiaPix, chaveBucketHoraPix } from "./pixMetricas";

function pixMP(overrides: Record<string, unknown> = {}) {
  return { provider: "mercadopago", status: "pendente", ...overrides };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("calcularResumoPixDashboard — somente leitura do array pedidos", () => {
  test("conta encontrados/confirmados/pendentes/expirados só para Mercado Pago", () => {
    const agora = Date.parse("2026-03-15T12:00:00.000Z");
    const pedidos = [
      { id: "1", pixConfirmado: true, pix: pixMP({ status: "confirmado", criadoEm: new Date(agora - 60_000).toISOString() }) },
      { id: "2", pix: pixMP({ criadoEm: new Date(agora - 60_000).toISOString() }) }, // pendente recente
      { id: "3", pix: pixMP({ criadoEm: new Date(agora - 50 * 60_000).toISOString() }) }, // >45min: expirado
      { id: "4", pix: { provider: "manual", status: "pendente" } }, // Pix manual: nunca entra
    ];
    const r = calcularResumoPixDashboard(pedidos, agora);
    expect(r.encontrados).toBe(3);
    expect(r.confirmados).toBe(1);
    expect(r.pendentes).toBe(1);
    expect(r.expirados).toBe(1);
    expect(r.taxaConfirmacao).toBeCloseTo(1 / 3, 3);
  });

  test("sem nenhum Pix Mercado Pago, taxaConfirmacao é null (nunca divisão por zero)", () => {
    const r = calcularResumoPixDashboard([{ id: "1", pix: { provider: "manual", status: "pendente" } }]);
    expect(r.encontrados).toBe(0);
    expect(r.taxaConfirmacao).toBeNull();
  });

  test("pedido cancelado não conta como expirado mesmo se antigo", () => {
    const agora = Date.now();
    const r = calcularResumoPixDashboard(
      [{ id: "1", status: "cancelado", pix: pixMP({ criadoEm: new Date(agora - 60 * 60_000).toISOString() }) }],
      agora
    );
    expect(r.expirados).toBe(0);
    expect(r.pendentes).toBe(0);
  });
});

describe("calcularHistogramaLatenciaPix — 5 faixas", () => {
  const base = Date.parse("2026-01-01T10:00:00.000Z");
  function confirmado(msDepois: number) {
    return { pix: pixMP({ status: "confirmado", criadoEm: new Date(base).toISOString(), confirmadoEm: new Date(base + msDepois).toISOString() }) };
  }

  test("classifica corretamente em até5s, 5-10s, 10-30s, 30s-2min e acima de 2min", () => {
    const pedidos = [
      confirmado(3_000), // até5s
      confirmado(5_000), // até5s (limite inclusivo)
      confirmado(8_000), // 5-10s
      confirmado(20_000), // 10-30s
      confirmado(90_000), // 30s-2min
      confirmado(150_000), // acima de 2min
    ];
    const h = calcularHistogramaLatenciaPix(pedidos);
    expect(h.faixas).toEqual({ ate5s: 2, de5a10s: 1, de10a30s: 1, de30sa2min: 1, acimaDe2min: 1 });
    expect(h.amostras).toBe(6);
  });

  test("continua reaproveitando calcularLatenciasConfirmacaoPix para média/p50/p95 (sem duplicar lógica)", () => {
    const pedidos = [confirmado(10_000), confirmado(20_000)];
    const h = calcularHistogramaLatenciaPix(pedidos);
    expect(h.mediaMs).toBe(15_000);
  });

  test("faixas somam exatamente as amostras válidas (nunca conta um pedido em duas faixas)", () => {
    const pedidos = [confirmado(1_000), confirmado(59_000), confirmado(200_000)];
    const h = calcularHistogramaLatenciaPix(pedidos);
    const somaFaixas = Object.values(h.faixas).reduce((a, b) => a + b, 0);
    expect(somaFaixas).toBe(h.amostras);
  });
});

describe("obterSeriesTemporaisPix — leitura em lote dos buckets (sem pipeline no mock: fallback sequencial)", () => {
  test("retorna 24 pontos horários e 30 diários por métrica, com valores vindos do Redis", async () => {
    const agora = Date.parse("2026-03-15T12:00:00.000Z");
    await redisMock.set(chaveBucketHoraPix("sentinela_confirmou", agora), 3);
    await redisMock.set(chaveBucketDiaPix("sentinela_confirmou", agora), 5);

    const series = await obterSeriesTemporaisPix(agora);
    const confirmou = series.find((s) => s.nome === "sentinela_confirmou");
    expect(confirmou?.horas).toHaveLength(24);
    expect(confirmou?.dias).toHaveLength(30);
    expect(confirmou?.horas.at(-1)?.valor).toBe(3);
    expect(confirmou?.dias.at(-1)?.valor).toBe(5);
    expect(confirmou?.temDados).toBe(true);
  });

  test("métrica sem nenhum bucket gravado tem temDados=false", async () => {
    const series = await obterSeriesTemporaisPix(Date.now());
    for (const s of series) expect(s.temDados).toBe(false);
  });

  test("nunca lança mesmo se toda leitura individual falhar — degrada para série zerada, nunca quebra o eixo do tempo", async () => {
    const implementacaoOriginal = redisMock.get.getMockImplementation();
    redisMock.get.mockRejectedValue(new Error("redis fora do ar"));
    try {
      const series = await obterSeriesTemporaisPix(Date.now());
      expect(series.every((s) => s.horas.every((h) => h.valor === 0) && s.dias.every((d) => d.valor === 0) && !s.temDados)).toBe(true);
    } finally {
      redisMock.get.mockImplementation(implementacaoOriginal!);
    }
  });

  test("nunca lança mesmo com um 'agora' inválido (NaN)", async () => {
    await expect(obterSeriesTemporaisPix(Number.NaN)).resolves.toBeDefined();
  });
});

describe("montarPainelPixDashboard — orquestração somente leitura", () => {
  test("monta o painel completo sem lançar, mesmo com Redis vazio", async () => {
    const painel = await montarPainelPixDashboard();
    expect(painel.resumo.encontrados).toBe(0);
    expect(painel.metricasTemporaisDesde).toMatch(/não foram reconstruídos/i);
    expect(painel.series).toEqual([]); // nenhum bucket ainda: nenhuma série aparece
  });

  test("só inclui na resposta métricas de série que realmente têm buckets (nunca aparece com dados 100% zerados)", async () => {
    const agora = Date.now();
    await redisMock.set(chaveBucketDiaPix("sentinela_bloqueio_lock", agora), 2);
    const painel = await montarPainelPixDashboard(agora);
    const nomes = painel.series.map((s) => s.nome);
    expect(nomes).toContain("sentinela_bloqueio_lock");
    expect(nomes).not.toContain("sentinela_confirmou");
  });

  test("payload nunca contém pedidoId, telefone, paymentId, QR code, copia-e-cola ou chave Pix", async () => {
    store.set("pedidos", [
      {
        id: "pedido-secreto-123",
        telefone: "11999998888",
        pixConfirmado: true,
        pix: {
          provider: "mercadopago",
          status: "confirmado",
          confirmadoPor: "webhook",
          criadoEm: new Date(Date.now() - 10_000).toISOString(),
          confirmadoEm: new Date().toISOString(),
          providerPaymentId: "MP-999999",
          qrCode: "00020126...copia-e-cola-fake",
          qrCodeBase64: "base64fake",
        },
      },
    ]);
    const painel = await montarPainelPixDashboard();
    const texto = JSON.stringify(painel);
    expect(texto).not.toContain("pedido-secreto-123");
    expect(texto).not.toContain("11999998888");
    expect(texto).not.toContain("MP-999999");
    expect(texto).not.toContain("copia-e-cola-fake");
    expect(texto).not.toContain("base64fake");
  });
});
