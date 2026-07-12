import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();
const ttls = new Map<string, number>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { ex?: number }) => {
      store.set(key, value);
      if (opts?.ex) ttls.set(key, opts.ex);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      ttls.delete(key);
      return 1;
    }),
    expire: vi.fn(async (key: string, segundos: number) => {
      if (!store.has(key)) return 0;
      ttls.set(key, segundos);
      return 1;
    }),
  },
}));

import {
  gerarOtp,
  verificarOtp,
  podeReenviarOtp,
  criarTokenCliente,
  verificarTokenCliente,
  invalidarSessaoCliente,
  SESSAO_TTL_SEGUNDOS,
} from "./clienteAuth";

beforeEach(() => {
  store.clear();
  ttls.clear();
});

describe("OTP do cliente", () => {
  test("codigo gerado verifica com sucesso", async () => {
    const codigo = await gerarOtp("11999998888");
    expect(await verificarOtp("11999998888", codigo)).toBe(true);
  });

  test("codigo errado nao verifica", async () => {
    await gerarOtp("11999998888");
    expect(await verificarOtp("11999998888", "000000")).toBe(false);
  });

  test("codigo ja usado nao pode ser reutilizado", async () => {
    const codigo = await gerarOtp("11999998888");
    expect(await verificarOtp("11999998888", codigo)).toBe(true);
    expect(await verificarOtp("11999998888", codigo)).toBe(false);
  });

  test("cooldown bloqueia pedido imediato de novo codigo", async () => {
    await gerarOtp("11999998888");
    expect(await podeReenviarOtp("11999998888")).toBe(false);
  });
});

describe("sessao de cliente (Redis, expiracao deslizante de 15 dias)", () => {
  test("cria e verifica sessao valida", async () => {
    const token = await criarTokenCliente({ clienteId: "cli_123", telefone: "11999998888" });
    const payload = await verificarTokenCliente(token);
    expect(payload).toEqual({ clienteId: "cli_123", telefone: "11999998888" });
  });

  test("sessao inexistente/adulterada retorna null", async () => {
    expect(await verificarTokenCliente("sessao-invalida")).toBeNull();
  });

  test("sessao criada tem TTL de 15 dias no Redis", async () => {
    const token = await criarTokenCliente({ clienteId: "cli_123", telefone: "11999998888" });
    expect(ttls.get(`cliente:sessao:${token}`)).toBe(SESSAO_TTL_SEGUNDOS);
  });

  test("cada verificacao valida renova o TTL para mais 15 dias (expiracao deslizante)", async () => {
    const token = await criarTokenCliente({ clienteId: "cli_123", telefone: "11999998888" });
    ttls.set(`cliente:sessao:${token}`, 10); // simula sessao perto de expirar
    await verificarTokenCliente(token);
    expect(ttls.get(`cliente:sessao:${token}`)).toBe(SESSAO_TTL_SEGUNDOS);
  });

  test("logout (invalidarSessaoCliente) apaga a sessao do Redis — verificacao depois falha", async () => {
    const token = await criarTokenCliente({ clienteId: "cli_123", telefone: "11999998888" });
    await invalidarSessaoCliente(token);
    expect(await verificarTokenCliente(token)).toBeNull();
  });

  test("invalidarSessaoCliente com id vazio/nulo nao lanca erro", async () => {
    await expect(invalidarSessaoCliente(null)).resolves.toBeUndefined();
    await expect(invalidarSessaoCliente(undefined)).resolves.toBeUndefined();
  });
});
