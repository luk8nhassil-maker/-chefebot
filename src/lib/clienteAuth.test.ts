import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

import {
  gerarOtp,
  verificarOtp,
  podeReenviarOtp,
  criarTokenCliente,
  verificarTokenCliente,
  criarSessaoCliente,
  resolverSessaoCliente,
  invalidarSessaoCliente,
  CLIENTE_COOKIE,
} from "./clienteAuth";
import { obterOuCriarCliente } from "./clientes";

function requestComCookie(token?: string) {
  const url = "http://localhost/api/cliente/perfil";
  const init = token ? { headers: { cookie: `${CLIENTE_COOKIE}=${token}` } } : undefined;
  return new NextRequest(url, init);
}

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

describe("sessao deslizante de 15 dias (Redis + JWT)", () => {
  test("criarSessaoCliente + resolverSessaoCliente: sessao recem-criada resolve e nao renova", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    const sessao = await resolverSessaoCliente(requestComCookie(token));

    expect(sessao).not.toBeNull();
    expect(sessao?.cliente.clienteId).toBe(cliente.clienteId);
    expect(sessao?.deveRenovar).toBe(false);
    expect(sessao?.novoToken).toBeUndefined();
  });

  test("JWT valido sem sessao criada (nunca logou por aqui, ou sessao ja expirou) retorna null", async () => {
    const token = await criarTokenCliente({ clienteId: "cli_11999998888", telefone: "11999998888" });
    expect(await resolverSessaoCliente(requestComCookie(token))).toBeNull();
  });

  test("cookie ausente retorna null", async () => {
    expect(await resolverSessaoCliente(requestComCookie())).toBeNull();
  });

  test("cliente removido do cadastro invalida a sessao mesmo com token/registro validos", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    store.delete(`cliente:${cliente.telefone}`);

    expect(await resolverSessaoCliente(requestComCookie(token))).toBeNull();
  });

  test("logout (invalidarSessaoCliente) invalida a sessao imediatamente, mesmo com o JWT ainda valido", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    expect(await resolverSessaoCliente(requestComCookie(token))).not.toBeNull();

    await invalidarSessaoCliente(cliente.clienteId);

    expect(await resolverSessaoCliente(requestComCookie(token))).toBeNull();
  });

  test("renova (Redis + novo JWT) quando o ultimo acesso foi ha mais de 1h", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    // Simula um ultimo acesso antigo (mais de 1h) sem esperar de verdade.
    const chaveSessao = `cliente:sessao:${cliente.clienteId}`;
    const registro = store.get(chaveSessao) as { criadoEm: string; ultimoAcessoEm: string };
    store.set(chaveSessao, { ...registro, ultimoAcessoEm: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });

    const sessao = await resolverSessaoCliente(requestComCookie(token));

    expect(sessao?.deveRenovar).toBe(true);
    expect(sessao?.novoToken).toBeDefined();
    // Não compara novoToken !== token: como o JWT é assinado deterministicamente
    // (HMAC) e os testes rodam rápido o bastante para cair no mesmo segundo de
    // `exp`, os dois tokens podem legitimamente ser idênticos — o que importa é
    // que o registro de sessão no Redis foi renovado (checado abaixo).

    // O registro no Redis tambem foi renovado (ultimoAcessoEm atualizado).
    const registroApos = store.get(chaveSessao) as { ultimoAcessoEm: string };
    expect(new Date(registroApos.ultimoAcessoEm).getTime()).toBeGreaterThan(new Date(registro.ultimoAcessoEm).getTime());
  });

  test("nao renova de novo dentro da mesma janela de 1h (evita reemitir cookie a cada poll)", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    const primeira = await resolverSessaoCliente(requestComCookie(token));
    const segunda = await resolverSessaoCliente(requestComCookie(token));

    expect(primeira?.deveRenovar).toBe(false);
    expect(segunda?.deveRenovar).toBe(false);
  });
});
