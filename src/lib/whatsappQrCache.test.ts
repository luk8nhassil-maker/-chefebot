import { vi, describe, test, expect, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { adquirirLockGeracaoQr, lerQrAtual, limparQrAtual, persistirQrAtual } from "./whatsappQrCache";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("persistirQrAtual / lerQrAtual", () => {
  test("persiste e permite ler de volta com hash curto e TTL", async () => {
    const registro = await persistirQrAtual("chefebot", "data:image/png;base64,ABC");
    expect(registro.hash).toMatch(/^[a-f0-9]{12}$/);
    expect(registro.hash).not.toContain("ABC");
    expect(registro.size).toBe("data:image/png;base64,ABC".length);
    expect(registro.expiresAt).toBeGreaterThan(registro.generatedAt);

    const lido = await lerQrAtual("chefebot");
    expect(lido).toEqual(registro);
  });

  test("QR mais novo substitui o anterior", async () => {
    await persistirQrAtual("chefebot", "data:image/png;base64,PRIMEIRO");
    const segundo = await persistirQrAtual("chefebot", "data:image/png;base64,SEGUNDO");
    const lido = await lerQrAtual("chefebot");
    expect(lido?.base64).toBe("data:image/png;base64,SEGUNDO");
    expect(lido?.generationId).toBe(segundo.generationId);
  });

  test("uma geração mais antiga (reentrega fora de ordem) nunca sobrescreve a mais nova já salva", async () => {
    const registroAtual = await persistirQrAtual("chefebot", "data:image/png;base64,ATUAL");
    // Simula uma geração já salva com generationId maior que o próximo Date.now()
    // possível (reentrega tardia de um evento antigo chegando depois de um novo).
    const key = "whatsapp:qr:chefebot";
    store.set(key, { ...registroAtual, generationId: registroAtual.generationId + 60_000 });

    const tentativa = await persistirQrAtual("chefebot", "data:image/png;base64,REENTREGA-ANTIGA");
    expect(tentativa.base64).toBe("data:image/png;base64,ATUAL");

    const lidoFinal = await lerQrAtual("chefebot");
    expect(lidoFinal?.base64).toBe("data:image/png;base64,ATUAL");
  });

  test("QR expirado não é retornado por lerQrAtual", async () => {
    const registro = await persistirQrAtual("chefebot", "data:image/png;base64,EXP");
    const key = "whatsapp:qr:chefebot";
    store.set(key, { ...registro, expiresAt: Date.now() - 1 });
    const lido = await lerQrAtual("chefebot");
    expect(lido).toBeNull();
  });

  test("instâncias diferentes nunca compartilham QR (namespace exclusivo)", async () => {
    await persistirQrAtual("chefebot", "data:image/png;base64,A");
    await persistirQrAtual("outra-instancia", "data:image/png;base64,B");
    expect((await lerQrAtual("chefebot"))?.base64).toBe("data:image/png;base64,A");
    expect((await lerQrAtual("outra-instancia"))?.base64).toBe("data:image/png;base64,B");
  });

  test("Redis indisponível: lerQrAtual nunca lança, degrada para null", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("upstash indisponivel"));
    await expect(lerQrAtual("chefebot")).resolves.toBeNull();
  });

  test("Redis indisponível: persistirQrAtual nunca lança, ainda devolve o registro gerado", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("upstash indisponivel"));
    redisMock.set.mockRejectedValueOnce(new Error("upstash indisponivel"));
    const registro = await persistirQrAtual("chefebot", "data:image/png;base64,SEMCACHE");
    expect(registro.base64).toBe("data:image/png;base64,SEMCACHE");
  });
});

describe("limparQrAtual", () => {
  test("remove o QR persistido", async () => {
    await persistirQrAtual("chefebot", "data:image/png;base64,X");
    await limparQrAtual("chefebot");
    expect(await lerQrAtual("chefebot")).toBeNull();
  });

  test("Redis indisponível: nunca lança", async () => {
    redisMock.del.mockRejectedValueOnce(new Error("upstash indisponivel"));
    await expect(limparQrAtual("chefebot")).resolves.toBeUndefined();
  });
});

describe("adquirirLockGeracaoQr", () => {
  test("primeira chamada adquire o lock, segunda concorrente falha", async () => {
    const primeira = await adquirirLockGeracaoQr("chefebot");
    const segunda = await adquirirLockGeracaoQr("chefebot");
    expect(primeira).toBe(true);
    expect(segunda).toBe(false);
  });

  test("Redis indisponível: falha aberta (nunca bloqueia o fluxo principal)", async () => {
    redisMock.set.mockRejectedValueOnce(new Error("upstash indisponivel"));
    await expect(adquirirLockGeracaoQr("chefebot")).resolves.toBe(true);
  });
});
