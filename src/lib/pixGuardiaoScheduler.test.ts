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
    del: vi.fn(async (key: string) => {
      const existia = store.delete(key);
      return existia ? 1 : 0;
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

const { publishJSONMock, clientCtorMock } = vi.hoisted(() => ({
  publishJSONMock: vi.fn(async (_req: { url: string; body: unknown; delay?: number; deduplicationId?: string; flowControl?: unknown }) => ({ messageId: "msg_1" })),
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
    redisMock.del.mockClear();
    vi.resetModules();
    delete process.env.QSTASH_TOKEN;
    delete process.env.VERCEL_URL;
    delete process.env.PIX_GUARDIAO_QSTASH_CALLBACK_URL;
    delete process.env.PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("sem QSTASH_TOKEN, iniciarCadeiaGuardiaoPix e agendarProximaVerificacaoPixGuardiao sao no-op seguro", async () => {
    const mod = await import("./pixGuardiaoScheduler");
    await mod.iniciarCadeiaGuardiaoPix("pedido-1");
    expect(publishJSONMock).not.toHaveBeenCalled();

    const agendou = await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-1", geracao: 1, tentativa: 2, delayMs: 20_000 });
    expect(agendou).toBe(false);
  });

  test("com QSTASH_TOKEN, iniciarCadeiaGuardiaoPix cria o estado do Sentinela (geracao 1), publica o primeiro tick com delay de 5s e trava a cadeia (nao duplica)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    await mod.iniciarCadeiaGuardiaoPix("pedido-1");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
    const chamada = publishJSONMock.mock.calls[0][0];
    expect(chamada.body).toEqual({ pedidoId: "pedido-1", geracao: 1, tentativa: 1 });
    expect(chamada.delay).toBe(5);
    expect(chamada.deduplicationId).toBe("pix-guardiao-pedido-1-g1-1");
    expect(chamada.deduplicationId).not.toContain(":");
    expect(chamada.url).toBe("https://chefebot-pjif.vercel.app/api/interno/pix-guardiao/verificar");

    // Segunda chamada para o mesmo pedido: lock NX ja adquirido -> no-op.
    await mod.iniciarCadeiaGuardiaoPix("pedido-1");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
  });

  test("flowControl é incluído por padrão (parallelism > 0) e pode ser desativado por env var", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");
    await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-fc", geracao: 1, tentativa: 1, delayMs: 5_000 });
    const chamada = publishJSONMock.mock.calls[0][0] as { flowControl?: { key: string; parallelism: number } };
    expect(chamada.flowControl).toEqual({ key: "pix-guardiao-verificacao", parallelism: 10 });

    process.env.PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM = "0";
    vi.resetModules();
    const mod2 = await import("./pixGuardiaoScheduler");
    await mod2.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-fc-off", geracao: 1, tentativa: 1, delayMs: 5_000 });
    const chamada2 = publishJSONMock.mock.calls[1][0] as { flowControl?: unknown };
    expect(chamada2.flowControl).toBeUndefined();
  });

  test("retries reduzido para 2 (endpoint idempotente)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");
    await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-retries", geracao: 1, tentativa: 1, delayMs: 5_000 });
    expect(publishJSONMock.mock.calls[0][0]).toMatchObject({ retries: 2 });
  });

  test("usa VERCEL_URL quando presente e respeita override explicito", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    process.env.VERCEL_URL = "meudominio.vercel.app";
    const mod = await import("./pixGuardiaoScheduler");

    await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-2", geracao: 1, tentativa: 1, delayMs: 10_000 });
    expect(publishJSONMock.mock.calls[0][0].url).toBe("https://meudominio.vercel.app/api/interno/pix-guardiao/verificar");

    process.env.PIX_GUARDIAO_QSTASH_CALLBACK_URL = "https://custom.example/callback";
    vi.resetModules();
    const mod2 = await import("./pixGuardiaoScheduler");
    await mod2.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-3", geracao: 1, tentativa: 1, delayMs: 10_000 });
    expect(publishJSONMock.mock.calls[1][0].url).toBe("https://custom.example/callback");
  });

  test("agendarProximaVerificacaoPixGuardiao nao publica alem do teto de tentativas e nao lanca em falha do QStash", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    const alemDoTeto = await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-4", geracao: 1, tentativa: 999, delayMs: 10_000 });
    expect(alemDoTeto).toBe(false);
    expect(publishJSONMock).not.toHaveBeenCalled();

    publishJSONMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    const falhou = await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-5", geracao: 1, tentativa: 1, delayMs: 10_000 });
    expect(falhou).toBe(false);
  });

  describe("gerarDeduplicationIdGuardiaoPix", () => {
    test("nunca contem ':' mesmo com pedidoId contendo caracteres especiais", async () => {
      const { gerarDeduplicationIdGuardiaoPix } = await import("./pixGuardiaoScheduler");
      const id = gerarDeduplicationIdGuardiaoPix("pedido:123:abc", 1, 1);
      expect(id).not.toContain(":");
    });

    test("nunca contem espacos", async () => {
      const { gerarDeduplicationIdGuardiaoPix } = await import("./pixGuardiaoScheduler");
      const id = gerarDeduplicationIdGuardiaoPix("pedido com espaco 123", 1, 2);
      expect(id).not.toMatch(/\s/);
    });

    test("substitui qualquer caractere fora de letras, numeros, hifen e underscore", async () => {
      const { gerarDeduplicationIdGuardiaoPix } = await import("./pixGuardiaoScheduler");
      const id = gerarDeduplicationIdGuardiaoPix("pedido#123@abc!/xyz", 1, 1);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    test("mesmo pedidoId, geracao e tentativa geram sempre o mesmo id (deterministico)", async () => {
      const { gerarDeduplicationIdGuardiaoPix } = await import("./pixGuardiaoScheduler");
      const id1 = gerarDeduplicationIdGuardiaoPix("pedido-abc", 2, 3);
      const id2 = gerarDeduplicationIdGuardiaoPix("pedido-abc", 2, 3);
      expect(id1).toBe(id2);
    });

    test("tentativas diferentes geram ids diferentes para o mesmo pedido/geracao", async () => {
      const { gerarDeduplicationIdGuardiaoPix } = await import("./pixGuardiaoScheduler");
      const id1 = gerarDeduplicationIdGuardiaoPix("pedido-abc", 1, 1);
      const id2 = gerarDeduplicationIdGuardiaoPix("pedido-abc", 1, 2);
      expect(id1).not.toBe(id2);
    });

    test("geracoes diferentes geram ids diferentes para o mesmo pedido/tentativa — mensagens de uma cadeia antiga não colidem com a nova", async () => {
      const { gerarDeduplicationIdGuardiaoPix } = await import("./pixGuardiaoScheduler");
      const id1 = gerarDeduplicationIdGuardiaoPix("pedido-abc", 1, 1);
      const id2 = gerarDeduplicationIdGuardiaoPix("pedido-abc", 2, 1);
      expect(id1).not.toBe(id2);
    });

    test("mantem tamanho seguro mesmo com pedidoId muito longo", async () => {
      const { gerarDeduplicationIdGuardiaoPix } = await import("./pixGuardiaoScheduler");
      const pedidoIdGigante = "x".repeat(5000);
      const id = gerarDeduplicationIdGuardiaoPix(pedidoIdGigante, 1, 1);
      expect(id.length).toBeLessThan(200);
    });
  });

  test("publishJSON recebe o deduplicationId corrigido (sem ':')", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");
    await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido:com:dois-pontos", geracao: 1, tentativa: 4, delayMs: 10_000 });
    const chamada = publishJSONMock.mock.calls[0][0];
    expect(chamada.deduplicationId).toBe(mod.gerarDeduplicationIdGuardiaoPix("pedido:com:dois-pontos", 1, 4));
    expect(chamada.deduplicationId).not.toContain(":");
    // O pedidoId usado no corpo (para localizar o pedido no endpoint) continua intacto.
    expect(chamada.body).toEqual({ pedidoId: "pedido:com:dois-pontos", geracao: 1, tentativa: 4 });
  });

  test("publicacao bem-sucedida mantem o lock da cadeia (segunda chamada nao duplica)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    await mod.iniciarCadeiaGuardiaoPix("pedido-lock-ok");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
    expect(store.has("pix:guardiao:cadeia:lock:pedido-lock-ok")).toBe(true);

    await mod.iniciarCadeiaGuardiaoPix("pedido-lock-ok");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
  });

  test("publicacao com falha libera o lock imediatamente", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    publishJSONMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    await mod.iniciarCadeiaGuardiaoPix("pedido-lock-falha");

    expect(store.has("pix:guardiao:cadeia:lock:pedido-lock-falha")).toBe(false);
    expect(redisMock.del).toHaveBeenCalledWith("pix:guardiao:cadeia:lock:pedido-lock-falha");
  });

  test("apos falha, uma nova tentativa de iniciar a cadeia e permitida (nao fica bloqueada ate o TTL)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    publishJSONMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    await mod.iniciarCadeiaGuardiaoPix("pedido-retry");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);

    // Segunda tentativa (ex.: próxima criação/replay) — lock foi liberado, publica de novo.
    await mod.iniciarCadeiaGuardiaoPix("pedido-retry");
    expect(publishJSONMock).toHaveBeenCalledTimes(2);
    expect(store.has("pix:guardiao:cadeia:lock:pedido-retry")).toBe(true);
  });

  test("chamadas repetidas para o mesmo pedidoId+geracao+tentativa sempre enviam o mesmo deduplicationId ao QStash (dedup do lado do QStash depende disso)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");

    await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-dup", geracao: 1, tentativa: 1, delayMs: 10_000 });
    await mod.agendarProximaVerificacaoPixGuardiao({ pedidoId: "pedido-dup", geracao: 1, tentativa: 1, delayMs: 10_000 });

    expect(publishJSONMock).toHaveBeenCalledTimes(2);
    const [primeira, segunda] = publishJSONMock.mock.calls;
    expect(primeira[0].deduplicationId).toBe(segunda[0].deduplicationId);
  });

  test("criacao do Pix (iniciarCadeiaGuardiaoPix) nunca lanca mesmo se o QStash estiver indisponivel", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./pixGuardiaoScheduler");
    publishJSONMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    await expect(mod.iniciarCadeiaGuardiaoPix("pedido-sem-throw")).resolves.toBeUndefined();
  });
});
