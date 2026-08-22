import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { redisGetMock } = vi.hoisted(() => ({
  redisGetMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("./redis", () => ({ redis: { get: redisGetMock, set: vi.fn() } }));

import { encryptMercadoPagoToken, resolveActiveMercadoPagoAuth } from "./mercadoPagoIntegracao";

beforeEach(() => {
  redisGetMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("resolveActiveMercadoPagoAuth", () => {
  test("painel admin ativo com token salvo tem prioridade e nao exige PIX_PROVIDER", async () => {
    redisGetMock.mockResolvedValue({
      provider: "mercadopago",
      enabled: true,
      accessTokenEncrypted: encryptMercadoPagoToken("token-painel"),
      accessTokenLast4: "inel",
      payerEmailFallback: "loja@example.com",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const auth = await resolveActiveMercadoPagoAuth();

    expect(auth).toEqual({
      active: true,
      source: "admin",
      accessToken: "token-painel",
      payerEmailFallback: "loja@example.com",
    });
  });

  test("painel admin desativado e sem PIX_PROVIDER fica inativo", async () => {
    redisGetMock.mockResolvedValue({
      provider: "mercadopago",
      enabled: false,
      accessTokenEncrypted: encryptMercadoPagoToken("token-painel"),
      accessTokenLast4: "inel",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const auth = await resolveActiveMercadoPagoAuth();

    expect(auth).toEqual({ active: false, source: "none", accessToken: null });
  });

  test("sem config no painel e sem PIX_PROVIDER fica inativo", async () => {
    const auth = await resolveActiveMercadoPagoAuth();

    expect(auth).toEqual({ active: false, source: "none", accessToken: null });
  });

  test("PIX_PROVIDER=mercadopago continua funcionando como fallback legado quando painel nao esta ativo", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token-env");
    vi.stubEnv("MERCADOPAGO_PAYER_EMAIL_FALLBACK", "fallback@example.com");

    const auth = await resolveActiveMercadoPagoAuth();

    expect(auth).toEqual({
      active: true,
      source: "env",
      accessToken: "token-env",
      payerEmailFallback: "fallback@example.com",
    });
  });

  test("token da env usa email fallback salvo no painel quando env de email esta ausente", async () => {
    redisGetMock.mockResolvedValue({
      provider: "mercadopago",
      enabled: false,
      payerEmailFallback: "painel@example.com",
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token-env");

    const auth = await resolveActiveMercadoPagoAuth();

    expect(auth).toEqual({
      active: true,
      source: "env",
      accessToken: "token-env",
      payerEmailFallback: "painel@example.com",
    });
  });

  test("painel com token corrompido cai para PIX_PROVIDER/env em vez de quebrar", async () => {
    redisGetMock.mockResolvedValue({
      provider: "mercadopago",
      enabled: true,
      accessTokenEncrypted: "v1.invalido.invalido.invalido",
      accessTokenLast4: "alid",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token-env");

    const auth = await resolveActiveMercadoPagoAuth();

    expect(auth).toEqual({ active: true, source: "env", accessToken: "token-env" });
  });
});
