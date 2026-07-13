import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enviarTextoWhatsApp } from "./whatsappMensagem";

const ENV_KEYS = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE_NAME"] as const;
const originais: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originais[key] = process.env[key];
  process.env.EVOLUTION_API_URL = "https://evolution.exemplo.com";
  process.env.EVOLUTION_API_KEY = "chave-teste";
  process.env.EVOLUTION_INSTANCE_NAME = "chefebot";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originais[key] === undefined) delete process.env[key];
    else process.env[key] = originais[key];
  }
  vi.unstubAllGlobals();
});

describe("enviarTextoWhatsApp", () => {
  test("provider não configurado retorna ok:false sem chamar fetch", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toEqual({ ok: false, motivo: "provider_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("envia texto sem delay quando opts não é passado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.exemplo.com/message/sendText/chefebot",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: "chave-teste" },
        body: JSON.stringify({ number: "5511999998888", text: "oi" }),
      })
    );
  });

  test("inclui delay/options quando opts.delay é passado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await enviarTextoWhatsApp("5511999998888", "oi", { delay: 900 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          number: "5511999998888",
          text: "oi",
          delay: 900,
          options: { delay: 900, presence: "composing" },
        }),
      })
    );
  });

  test("resposta HTTP não-ok vira ok:false sem lançar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toEqual({ ok: false, motivo: "http_500" });
  });

  test("erro de rede (fetch lançando) propaga para quem chamou", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviarTextoWhatsApp("5511999998888", "oi")).rejects.toThrow("network down");
  });
});
