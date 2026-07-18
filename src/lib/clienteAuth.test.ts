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

import { redis } from "@/lib/redis";
import { gerarOtp, verificarOtp, podeReenviarOtp, criarTokenCliente, verificarTokenCliente, criarTicketSessao, consumirTicketSessao, criarSessaoOpaca, resolverSessaoOpaca, revogarSessaoOpaca, extrairBearer, lerSessaoCliente, criarSessaoPortatil, resolverSessaoPortatil, lerSessaoClienteDiagnosticada, CLIENTE_COOKIE } from "./clienteAuth";

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

describe("ticket de ativacao de sessao por navegacao", () => {
  const PAYLOAD = { clienteId: "cli_5599974000691", telefone: "5599974000691" };

  test("ticket criado consome uma unica vez e devolve o payload", async () => {
    const ticket = await criarTicketSessao(PAYLOAD);
    expect(ticket).toMatch(/^[a-f0-9]{32}$/);
    expect(await consumirTicketSessao(ticket)).toEqual(PAYLOAD);
    // uso unico: segundo consumo sempre falha (protecao contra replay)
    expect(await consumirTicketSessao(ticket)).toBeNull();
  });

  test("ticket com formato invalido ou inexistente retorna null sem consultar nada sensivel", async () => {
    expect(await consumirTicketSessao("abc")).toBeNull();
    expect(await consumirTicketSessao(null)).toBeNull();
    expect(await consumirTicketSessao("f".repeat(32))).toBeNull();
  });

  test("o ticket nao expoe o telefone", async () => {
    const ticket = await criarTicketSessao(PAYLOAD);
    expect(ticket).not.toContain(PAYLOAD.telefone.slice(-8));
  });
});

describe("sessao opaca (fallback Bearer)", () => {
  const PAYLOAD = { clienteId: "cli_5599974000691", telefone: "5599974000691" };

  test("token opaco resolve multiplas vezes e nunca embute o telefone", async () => {
    const token = await criarSessaoOpaca(PAYLOAD);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(token).not.toContain(PAYLOAD.telefone.slice(-8));
    expect(await resolverSessaoOpaca(token)).toEqual(PAYLOAD);
    expect(await resolverSessaoOpaca(token)).toEqual(PAYLOAD); // multi-uso (sessao, nao ticket)
  });

  test("revogar invalida a sessao opaca", async () => {
    const token = await criarSessaoOpaca(PAYLOAD);
    await revogarSessaoOpaca(token);
    expect(await resolverSessaoOpaca(token)).toBeNull();
  });

  test("token invalido/inexistente resolve para null", async () => {
    expect(await resolverSessaoOpaca("x")).toBeNull();
    expect(await resolverSessaoOpaca("a".repeat(32))).toBeNull();
  });

  test("extrairBearer aceita so o formato exato", () => {
    expect(extrairBearer(`Bearer ${"a".repeat(32)}`)).toBe("a".repeat(32));
    expect(extrairBearer("Bearer abc")).toBeNull();
    expect(extrairBearer(null)).toBeNull();
  });
});

