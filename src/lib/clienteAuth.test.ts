import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  },
}));

import { gerarOtp, verificarOtp, podeReenviarOtp, criarTokenCliente, verificarTokenCliente } from "./clienteAuth";

beforeEach(() => {
  store.clear();
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

describe("sessao de cliente (JWT)", () => {
  test("cria e verifica token valido", async () => {
    const token = await criarTokenCliente({ clienteId: "cli_123", telefone: "11999998888" });
    const payload = await verificarTokenCliente(token);
    expect(payload).toEqual({ clienteId: "cli_123", telefone: "11999998888" });
  });

  test("token invalido/adulterado retorna null", async () => {
    expect(await verificarTokenCliente("token-invalido")).toBeNull();
  });
});
