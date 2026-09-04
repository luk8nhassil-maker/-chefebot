import { vi, describe, it, expect, beforeEach } from "vitest";

// GET /api/diagnostico/whatsapp — cobre as garantias da sonda: somente
// leitura (nunca chama connect/create/delete/logout/webhook-set), nenhum
// segredo/PII na resposta, e o diagnóstico correto para os dois cenários que
// motivaram a rota: webhook não registrado/desatualizado vs. evento
// simplesmente não chegando ao nosso servidor (inboundLastSeenAt nulo/antigo).

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { obterConfigEvolutionMock } = vi.hoisted(() => ({
  obterConfigEvolutionMock: vi.fn(),
}));
vi.mock("@/lib/evolutionApi", () => ({ obterConfigEvolution: obterConfigEvolutionMock }));

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(async (_url: string, _init?: unknown) => new Response("{}")),
}));

const CONFIG = {
  baseUrl: "https://evolution.example.com",
  apiKey: "chave-secreta-nunca-deve-aparecer",
  instanceName: "chefebot",
  webhookUrl: "https://chefedapizza.com.br/api/whatsapp",
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // A rota mantém um cache em memória (mesma janela de estrangulamento do
  // /api/diagnostico/datastore) entre chamadas de GET — precisa ser
  // reimportada a cada teste para não vazar o veredito de um teste no outro.
  vi.resetModules();
});

function jsonRes(status: number, data: unknown) {
  return { status, json: async () => data } as Response;
}

describe("GET /api/diagnostico/whatsapp", () => {
  it("nunca chama uma rota que modifica a instância (só GET de leitura)", async () => {
    obterConfigEvolutionMock.mockReturnValue(CONFIG);
    fetchMock.mockImplementation(async () => jsonRes(200, { instance: { state: "open" } }) as Response);
    store.set("bot_ativo", true);

    const { GET } = await import("./route");
    await GET();

    const urlsChamadas = fetchMock.mock.calls.map(([url]) => url);
    for (const url of urlsChamadas) {
      expect(url).not.toMatch(/instance\/(connect|create|delete|logout)\b/);
      expect(url).not.toMatch(/webhook\/set\b/);
    }
    expect(urlsChamadas.some((u: string) => u.includes("/instance/connectionState/"))).toBe(true);
    expect(urlsChamadas.some((u: string) => u.includes("/webhook/find/"))).toBe(true);
  });

  it("nunca devolve a apiKey nem o corpo bruto da Evolution na resposta", async () => {
    obterConfigEvolutionMock.mockReturnValue(CONFIG);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/webhook/find/")) {
        return jsonRes(200, {
          url: CONFIG.webhookUrl,
          enabled: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        }) as Response;
      }
      return jsonRes(200, { instance: { state: "open" } }) as Response;
    });
    store.set("bot_ativo", true);

    const { GET } = await import("./route");
    const res = await GET();
    const body = JSON.stringify(await res.json());

    expect(body).not.toContain(CONFIG.apiKey);
  });

  it("diagnostica webhook desatualizado (apontando para outro deploy) mesmo com a instância 'open'", async () => {
    obterConfigEvolutionMock.mockReturnValue(CONFIG);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/webhook/find/")) {
        return jsonRes(200, {
          url: "https://chefebot-pjif.vercel.app/api/whatsapp",
          enabled: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        }) as Response;
      }
      return jsonRes(200, { instance: { state: "open" } }) as Response;
    });
    store.set("bot_ativo", true);

    const { GET } = await import("./route");
    const data = await (await GET()).json();

    expect(data.providerConnectionState).toBe("open");
    expect(data.webhookApontaParaProducao).toBe(false);
  });

  it("diagnostica evento não chegando (inboundLastSeenAt nulo) mesmo com webhook e instância OK", async () => {
    obterConfigEvolutionMock.mockReturnValue(CONFIG);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/webhook/find/")) {
        return jsonRes(200, {
          url: CONFIG.webhookUrl,
          enabled: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        }) as Response;
      }
      return jsonRes(200, { instance: { state: "open" } }) as Response;
    });
    store.set("bot_ativo", true);
    // whatsapp:diag:inboundLastSeenAt nunca foi gravado — nenhum evento chegou.

    const { GET } = await import("./route");
    const data = await (await GET()).json();

    expect(data.providerConnectionState).toBe("open");
    expect(data.webhookApontaParaProducao).toBe(true);
    expect(data.webhookEventosOk).toBe(true);
    expect(data.inboundLastSeenAt).toBeNull();
  });

  it("provider não configurado retorna diagnóstico degradado sem lançar", async () => {
    obterConfigEvolutionMock.mockReturnValue(null);
    store.set("bot_ativo", true);

    const { GET } = await import("./route");
    const data = await (await GET()).json();

    expect(data.providerConfigured).toBe(false);
    expect(data.providerConnectionState).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