describe("sessao portatil (JWE, sem leitura de Redis para validar)", () => {
  const PAYLOAD = { clienteId: "cli_5599974000691", telefone: "5599974000691" };

  test("token portatil nao expoe clienteId nem telefone em claro", async () => {
    const token = await criarSessaoPortatil(PAYLOAD);
    expect(token.split(".")).toHaveLength(5);
    expect(token).not.toContain(PAYLOAD.telefone);
    expect(token).not.toContain(PAYLOAD.clienteId);
    expect(Buffer.from(token, "base64").toString("utf-8")).not.toContain(PAYLOAD.telefone);
  });

  test("resolve corretamente SEM nenhuma leitura do redis mockado", async () => {
    const chamadasAntes = (redis.get as ReturnType<typeof vi.fn>).mock.calls.length;
    const token = await criarSessaoPortatil(PAYLOAD);
    const chamadasDepoisDeCriar = (redis.get as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(await resolverSessaoPortatil(token)).toEqual(PAYLOAD);
    // nem criar nem resolver a sessao portatil chamam redis.get
    expect((redis.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(chamadasDepoisDeCriar);
    expect(chamadasDepoisDeCriar).toBe(chamadasAntes);
  });

  test("token adulterado ou de formato antigo (opaco) resolve para null", async () => {
    expect(await resolverSessaoPortatil("token-invalido")).toBeNull();
    expect(await resolverSessaoPortatil("a".repeat(32))).toBeNull();
    const token = await criarSessaoPortatil(PAYLOAD);
    const adulterado = token.slice(0, -4) + "abcd";
    expect(await resolverSessaoPortatil(adulterado)).toBeNull();
  });
});

describe("lerSessaoCliente — cookie primeiro, Bearer como fallback", () => {
  const PAYLOAD = { clienteId: "cli_5599974000691", telefone: "5599974000691" };

  function reqFake(cookie?: string, auth?: string) {
    return {
      cookies: { get: (n: string) => (n === CLIENTE_COOKIE && cookie ? { value: cookie } : undefined) },
      headers: { get: (n: string) => (n.toLowerCase() === "authorization" ? auth ?? null : null) },
    };
  }

  test("cookie JWT valido autentica", async () => {
    const jwt = await criarTokenCliente(PAYLOAD);
    expect(await lerSessaoCliente(reqFake(jwt))).toEqual(PAYLOAD);
  });

  test("sem cookie, Bearer com sessao PORTATIL (JWE) valida autentica", async () => {
    const token = await criarSessaoPortatil(PAYLOAD);
    expect(await lerSessaoCliente(reqFake(undefined, `Bearer ${token}`))).toEqual(PAYLOAD);
  });

  test("sem cookie, Bearer com sessao opaca legada ainda autentica (compatibilidade)", async () => {
    const token = await criarSessaoOpaca(PAYLOAD);
    expect(await lerSessaoCliente(reqFake(undefined, `Bearer ${token}`))).toEqual(PAYLOAD);
  });

  test("cookie invalido + Bearer portatil valido: o Bearer vale (recuperacao)", async () => {
    const token = await criarSessaoPortatil(PAYLOAD);
    expect(await lerSessaoCliente(reqFake("jwt-adulterado", `Bearer ${token}`))).toEqual(PAYLOAD);
  });

  test("nada valido: null", async () => {
    expect(await lerSessaoCliente(reqFake())).toBeNull();
    expect(await lerSessaoCliente(reqFake(undefined, `Bearer ${"b".repeat(32)}`))).toBeNull();
  });
});

describe("lerSessaoClienteDiagnosticada — mesma resolução, com motivo categórico sem PII", () => {
  const PAYLOAD = { clienteId: "cli_5599974000691", telefone: "5599974000691" };

  function reqFake(cookie?: string, auth?: string) {
    return {
      cookies: { get: (n: string) => (n === CLIENTE_COOKIE && cookie ? { value: cookie } : undefined) },
      headers: { get: (n: string) => (n.toLowerCase() === "authorization" ? auth ?? null : null) },
    };
  }

  test("nenhuma credencial: authorization ausente e formato 'nenhum'", async () => {
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake());
    expect(payload).toBeNull();
    expect(diagnostico).toEqual({
      cookiePresente: false,
      cookieValido: false,
      authorizationPresente: false,
      formatoBearer: "nenhum",
      jweValido: false,
      opacoValido: false,
      fonte: "nenhuma",
    });
  });

  test("JWE valido e identificado: fonte=jwe, jweValido=true", async () => {
    const token = await criarSessaoPortatil(PAYLOAD);
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake(undefined, `Bearer ${token}`));
    expect(payload).toEqual(PAYLOAD);
    expect(diagnostico.formatoBearer).toBe("jwe");
    expect(diagnostico.jweValido).toBe(true);
    expect(diagnostico.fonte).toBe("jwe");
  });

  test("JWE adulterado e identificado: formato jwe, porem invalido", async () => {
    const token = await criarSessaoPortatil(PAYLOAD);
    const adulterado = token.slice(0, -4) + "abcd";
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake(undefined, `Bearer ${adulterado}`));
    expect(payload).toBeNull();
    expect(diagnostico.formatoBearer).toBe("jwe");
    expect(diagnostico.jweValido).toBe(false);
    expect(diagnostico.fonte).toBe("nenhuma");
  });

  test("sessao opaca legada e identificada: fonte=opaco", async () => {
    const token = await criarSessaoOpaca(PAYLOAD);
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake(undefined, `Bearer ${token}`));
    expect(payload).toEqual(PAYLOAD);
    expect(diagnostico.formatoBearer).toBe("opaco");
    expect(diagnostico.opacoValido).toBe(true);
    expect(diagnostico.fonte).toBe("opaco");
  });

  test("opaco invalido/inexistente: formato opaco, porem invalido", async () => {
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake(undefined, `Bearer ${"a".repeat(32)}`));
    expect(payload).toBeNull();
    expect(diagnostico.formatoBearer).toBe("opaco");
    expect(diagnostico.opacoValido).toBe(false);
  });

  test("formato desconhecido (nem JWE nem opaco): formatoBearer='outro'", async () => {
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake(undefined, "Bearer valor-qualquer"));
    expect(payload).toBeNull();
    expect(diagnostico.authorizationPresente).toBe(true);
    expect(diagnostico.formatoBearer).toBe("outro");
    expect(diagnostico.jweValido).toBe(false);
    expect(diagnostico.opacoValido).toBe(false);
  });

  test("cookie invalido nao impede a tentativa do Bearer (fonte ainda pode ser jwe)", async () => {
    const token = await criarSessaoPortatil(PAYLOAD);
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake("cookie-adulterado", `Bearer ${token}`));
    expect(payload).toEqual(PAYLOAD);
    expect(diagnostico.cookiePresente).toBe(true);
    expect(diagnostico.cookieValido).toBe(false);
    expect(diagnostico.fonte).toBe("jwe");
  });

  test("cookie valido: fonte=cookie, nunca tenta decriptar bearer mesmo se presente", async () => {
    const jwt = await criarTokenCliente(PAYLOAD);
    const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(reqFake(jwt, "Bearer qualquer-coisa"));
    expect(payload).toEqual(PAYLOAD);
    expect(diagnostico.cookiePresente).toBe(true);
    expect(diagnostico.cookieValido).toBe(true);
    expect(diagnostico.fonte).toBe("cookie");
  });

  test("diagnostico nunca contem o token, o cookie, o telefone ou o clienteId", async () => {
    const token = await criarSessaoPortatil(PAYLOAD);
    const { diagnostico } = await lerSessaoClienteDiagnosticada(reqFake("cookie-secreto-xyz", `Bearer ${token}`));
    const serializado = JSON.stringify(diagnostico);
    expect(serializado).not.toContain(token);
    expect(serializado).not.toContain("cookie-secreto-xyz");
    expect(serializado).not.toContain(PAYLOAD.telefone);
    expect(serializado).not.toContain(PAYLOAD.clienteId);
  });
});
