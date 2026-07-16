import { vi, describe, it, expect, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
  extrairMessageIdEnvio,
  marcarEcoPainel,
  ehEcoPainel,
  validarMessageId,
  CONVERSA_ECO_PAINEL_TTL_SEGUNDOS,
} from "./conversaEcoPainel";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("validarMessageId", () => {
  it("aceita string não vazia e aplica trim", () => {
    expect(validarMessageId("ABC123")).toBe("ABC123");
    expect(validarMessageId("  ABC123  ")).toBe("ABC123");
  });

  it("rejeita string vazia ou só espaços", () => {
    expect(validarMessageId("")).toBeUndefined();
    expect(validarMessageId("   ")).toBeUndefined();
  });

  it("rejeita tipos não-string (número, objeto, null, undefined)", () => {
    expect(validarMessageId(123)).toBeUndefined();
    expect(validarMessageId({})).toBeUndefined();
    expect(validarMessageId({ toString: () => "ABC" })).toBeUndefined();
    expect(validarMessageId(null)).toBeUndefined();
    expect(validarMessageId(undefined)).toBeUndefined();
    expect(validarMessageId([])).toBeUndefined();
    expect(validarMessageId(true)).toBeUndefined();
  });
});

describe("extrairMessageIdEnvio", () => {
  it("extrai de key.id no topo do payload", () => {
    expect(extrairMessageIdEnvio({ key: { id: "ABC123" } })).toBe("ABC123");
  });

  it("extrai de data.key.id quando aninhado", () => {
    expect(extrairMessageIdEnvio({ data: { key: { id: "XYZ789" } } })).toBe("XYZ789");
  });

  it("prefere key.id no topo quando ambos existem", () => {
    expect(extrairMessageIdEnvio({ key: { id: "TOPO" }, data: { key: { id: "ANINHADO" } } })).toBe("TOPO");
  });

  it("retorna undefined para payload sem id reconhecível", () => {
    expect(extrairMessageIdEnvio({})).toBeUndefined();
    expect(extrairMessageIdEnvio(null)).toBeUndefined();
    expect(extrairMessageIdEnvio(undefined)).toBeUndefined();
    expect(extrairMessageIdEnvio({ key: {} })).toBeUndefined();
  });

  it("ignora id com tipo inesperado (não-string)", () => {
    expect(extrairMessageIdEnvio({ key: { id: 123 } })).toBeUndefined();
    expect(extrairMessageIdEnvio({ key: { id: null } })).toBeUndefined();
    expect(extrairMessageIdEnvio({ key: { id: "" } })).toBeUndefined();
    expect(extrairMessageIdEnvio({ key: { id: "   " } })).toBeUndefined();
  });

  it("nunca lança para payload de formato totalmente inesperado", () => {
    expect(extrairMessageIdEnvio("string solta")).toBeUndefined();
    expect(extrairMessageIdEnvio(42)).toBeUndefined();
    expect(extrairMessageIdEnvio([1, 2, 3])).toBeUndefined();
  });
});

describe("marcarEcoPainel / ehEcoPainel", () => {
  it("marca a chave com TTL entre 5 e 10 minutos e valor true, sem dados pessoais", async () => {
    await marcarEcoPainel("MSG-1");
    const call = redisMock.set.mock.calls.find(([k]: [string]) => k === "conversa:echo-painel:MSG-1");
    expect(call).toBeDefined();
    expect(call[1]).toBe(true);
    expect(call[2]).toEqual({ ex: CONVERSA_ECO_PAINEL_TTL_SEGUNDOS });
    expect(CONVERSA_ECO_PAINEL_TTL_SEGUNDOS).toBeGreaterThanOrEqual(300);
    expect(CONVERSA_ECO_PAINEL_TTL_SEGUNDOS).toBeLessThanOrEqual(600);
  });

  it("ehEcoPainel retorna true quando a chave existe, sem apagá-la", async () => {
    await marcarEcoPainel("MSG-2");
    const existia = await ehEcoPainel("MSG-2");
    expect(existia).toBe(true);
    expect(redisMock.del).not.toHaveBeenCalled();
    expect(store.has("conversa:echo-painel:MSG-2")).toBe(true);
  });

  it("consultas repetidas ao mesmo ID continuam retornando true até o TTL expirar (sem GET+DEL)", async () => {
    await marcarEcoPainel("MSG-REPETIDO");
    expect(await ehEcoPainel("MSG-REPETIDO")).toBe(true);
    expect(await ehEcoPainel("MSG-REPETIDO")).toBe(true);
    expect(await ehEcoPainel("MSG-REPETIDO")).toBe(true);
    expect(redisMock.del).not.toHaveBeenCalled();
    expect(store.has("conversa:echo-painel:MSG-REPETIDO")).toBe(true);
  });

  it("ehEcoPainel retorna false quando não existe", async () => {
    const existia = await ehEcoPainel("MSG-NAO-EXISTE");
    expect(existia).toBe(false);
  });

  it("não faz nada com messageId vazio", async () => {
    await marcarEcoPainel("");
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(await ehEcoPainel("")).toBe(false);
    expect(redisMock.get).not.toHaveBeenCalled();
  });
});
