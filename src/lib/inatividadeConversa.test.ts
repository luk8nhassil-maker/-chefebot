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
    incr: vi.fn(async (key: string) => {
      const atual = (store.get(key) as number | undefined) ?? 0;
      const novo = atual + 1;
      store.set(key, novo);
      return novo;
    }),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

const { publishJSONMock, clientCtorMock } = vi.hoisted(() => ({
  publishJSONMock: vi.fn(async (_req: { url: string; body: unknown; delay?: number; deduplicationId?: string; retries?: number }) => ({ messageId: "msg_1" })),
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

const PHONE = "5586999990001";

beforeEach(() => {
  store.clear();
  publishJSONMock.mockClear();
  clientCtorMock.mockClear();
  vi.resetModules();
  delete process.env.QSTASH_TOKEN;
  delete process.env.VERCEL_URL;
  delete process.env.CANCELAMENTO_INATIVIDADE_QSTASH_CALLBACK_URL;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sincronizarCronometroInatividade — geração avança sempre, tick só quando somos nós", () => {
  test("mensagem do cliente avança a geração mas nunca agenda tick", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "category" });

    await mod.sincronizarCronometroInatividade(PHONE, "cliente");
    expect(publishJSONMock).not.toHaveBeenCalled();
    expect(await mod.geracaoAtualCronometroInatividade(PHONE)).toBe(1);
  });

  test("mensagem do bot numa etapa elegível agenda o tick com delay de 10 minutos", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "category" });

    await mod.sincronizarCronometroInatividade(PHONE, "bot");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
    const chamada = publishJSONMock.mock.calls[0][0];
    expect(chamada.body).toEqual({ phone: PHONE, geracao: 1 });
    expect(chamada.delay).toBe(600); // 10 min em segundos
    expect(chamada.url).toBe("https://chefebot-pjif.vercel.app/api/interno/cancelamento-inatividade");
    expect(chamada.deduplicationId).toBe(`cancelamento-inatividade-${PHONE}-g1`);
    expect(chamada.retries).toBe(2);
  });

  test("mensagem do atendente também agenda o tick (mesmo tratamento do bot)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "escalado" });

    await mod.sincronizarCronometroInatividade(PHONE, "atendente");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
  });

  test("cada mensagem nossa reagenda com uma geração nova — nunca acumula ticks úteis", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "category" });

    await mod.sincronizarCronometroInatividade(PHONE, "bot");
    await mod.sincronizarCronometroInatividade(PHONE, "cliente");
    await mod.sincronizarCronometroInatividade(PHONE, "bot");

    expect(publishJSONMock).toHaveBeenCalledTimes(2);
    expect(publishJSONMock.mock.calls[0][0].body).toEqual({ phone: PHONE, geracao: 1 });
    expect(publishJSONMock.mock.calls[1][0].body).toEqual({ phone: PHONE, geracao: 3 });
  });

  test("sem sessão ativa, não agenda (nada para cancelar)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    await mod.sincronizarCronometroInatividade(PHONE, "bot");
    expect(publishJSONMock).not.toHaveBeenCalled();
  });

  test("etapa 'done' nunca agenda", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "done" });
    await mod.sincronizarCronometroInatividade(PHONE, "bot");
    expect(publishJSONMock).not.toHaveBeenCalled();
  });

  test("etapa 'aguardando_pix' nunca agenda (cronômetro próprio do Guardião Pix)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "aguardando_pix" });
    await mod.sincronizarCronometroInatividade(PHONE, "bot");
    expect(publishJSONMock).not.toHaveBeenCalled();
  });

  test("etapa 'escalado' (atendimento humano) agenda normalmente", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "escalado" });
    await mod.sincronizarCronometroInatividade(PHONE, "atendente");
    expect(publishJSONMock).toHaveBeenCalledTimes(1);
  });

  test("sem QSTASH_TOKEN, nunca agenda e nunca lança", async () => {
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "category" });
    await expect(mod.sincronizarCronometroInatividade(PHONE, "bot")).resolves.toBeUndefined();
    expect(publishJSONMock).not.toHaveBeenCalled();
  });

  test("falha do QStash nunca lança (best-effort)", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "category" });
    publishJSONMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    await expect(mod.sincronizarCronometroInatividade(PHONE, "bot")).resolves.toBeUndefined();
  });

  test("telefone vazio é ignorado, nunca lança", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    const mod = await import("./inatividadeConversa");
    await expect(mod.sincronizarCronometroInatividade("", "bot")).resolves.toBeUndefined();
    expect(publishJSONMock).not.toHaveBeenCalled();
  });

  test("usa VERCEL_URL quando presente e respeita override explícito", async () => {
    process.env.QSTASH_TOKEN = "token-teste";
    process.env.VERCEL_URL = "meudominio.vercel.app";
    const mod = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "category" });

    await mod.sincronizarCronometroInatividade(PHONE, "bot");
    expect(publishJSONMock.mock.calls[0][0].url).toBe("https://meudominio.vercel.app/api/interno/cancelamento-inatividade");

    process.env.CANCELAMENTO_INATIVIDADE_QSTASH_CALLBACK_URL = "https://custom.example/callback";
    vi.resetModules();
    const mod2 = await import("./inatividadeConversa");
    store.set(`session:${PHONE}`, { step: "category" });
    await mod2.sincronizarCronometroInatividade(PHONE, "bot");
    expect(publishJSONMock.mock.calls[1][0].url).toBe("https://custom.example/callback");
  });
});

describe("geracaoAtualCronometroInatividade", () => {
  test("devolve 0 quando nunca houve mensagem nenhuma", async () => {
    const mod = await import("./inatividadeConversa");
    expect(await mod.geracaoAtualCronometroInatividade(PHONE)).toBe(0);
  });

  test("nunca lança mesmo se o redis falhar", async () => {
    const mod = await import("./inatividadeConversa");
    redisMock.get.mockRejectedValueOnce(new Error("falha redis"));
    await expect(mod.geracaoAtualCronometroInatividade(PHONE)).resolves.toBe(0);
  });
});
