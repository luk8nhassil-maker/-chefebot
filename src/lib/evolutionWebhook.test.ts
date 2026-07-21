import { vi, describe, test, expect, beforeEach } from "vitest";
import { garantirWebhookEvolution } from "./evolutionWebhook";
import type { EvolutionConfig } from "./evolutionApi";

vi.stubGlobal("fetch", vi.fn());

const config: EvolutionConfig = {
  baseUrl: "https://evolution.teste.com.br",
  apiKey: "chave-de-teste",
  instanceName: "chefebot",
  webhookUrl: "https://chefebot-pjif.vercel.app/api/whatsapp",
};

beforeEach(() => {
  vi.mocked(fetch).mockReset();
});

describe("garantirWebhookEvolution", () => {
  test("chama webhook/set com a URL oficial e os eventos obrigatórios (QRCODE_UPDATED e CONNECTION_UPDATE inclusos)", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const resultado = await garantirWebhookEvolution(config);

    expect(resultado).toEqual({ ok: true, status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://evolution.teste.com.br/webhook/set/chefebot");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.webhook.url).toBe(config.webhookUrl);
    expect(body.webhook.enabled).toBe(true);
    expect(body.webhook.events).toContain("QRCODE_UPDATED");
    expect(body.webhook.events).toContain("CONNECTION_UPDATE");
    expect(body.webhook.events).toContain("MESSAGES_UPSERT");
  });

  test("nunca envia a apikey no corpo — só no header apikey", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await garantirWebhookEvolution(config);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.apikey).toBe(config.apiKey);
    expect((init as RequestInit).body as string).not.toContain(config.apiKey);
  });

  test("propaga status não-ok sem lançar — chamador decide o que fazer", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    const resultado = await garantirWebhookEvolution(config);
    expect(resultado).toEqual({ ok: false, status: 500 });
  });
});
