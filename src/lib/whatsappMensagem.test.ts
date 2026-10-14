import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
vi.mock("./whatsappDiag", () => ({ marcarTentativaEnvio: vi.fn(async () => {}) }));
import { enviarTextoWhatsApp, normalizarLinksPublicosWhatsApp } from "./whatsappMensagem";

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

function respostaOk(data: unknown = {}) {
  return { ok: true, status: 200, json: async () => data } as Response;
}

describe("normalizarLinksPublicosWhatsApp", () => {
  test("troca o cardápio legado pelo domínio oficial e preserva query/token", () => {
    const texto = "Veja aqui: https://chefebot-pjif.vercel.app/cardapio?token=abc123";
    const normalizado = normalizarLinksPublicosWhatsApp(texto);

    expect(normalizado).toBe("Veja aqui: https://chefedapizza.com.br/cardapio?token=abc123");
    expect(normalizado).not.toContain("chefebot-pjif.vercel.app");
  });

  test("não altera mensagem que já usa o domínio oficial", () => {
    const texto = "Veja aqui: https://chefedapizza.com.br/cardapio";
    expect(normalizarLinksPublicosWhatsApp(texto)).toBe(texto);
  });
});

describe("enviarTextoWhatsApp", () => {
  test("provider não configurado retorna ok:false sem chamar fetch", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado.ok).toBe(false);
    expect(resultado.motivo).toBe("provider_not_configured");
    expect(resultado.tentativas).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("envia texto sem delay quando opts não é passado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: "abc123evoid" } }));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado.ok).toBe(true);
    expect(resultado.tentativas).toBe(1);
    expect(resultado.messageIdMascarado).toBe("...3evoid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://evolution.exemplo.com/message/sendText/chefebot");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", apikey: "chave-teste" });
    expect(JSON.parse(init.body)).toEqual({ number: "5511999998888", text: "oi" });
  });

  test("nunca envia o link legado do cardápio para a Evolution", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk());
    vi.stubGlobal("fetch", fetchMock);

    await enviarTextoWhatsApp(
      "5511999998888",
      "Cardápio: https://chefebot-pjif.vercel.app/cardapio?token=cliente-123",
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.text).toBe("Cardápio: https://chefedapizza.com.br/cardapio?token=cliente-123");
    expect(body.text).not.toContain("chefebot-pjif.vercel.app");
  });

  test("inclui delay/options quando opts.delay é passado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk());
    vi.stubGlobal("fetch", fetchMock);

    await enviarTextoWhatsApp("5511999998888", "oi", { delay: 900 });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      number: "5511999998888",
      text: "oi",
      delay: 900,
      options: { delay: 900, presence: "composing" },
    });
  });

  test("HTTP 4xx nunca é retentado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toMatchObject({ ok: false, motivo: "http_400", statusHttp: 400, tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("HTTP 5xx é retentado uma vez e falha definitivamente após a 2ª tentativa", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toMatchObject({ ok: false, motivo: "http_503", statusHttp: 503, tentativas: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("HTTP 5xx seguido de sucesso na 2ª tentativa retorna ok:true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response)
      .mockResolvedValueOnce(respostaOk());
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado.ok).toBe(true);
    expect(resultado.tentativas).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("fluxo proativo com maxAttempts:1 não repete envio ambíguo após HTTP 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi", { maxAttempts: 1 });

    expect(resultado).toMatchObject({ ok: false, motivo: "http_503", tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("falha de rede ambígua não repete campanha, mas a próxima chamada pode enviar após reconexão", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(respostaOk());
    vi.stubGlobal("fetch", fetchMock);

    const falha = await enviarTextoWhatsApp("5511999998888", "ranking", { maxAttempts: 1 });
    expect(falha).toMatchObject({ ok: false, motivo: "network_error", tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const recuperado = await enviarTextoWhatsApp("5511999998888", "pedido confirmado");
    expect(recuperado).toMatchObject({ ok: true, tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("401 não dispara retry e não impede envio após a conexão voltar", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
      .mockResolvedValueOnce(respostaOk());
    vi.stubGlobal("fetch", fetchMock);

    const desconectado = await enviarTextoWhatsApp("5511999998888", "pedido saiu");
    expect(desconectado).toMatchObject({ ok: false, motivo: "http_401", tentativas: 1 });
    const reconectado = await enviarTextoWhatsApp("5511999998888", "pedido saiu");
    expect(reconectado).toMatchObject({ ok: true, tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("50 notificações transacionais simultâneas mantêm um resultado por destinatário", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respostaOk());
    vi.stubGlobal("fetch", fetchMock);

    const resultados = await Promise.all(Array.from({ length: 50 }, (_, index) =>
      enviarTextoWhatsApp(`55119999${String(index).padStart(4, "0")}`, `pedido ${index}`)
    ));

    expect(resultados).toHaveLength(50);
    expect(resultados.every((r) => r.ok && r.tentativas === 1)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(50);
    const destinatarios = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).number);
    expect(new Set(destinatarios).size).toBe(50);
  });

  test("erro de rede (fetch lançando) não propaga — vira ok:false motivo network_error após esgotar tentativas", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toMatchObject({ ok: false, motivo: "network_error", tentativas: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("timeout explícito: fetch que nunca resolve dispara abort e retorna motivo timeout", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi", { timeoutMs: 20 });

    expect(resultado.ok).toBe(false);
    expect(resultado.motivo).toBe("timeout");
    expect(resultado.tentativas).toBe(2);
  }, 10_000);
});
