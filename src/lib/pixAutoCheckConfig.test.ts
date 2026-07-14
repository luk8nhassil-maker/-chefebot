import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("pixAutoCheckConfig — janela inicial configurável", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("sem env var definida, usa o novo padrão seguro de 10s", async () => {
    const mod = await import("./pixAutoCheckConfig");
    expect(mod.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS).toBe(10_000);
  });

  test("PIX_AUTO_CHECK_INITIAL_INTERVAL_MS=20000 permite rollback simples para 20s", async () => {
    vi.stubEnv("PIX_AUTO_CHECK_INITIAL_INTERVAL_MS", "20000");
    const mod = await import("./pixAutoCheckConfig");
    expect(mod.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS).toBe(20_000);
  });

  test("NEXT_PUBLIC_PIX_AUTO_CHECK_INITIAL_INTERVAL_MS tem prioridade (chega ao bundle do cliente)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PIX_AUTO_CHECK_INITIAL_INTERVAL_MS", "15000");
    vi.stubEnv("PIX_AUTO_CHECK_INITIAL_INTERVAL_MS", "20000");
    const mod = await import("./pixAutoCheckConfig");
    expect(mod.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS).toBe(15_000);
  });

  test("configuração inválida (não numérica) cai para o valor historicamente validado (20s), não para um número arbitrário", async () => {
    vi.stubEnv("PIX_AUTO_CHECK_INITIAL_INTERVAL_MS", "abacate");
    const mod = await import("./pixAutoCheckConfig");
    expect(mod.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS).toBe(mod.PIX_AUTO_CHECK_FALLBACK_INITIAL_INTERVAL_MS);
    expect(mod.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS).toBe(20_000);
  });

  test("configuração abaixo do piso mínimo (ex.: 0 ou negativa) também cai para o fallback seguro", async () => {
    vi.stubEnv("PIX_AUTO_CHECK_INITIAL_INTERVAL_MS", "0");
    const mod = await import("./pixAutoCheckConfig");
    expect(mod.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS).toBe(20_000);
  });

  test("string vazia é tratada como ausente — usa o padrão de 10s, não o fallback", async () => {
    vi.stubEnv("PIX_AUTO_CHECK_INITIAL_INTERVAL_MS", "");
    const mod = await import("./pixAutoCheckConfig");
    expect(mod.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS).toBe(10_000);
  });
});

describe("calcularIntervaloPorIdade — cadência adaptativa por janela", () => {
  test("0 a 2 minutos: usa o intervalo inicial (10s por padrão)", async () => {
    const { calcularIntervaloPorIdade, PIX_AUTO_CHECK_INITIAL_INTERVAL_MS } = await import("./pixAutoCheckConfig");
    expect(calcularIntervaloPorIdade(0)).toBe(PIX_AUTO_CHECK_INITIAL_INTERVAL_MS);
    expect(calcularIntervaloPorIdade(60_000)).toBe(PIX_AUTO_CHECK_INITIAL_INTERVAL_MS);
    expect(calcularIntervaloPorIdade(119_999)).toBe(PIX_AUTO_CHECK_INITIAL_INTERVAL_MS);
  });

  test("2 a 5 minutos: usa 20s", async () => {
    const { calcularIntervaloPorIdade } = await import("./pixAutoCheckConfig");
    expect(calcularIntervaloPorIdade(120_000)).toBe(20_000);
    expect(calcularIntervaloPorIdade(4 * 60_000)).toBe(20_000);
    expect(calcularIntervaloPorIdade(299_999)).toBe(20_000);
  });

  test("acima de 5 minutos: usa 30s", async () => {
    const { calcularIntervaloPorIdade } = await import("./pixAutoCheckConfig");
    expect(calcularIntervaloPorIdade(300_000)).toBe(30_000);
    expect(calcularIntervaloPorIdade(60 * 60_000)).toBe(30_000);
  });

  test("idade inválida (negativa/NaN) é tratada como zero — nunca gera intervalo negativo", async () => {
    const { calcularIntervaloPorIdade, PIX_AUTO_CHECK_INITIAL_INTERVAL_MS } = await import("./pixAutoCheckConfig");
    expect(calcularIntervaloPorIdade(-500)).toBe(PIX_AUTO_CHECK_INITIAL_INTERVAL_MS);
    expect(calcularIntervaloPorIdade(NaN)).toBe(PIX_AUTO_CHECK_INITIAL_INTERVAL_MS);
  });
});

describe("aplicarJitter — pequeno o suficiente para não atrasar a primeira janela de forma relevante", () => {
  test("nunca reduz o intervalo (sempre >= base)", async () => {
    const { aplicarJitter } = await import("./pixAutoCheckConfig");
    for (let i = 0; i < 20; i++) {
      expect(aplicarJitter(10_000)).toBeGreaterThanOrEqual(10_000);
    }
  });

  test("nunca ultrapassa o teto configurado de jitter", async () => {
    const { aplicarJitter, PIX_AUTO_CHECK_JITTER_MAX_MS } = await import("./pixAutoCheckConfig");
    for (let i = 0; i < 20; i++) {
      expect(aplicarJitter(10_000)).toBeLessThan(10_000 + PIX_AUTO_CHECK_JITTER_MAX_MS);
    }
  });

  test("jitter máximo é pequeno o suficiente para não empurrar 10s para além de ~11s", async () => {
    const { PIX_AUTO_CHECK_JITTER_MAX_MS } = await import("./pixAutoCheckConfig");
    expect(PIX_AUTO_CHECK_JITTER_MAX_MS).toBeLessThanOrEqual(1500);
  });

  test("maxJitterMs=0 é determinístico (sem aleatoriedade)", async () => {
    const { aplicarJitter } = await import("./pixAutoCheckConfig");
    expect(aplicarJitter(10_000, 0)).toBe(10_000);
  });
});
