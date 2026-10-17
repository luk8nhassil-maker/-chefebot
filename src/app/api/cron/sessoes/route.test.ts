import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      keys: vi.fn(async () => [...store.keys()].filter((key) => key.startsWith("session_ts:"))),
      del: vi.fn(async (key: string) => store.delete(key) ? 1 : 0),
    },
  };
});

vi.mock("@/lib/redis", () => ({ redis: h.redis }));
vi.mock("@/lib/evolutionApi", () => ({ obterConfigEvolution: vi.fn(() => null) }));

import { GET } from "./route";
import { obterConfigEvolution } from "@/lib/evolutionApi";

beforeEach(() => {
  h.store.clear();
  vi.clearAllMocks();
  vi.mocked(obterConfigEvolution).mockReturnValue(null);
  process.env.CRON_SECRET = "cron-teste";
});

describe("cron legado de sessões", () => {
  test("pausa global não apaga sessão nem tenta reengajar cliente", async () => {
    h.store.set("bot_ativo", false);
    h.store.set("session_ts:5586999990001", Date.now() - 60 * 60 * 1000);
    h.store.set("session:5586999990001", { step: "category" });
    const res = await GET(new Request("https://exemplo.test/api/cron/sessoes", {
      headers: { authorization: "Bearer cron-teste" },
    }));

    expect(await res.json()).toMatchObject({ skipped: true, motivo: "bot_pausado" });
    expect(h.redis.keys).not.toHaveBeenCalled();
    expect(h.redis.del).not.toHaveBeenCalled();
    expect(h.store.has("session:5586999990001")).toBe(true);
  });

  test("pausa durante o lote preserva as sessões ainda não processadas", async () => {
    vi.mocked(obterConfigEvolution).mockReturnValue({
      baseUrl: "https://evolution.exemplo.test", apiKey: "teste", instanceName: "chefebot",
    } as never);
    h.store.set("session_ts:5586999990001", Date.now() - 60 * 60 * 1000);
    h.store.set("session:5586999990001", { step: "category" });
    h.store.set("session_ts:5586999990002", Date.now() - 60 * 60 * 1000);
    h.store.set("session:5586999990002", { step: "category" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      h.store.set("bot_ativo", false);
      return { ok: true, status: 200 };
    }));

    const res = await GET(new Request("https://exemplo.test/api/cron/sessoes", {
      headers: { authorization: "Bearer cron-teste" },
    }));

    expect(await res.json()).toMatchObject({ ok: true, resetadas: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(h.store.has("session:5586999990002")).toBe(true);
  });
});
