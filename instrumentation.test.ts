import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Prova de rede real do item 13 da última correção: instrumentation.ts
// instala um guard em globalThis.fetch, só quando CHEFEBOT_E2E=1, que
// bloqueia qualquer chamada para um host que não seja 127.0.0.1/localhost —
// transforma uma chamada externa esquecida numa falha barulhenta e real, em
// vez de depender só de auditoria por leitura de código.
describe("instrumentation.ts — guard de rede do E2E local (CHEFEBOT_E2E)", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = fetchOriginal;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    delete process.env.CHEFEBOT_E2E;
    delete process.env.NEXT_RUNTIME;
  });

  test("com CHEFEBOT_E2E=1 (runtime nodejs): bloqueia fetch para host externo", async () => {
    process.env.CHEFEBOT_E2E = "1";
    process.env.NEXT_RUNTIME = "nodejs";
    globalThis.fetch = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;

    const { register } = await import("./instrumentation");
    await register();

    await expect(fetch("https://evolution.exemplo.com.br/message/sendText")).rejects.toThrow(
      /fetch bloqueado/,
    );
  });

  test("com CHEFEBOT_E2E=1: permite fetch para 127.0.0.1 e localhost normalmente", async () => {
    process.env.CHEFEBOT_E2E = "1";
    process.env.NEXT_RUNTIME = "nodejs";
    const fetchMockado = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMockado as unknown as typeof fetch;

    const { register } = await import("./instrumentation");
    await register();

    await expect(fetch("http://127.0.0.1:3100/api/cliente/perfil")).resolves.toBeInstanceOf(Response);
    await expect(fetch("http://localhost:3100/api/cliente/perfil")).resolves.toBeInstanceOf(Response);
    expect(fetchMockado).toHaveBeenCalledTimes(2);
  });

  test("sem CHEFEBOT_E2E (produção/dev normal): nunca instrumenta o fetch global", async () => {
    delete process.env.CHEFEBOT_E2E;
    process.env.NEXT_RUNTIME = "nodejs";
    const fetchOriginalDoTeste = globalThis.fetch;

    const { register } = await import("./instrumentation");
    await register();

    expect(globalThis.fetch).toBe(fetchOriginalDoTeste);
  });

  test("CHEFEBOT_E2E=1 mas runtime edge: nunca instrumenta (evita duplicar o wrap)", async () => {
    process.env.CHEFEBOT_E2E = "1";
    process.env.NEXT_RUNTIME = "edge";
    const fetchOriginalDoTeste = globalThis.fetch;

    const { register } = await import("./instrumentation");
    await register();

    expect(globalThis.fetch).toBe(fetchOriginalDoTeste);
  });
});
