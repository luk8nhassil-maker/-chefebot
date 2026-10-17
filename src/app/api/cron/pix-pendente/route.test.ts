import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      keys: vi.fn(async (pattern: string) => pattern === "session:*"
        ? [...store.keys()].filter((key) => key.startsWith("session:")) : []),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
    },
  };
});

vi.mock("@/lib/redis", () => ({ redis: h.redis }));
vi.mock("@/lib/vercelProjeto", () => ({ ehProjetoVercelLegado: vi.fn(() => false) }));
vi.mock("@/lib/evolutionApi", () => ({ obterConfigEvolution: vi.fn(() => ({
  baseUrl: "https://evolution.exemplo.test", apiKey: "teste", instanceName: "chefebot",
})) }));
vi.mock("@/lib/pedidosConcorrencia", () => ({
  mutarPedidos: vi.fn(async (fn: (pedidos: Array<Record<string, unknown>>) => {
    persistir: boolean; pedidos?: Array<Record<string, unknown>>;
  }) => {
    const resultado = fn(h.store.get("pedidos") as Array<Record<string, unknown>> ?? []);
    if (resultado.persistir) h.store.set("pedidos", resultado.pedidos);
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  h.store.clear();
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-teste";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe("cron de Pix pendente com bot pausado", () => {
  test("mantém escalonamento humano após 6 minutos sem enviar lembretes", async () => {
    h.store.set("bot_ativo", false);
    h.store.set("session:5586999990001", { step: "aguardando_pix", pixIniciadoEm: Date.now() - 7 * 60_000, pixCobrancas: 0 });
    h.store.set("session:5586999990002", { step: "aguardando_pix", pixIniciadoEm: Date.now() - 4 * 60_000, pixCobrancas: 0 });
    h.store.set("pedidos", [{ id: "p1", telefone: "5586999990001", status: "novo", escalonado: false }]);

    const res = await GET(new Request("https://exemplo.test/api/cron/pix-pendente", {
      headers: { authorization: "Bearer cron-teste" },
    }));

    expect(await res.json()).toMatchObject({ ok: true, cobrados: 0, escalados: 1 });
    expect(h.store.get("pedidos")).toEqual([expect.objectContaining({ id: "p1", escalonado: true })]);
    expect(h.store.get("session:5586999990002")).toMatchObject({ pixCobrancas: 0 });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  test("pausa acionada durante o lote impede os destinatários restantes", async () => {
    h.store.set("session:5586999990001", { step: "aguardando_pix", pixIniciadoEm: Date.now() - 3 * 60_000, pixCobrancas: 0 });
    h.store.set("session:5586999990002", { step: "aguardando_pix", pixIniciadoEm: Date.now() - 3 * 60_000, pixCobrancas: 0 });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      h.store.set("bot_ativo", false);
      return { ok: true, status: 200 } as Response;
    });

    const res = await GET(new Request("https://exemplo.test/api/cron/pix-pendente", {
      headers: { authorization: "Bearer cron-teste" },
    }));

    expect(await res.json()).toMatchObject({ ok: true, cobrados: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(h.store.get("session:5586999990002")).toMatchObject({ pixCobrancas: 0 });
  });
});
