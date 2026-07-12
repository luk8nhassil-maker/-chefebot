import { vi, describe, test, expect, beforeEach } from "vitest";

const redisStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
  },
}));

vi.stubGlobal("fetch", vi.fn());

import { GET } from "./route";

function requestComAuth(secret?: string) {
  return new Request("http://localhost/api/cron/whatsapp-health", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  redisStore.clear();
  process.env.CRON_SECRET = "segredo-cron-teste";
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
  delete process.env.OPS_ALERT_WEBHOOK_URL;
});

describe("GET /api/cron/whatsapp-health — protegido por CRON_SECRET", () => {
  test("sem header de autorizacao retorna 401, nunca chama a Evolution API", async () => {
    const res = await GET(requestComAuth(undefined));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("com segredo errado retorna 401", async () => {
    const res = await GET(requestComAuth("segredo-errado"));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("com segredo correto e provider conectado, roda sem erro e nao dispara alerta", async () => {
    // Fetch usada tanto pela verificacao (Evolution API) quanto pelo eventual alerta —
    // como o provider esta conectado, o alerta nunca deveria ser chamado.
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { state: "open" } }) } as Response);
    const res = await GET(requestComAuth("segredo-cron-teste"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.estado).toBe("connected");
    expect(fetch).toHaveBeenCalledTimes(1); // so a verificacao, nenhum alerta
  });
});

describe("GET /api/cron/whatsapp-health — alertas sem duplicar, sem segredo", () => {
  test("alerta so dispara a partir da 2a falha consecutiva, nao na 1a", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://ops.exemplo.com/alerta";
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response);

    await GET(requestComAuth("segredo-cron-teste")); // 1a falha — sem alerta
    expect(fetch).toHaveBeenCalledTimes(1); // so a verificacao

    await GET(requestComAuth("segredo-cron-teste")); // 2a falha — dispara alerta
    expect(fetch).toHaveBeenCalledTimes(3); // verificacao + verificacao + alerta
  });

  test("nao repete o alerta em falhas subsequentes (3a, 4a...)", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://ops.exemplo.com/alerta";
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response);

    await GET(requestComAuth("segredo-cron-teste")); // 1
    await GET(requestComAuth("segredo-cron-teste")); // 2 -> alerta
    const chamadasApos2 = vi.mocked(fetch).mock.calls.length;
    await GET(requestComAuth("segredo-cron-teste")); // 3 -> sem novo alerta
    expect(vi.mocked(fetch).mock.calls.length).toBe(chamadasApos2 + 1); // so +1 (a verificacao), nenhum alerta a mais
  });

  test("alerta de recuperacao dispara quando volta a conectar depois de ter alertado falha", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://ops.exemplo.com/alerta";
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response);
    await GET(requestComAuth("segredo-cron-teste")); // 1
    await GET(requestComAuth("segredo-cron-teste")); // 2 -> alerta de falha

    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ instance: { state: "open" } }) } as Response);
    await GET(requestComAuth("segredo-cron-teste")); // recuperou -> deve alertar recuperacao
    expect(fetch).toHaveBeenCalledTimes(2); // verificacao + alerta de recuperacao
  });

  test("payload do alerta so contem os 5 campos documentados, nunca segredo/QR/telefone", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://ops.exemplo.com/alerta";
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response);
    await GET(requestComAuth("segredo-cron-teste"));
    await GET(requestComAuth("segredo-cron-teste")); // dispara alerta na 2a chamada

    const chamadaAlerta = vi.mocked(fetch).mock.calls.find(c => String(c[0]).includes("ops.exemplo.com"));
    expect(chamadaAlerta).toBeDefined();
    const corpo = JSON.parse((chamadaAlerta![1] as RequestInit).body as string);
    expect(Object.keys(corpo).sort()).toEqual(["ambiente", "estado", "etapa", "horario", "quantidadeFalhas"].sort());
    expect(JSON.stringify(corpo)).not.toContain("chave-de-teste");
  });

  test("sem OPS_ALERT_WEBHOOK_URL configurada, nunca tenta enviar alerta", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response);
    await GET(requestComAuth("segredo-cron-teste"));
    await GET(requestComAuth("segredo-cron-teste"));
    expect(fetch).toHaveBeenCalledTimes(2); // so as 2 verificacoes, nunca uma 3a chamada de alerta
  });
});
