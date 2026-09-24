import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, customerKeyMock, optOutMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
      set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    },
    customerKeyMock: vi.fn(),
    optOutMock: vi.fn(),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./pesquisaPreferenciaContatosRedis", () => ({
  derivarResearchCustomerKey: customerKeyMock,
}));
vi.mock("./pesquisaPreferenciaOptOutRedis", () => ({
  registrarOptOutPesquisa: optOutMock,
}));

import {
  clienteTemPesquisaPendente,
  consumirRespostaPesquisaPendente,
  registrarPesquisaPendente,
} from "./pesquisaPreferenciaRespostaRedis";

const PHONE = "5599999999999";
const CUSTOMER_KEY = "a".repeat(64);
const PENDING_KEY = `pesquisa:pendente:v1:${CUSTOMER_KEY}`;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  customerKeyMock.mockReturnValue(CUSTOMER_KEY);
  optOutMock.mockResolvedValue(true);
});

describe("registrarPesquisaPendente", () => {
  test("arma contexto por 1h sem telefone bruto no namespace ou valor", async () => {
    const ok = await registrarPesquisaPendente({
      telefone: PHONE,
      exposureId: "exp-1",
      momentId: "M1",
      questionId: "research-m1-main",
      questionVersion: 1,
      sentAtMs: 1000,
    });

    expect(ok).toBe(true);
    const [key, value, opts] = redisMock.set.mock.calls[0];
    expect(key).toBe(PENDING_KEY);
    expect(key).not.toContain(PHONE);
    expect(JSON.stringify(value)).not.toContain(PHONE);
    expect(opts).toEqual({ ex: 3600 });
  });

  test("identidade inválida não arma contexto", async () => {
    customerKeyMock.mockReturnValue(null);

    await expect(
      registrarPesquisaPendente({
        telefone: "123",
        exposureId: "exp-1",
        momentId: "M1",
        questionId: "research-m1-main",
        questionVersion: 1,
      })
    ).resolves.toBe(false);
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

describe("clienteTemPesquisaPendente", () => {
  test("retorna true somente quando existe contexto pendente", async () => {
    expect(await clienteTemPesquisaPendente(PHONE)).toBe(false);
    store.set(PENDING_KEY, {
      exposureId: "exp-1",
      momentId: "M1",
      questionId: "research-m1-main",
      questionVersion: 1,
      sentAtMs: 1000,
    });
    expect(await clienteTemPesquisaPendente(PHONE)).toBe(true);
  });
});

describe("consumirRespostaPesquisaPendente", () => {
  test("sem pendência não interfere no fluxo normal", async () => {
    await expect(
      consumirRespostaPesquisaPendente({
        telefone: PHONE,
        resposta: "quero uma pizza",
      })
    ).resolves.toEqual({ consumida: false });
  });

  test("resposta livre é persistida sem telefone e remove a pendência", async () => {
    store.set(PENDING_KEY, {
      exposureId: "exp-1",
      momentId: "M1",
      questionId: "research-m1-main",
      questionVersion: 1,
      sentAtMs: 1000,
    });

    const resultado = await consumirRespostaPesquisaPendente({
      telefone: PHONE,
      resposta: "Foi a qualidade da pizza.",
      agoraMs: 2000,
    });

    expect(resultado).toEqual({
      consumida: true,
      tipo: "resposta",
      exposureId: "exp-1",
    });
    expect(store.has(PENDING_KEY)).toBe(false);

    const respostaCall = redisMock.set.mock.calls.find(([key]) =>
      String(key).startsWith("pesquisa:respostas:v1:")
    );
    expect(respostaCall).toBeTruthy();
    const [key, value, opts] = respostaCall!;
    expect(key).not.toContain(PHONE);
    expect(JSON.stringify(value)).not.toContain(PHONE);
    expect(value).toMatchObject({
      exposureId: "exp-1",
      momentId: "M1",
      questionId: "research-m1-main",
      questionVersion: 1,
      rawAnswer: "Foi a qualidade da pizza.",
      createdAtMs: 2000,
    });
    expect(opts).toEqual({ ex: 90 * 24 * 60 * 60, nx: true });
  });

  test("SAIR exato registra opt-out, remove pendência e não grava resposta", async () => {
    store.set(PENDING_KEY, {
      exposureId: "exp-2",
      momentId: "M2",
      questionId: "research-m2-main",
      questionVersion: 1,
      sentAtMs: 1000,
    });

    const resultado = await consumirRespostaPesquisaPendente({
      telefone: PHONE,
      resposta: "  SAÍR ",
      agoraMs: 3000,
    });

    expect(resultado).toEqual({
      consumida: true,
      tipo: "opt_out",
      exposureId: "exp-2",
    });
    expect(optOutMock).toHaveBeenCalledWith({
      telefone: PHONE,
      registradoEmMs: 3000,
    });
    expect(store.has(PENDING_KEY)).toBe(false);
    expect(
      redisMock.set.mock.calls.some(([key]) =>
        String(key).startsWith("pesquisa:respostas:v1:")
      )
    ).toBe(false);
  });

  test("retry da mesma exposição não sobrescreve a primeira resposta", async () => {
    store.set(PENDING_KEY, {
      exposureId: "exp-1",
      momentId: "M1",
      questionId: "research-m1-main",
      questionVersion: 1,
      sentAtMs: 1000,
    });

    await consumirRespostaPesquisaPendente({
      telefone: PHONE,
      resposta: "Primeira resposta",
      agoraMs: 2000,
    });

    const respostaKey = [...store.keys()].find((key) =>
      key.startsWith("pesquisa:respostas:v1:")
    )!;
    const primeira = store.get(respostaKey);

    store.set(PENDING_KEY, {
      exposureId: "exp-1",
      momentId: "M1",
      questionId: "research-m1-main",
      questionVersion: 1,
      sentAtMs: 1000,
    });

    await consumirRespostaPesquisaPendente({
      telefone: PHONE,
      resposta: "Segunda tentativa",
      agoraMs: 4000,
    });

    expect(store.get(respostaKey)).toEqual(primeira);
    expect(store.has(PENDING_KEY)).toBe(false);
  });

  test("falha ao registrar opt-out não deixa resposta cair no fluxo normal", async () => {
    store.set(PENDING_KEY, {
      exposureId: "exp-2",
      momentId: "M2",
      questionId: "research-m2-main",
      questionVersion: 1,
      sentAtMs: 1000,
    });
    optOutMock.mockResolvedValue(false);

    await expect(
      consumirRespostaPesquisaPendente({
        telefone: PHONE,
        resposta: "sair",
        agoraMs: 3000,
      })
    ).rejects.toThrow("research_optout_not_persisted");

    expect(store.has(PENDING_KEY)).toBe(true);
  });
});
