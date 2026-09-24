import { beforeEach, describe, expect, test, vi } from "vitest";

const { redisGetMock, redisSetMock, keyMock } = vi.hoisted(() => ({
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  keyMock: vi.fn(),
}));

vi.mock("./redis", () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
  },
}));

vi.mock("./pesquisaPreferenciaContatosRedis", () => ({
  derivarResearchCustomerKey: keyMock,
}));

import {
  clienteTemOptOutPesquisa,
  registrarOptOutPesquisa,
} from "./pesquisaPreferenciaOptOutRedis";

beforeEach(() => {
  vi.clearAllMocks();
  keyMock.mockReturnValue("a".repeat(64));
  redisGetMock.mockResolvedValue(null);
  redisSetMock.mockResolvedValue("OK");
});

describe("pesquisaPreferenciaOptOutRedis", () => {
  test("grava opt-out durável sem telefone bruto na chave nem no valor", async () => {
    const ok = await registrarOptOutPesquisa({
      telefone: "5599999999999",
      registradoEmMs: 123456,
    });

    expect(ok).toBe(true);
    expect(redisSetMock).toHaveBeenCalledTimes(1);
    const [key, value, options] = redisSetMock.mock.calls[0];
    expect(key).toBe(`pesquisa:optout:v1:${"a".repeat(64)}`);
    expect(key).not.toContain("5599999999999");
    expect(JSON.stringify(value)).not.toContain("5599999999999");
    expect(value).toEqual({ optOut: true, registradoEmMs: 123456 });
    expect(options).toBeUndefined();
  });

  test("consulta opt-out sem escrever", async () => {
    redisGetMock.mockResolvedValue({ optOut: true, registradoEmMs: 123456 });

    await expect(clienteTemOptOutPesquisa("5599999999999")).resolves.toBe(true);
    expect(redisSetMock).not.toHaveBeenCalled();
  });

  test("identidade inválida não cria registro", async () => {
    keyMock.mockReturnValue(null);

    await expect(
      registrarOptOutPesquisa({ telefone: "123", registradoEmMs: 123456 })
    ).resolves.toBe(false);
    await expect(clienteTemOptOutPesquisa("123")).resolves.toBe(false);
    expect(redisSetMock).not.toHaveBeenCalled();
    expect(redisGetMock).not.toHaveBeenCalled();
  });
});
