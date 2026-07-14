import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

const { publishJSONMock, clientCtorMock } = vi.hoisted(() => ({
  publishJSONMock: vi.fn(async (_req: { url: string; body: unknown; delay?: number; deduplicationId?: string }) => ({ messageId: "msg_1" })),
  clientCtorMock: vi.fn(),
}));

vi.mock("@upstash/qstash", () => ({
  Client: class {
    constructor(config: unknown) {
      clientCtorMock(config);
    }
    publishJSON = publishJSONMock;
  },
}));

describe("pixGuardiaoScheduler", () => {
  beforeEach(() => {
    store.clear();
    publishJSONMock.mockClear();
    clientCtorMock.mockClear();
    vi.resetModules();
    delete process.env.QSTASH_TOKEN;
    delete process.env.VERCEL_URL;
    delete process.env.PIX_GUARDIAO_QSTASH_CALLBACK_URL;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("sem QSTASH_TOKEN, iniciarCadeiaGuardiaoPix e agendarProximaVerificacaoPixGuardiao sao no-op seguro", async () => {
    const mod = await import("./pixGuardiaoScheduler");
    await mod.iniciarCadeiaGuardiaoPix("pedido-1");
    expect(publishJSONMock).not.toHaveBeenCalled();

    const agendou = await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-1", tentativa: 2, delayMs: 20_000 });
    expect(agendou).toBe(false);
  });

  test("com QSTASH_TOKEN, iniciarCadeiaGuardiaoPix publica o primeiro tick e trava a cadeia (nao duplica)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    await mod.iniciarCadeiaGuardiaoPix("pedido-1");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
    const chamada = publishJSONMock.mock.calls[0][0];
    expect(chamada.body).toEqual({ pedidoId: "pedido-1", tentativa: 1 });
    expect(chamada.delay).toBe(10);
    expect(chamada.deduplicationId).toBe("pix-guardiao:pedido-1:1");
    expect(chamada.url).toBe("https://chefebot-pjif.vercel.app/api/interno/pix-guardiao/verificar");

    // Segunda chamada para o mesmo pedido: lock NX ja adquirido -> no-op.
    await mod.iniciarCadeiaGuardiaoPix("pedido-1");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
  });

  test("usa VERCEL_URL quando presente e respeita override explicito", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    process.env.VERCEL_URL = "meudominio.vercel.app";
    const mod = await import("./pixGuardiaoScheduler");

    await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-2", tentativa: 1, delayMs: 10_000 });
    expect(publishJSONMock.mock.calls[0][0].url).toBe("https://meudominio.vercel.app/api/interno/pix-guardiao/verificar");

    process.env.PIX_GUARDIAO_QSTASH_CALLBACK_URL = "https://custom.example/callback";
    vi.resetModules();
    const mod2 = await import("./pixGuardiaoScheduler");
    await mod2.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-3", tentativa: 1, delayMs: 10_000 });
    expect(publishJSONMock.mock.calls[1][0].url).toBe("https://custom.example/callback");
  });

  test("agendarProximaVerificacaoPixGuardiao nao publica alem do teto de tentativas e nao lanca em falha do QStash", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    const alemDoTeto = await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-4", tentativa: 999, delayMs: 10_000 });
    expect(alemDoTeto).toBe(false);
    expect(publishJSONMock).not.toHaveBeenCalled();

    publishJSONMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    const falhou = await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-5", tentativa: 1, delayMs: 10_000 });
    expect(falhou).toBe(false);
  });
});
