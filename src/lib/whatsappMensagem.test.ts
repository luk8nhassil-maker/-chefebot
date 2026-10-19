import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const { jobs } = vi.hoisted(() => ({ jobs: new Map<string, Record<string, unknown>>() }));
vi.mock("./whatsappDiag", () => ({ marcarTentativaEnvio: vi.fn(async () => {}) }));
vi.mock("./whatsappOutbox", () => ({
  enfileirarMensagemWhatsapp: vi.fn(async (input: Record<string, unknown>) => {
    const id = `job-${jobs.size + 1}`;
    jobs.set(id, { id, createdAt: Date.now(), attempt: 0, state: "pending", ...input });
    return { jobId: id, deduplicated: false };
  }),
  agendarDrenoWhatsapp: vi.fn(async () => false),
  processarFilaWhatsapp: vi.fn(async (executar: (job: { phone: string; text: string; opts?: unknown }) => Promise<unknown>) => {
    const [id, job] = [...jobs.entries()].find(([, value]) => value.state === "pending")!;
    jobs.set(id, { ...job, state: "leased" });
    const resultado = await executar(job as { phone: string; text: string; opts?: unknown });
    jobs.set(id, { ...job, attempt: 1, state: (resultado as { ok?: boolean }).ok ? "delivered" : "failed", result: resultado });
    return { processed: 1, delivered: (resultado as { ok?: boolean }).ok ? 1 : 0, failed: (resultado as { ok?: boolean }).ok ? 0 : 1, ambiguous: 0 };
  }),
  obterJobWhatsapp: vi.fn(async (id: string) => jobs.get(id) ?? null),
}));
import { executarJobWhatsapp, enviarImagemWhatsApp, enviarTextoWhatsApp, normalizarLinksPublicosWhatsApp, classificarFalhaEvolution400 } from "./whatsappMensagem";

const ENV_KEYS = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE_NAME", "VERCEL_ENV", "WHATSAPP_OUTBOX_ROLLOUT", "WHATSAPP_CANARY_PHONE"] as const;
const originais: Record<string, string | undefined> = {};

beforeEach(() => {
  jobs.clear();
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

describe("rollout controlado da outbox", () => {
  test("modo off não cria jobs e conserva envio legado com confirmação HTTP", async () => {
    process.env.WHATSAPP_OUTBOX_ROLLOUT = "off";
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: "EVO-DIRETO" } }));
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await enviarTextoWhatsApp("5511999998888", "mensagem real controlada");
    expect(resultado).toMatchObject({ ok: true, messageIdInterno: "EVO-DIRETO" });
    expect(resultado.jobId).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jobs.size).toBe(0);
  });

  test("modo canary só enfileira número autorizado e preserva demais clientes", async () => {
    process.env.WHATSAPP_OUTBOX_ROLLOUT = "canary";
    process.env.WHATSAPP_CANARY_PHONE = "+55 (11) 99999-8888";
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: "EVO-OK" } }));
    vi.stubGlobal("fetch", fetchMock);
    const direto = await enviarTextoWhatsApp("5511999997777", "fora do canário");
    expect(direto.jobId).toBeUndefined();
    expect(jobs.size).toBe(0);
    const canary = await enviarTextoWhatsApp("5511999998888", "autorizado");
    expect(canary.ok).toBe(true);
    expect(canary.jobId).toBeTruthy();
    expect(jobs.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["(11) 99999-8888", "5511999998888"],
    ["11 9999-8888", "551199998888"],
    ["+55 (11) 99999-8888", "5511999998888"],
  ])("canário local %s entra na outbox ao enviar para %s", async (configurado, normalizado) => {
    process.env.WHATSAPP_OUTBOX_ROLLOUT = "canary";
    process.env.WHATSAPP_CANARY_PHONE = configurado;
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: "EVO-CANARY" } }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await enviarTextoWhatsApp(normalizado, "teste controlado", { idempotencyKey: "canary:test-case" });
    expect(r).toMatchObject({ ok: true, statusHttp: 200, jobId: expect.any(String) });
    expect(jobs.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [job] = [...jobs.values()];
    expect(job.phone).toBe(normalizado);
  });

  test("número de cliente continua usando transporte direto, mesmo com canário local configurado", async () => {
    process.env.WHATSAPP_OUTBOX_ROLLOUT = "canary";
    process.env.WHATSAPP_CANARY_PHONE = "(11) 99999-8888";
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: "EVO-LEGADO" } }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await enviarTextoWhatsApp("5511999997777", "mensagem comercial");
    expect(r).toMatchObject({ ok: true, messageIdInterno: "EVO-LEGADO" });
    expect(r.jobId).toBeUndefined();
    expect(jobs.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("valor desconhecido e canário não configurado bloqueiam outbox sem bloquear envio legado", async () => {
    process.env.WHATSAPP_OUTBOX_ROLLOUT = "canary";
    delete process.env.WHATSAPP_CANARY_PHONE;
    const fetchMock = vi.fn().mockResolvedValue(respostaOk());
    vi.stubGlobal("fetch", fetchMock);
    expect((await enviarTextoWhatsApp("5511999998888", "teste")).jobId).toBeUndefined();
    process.env.WHATSAPP_OUTBOX_ROLLOUT = "valor-desconhecido";
    expect((await enviarTextoWhatsApp("5511999998888", "teste")).jobId).toBeUndefined();
    expect(jobs.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("enviarTextoWhatsApp", () => {
  test("Preview bloqueia antes da outbox síncrona e nunca chama a Evolution", async () => {
    process.env.VERCEL_ENV = "preview";
    const fetchMock = vi.fn().mockResolvedValue(respostaOk());
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await enviarTextoWhatsApp("5511999998888", "não pode sair");
    expect(resultado).toMatchObject({ ok: false, motivo: "preview_send_blocked", tentativas: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Preview também bloqueia imagem, inclusive quando chamada pelo caminho síncrono", async () => {
    process.env.VERCEL_ENV = "preview";
    const fetchMock = vi.fn().mockResolvedValue(respostaOk());
    vi.stubGlobal("fetch", fetchMock);
    await expect(enviarImagemWhatsApp("5511999998888", "https://cdn.test/comprovante.png")).resolves.toMatchObject({
      ok: false, motivo: "preview_send_blocked", tentativas: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Preview bloqueia também job pendente entregue diretamente ao worker", async () => {
    process.env.VERCEL_ENV = "preview";
    const fetchMock = vi.fn().mockResolvedValue(respostaOk());
    vi.stubGlobal("fetch", fetchMock);
    await expect(executarJobWhatsapp({ kind: "text", phone: "5511999998888", text: "pendente" } as never)).resolves.toMatchObject({
      ok: false, motivo: "preview_send_blocked", tentativas: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.runIf(process.env.CHEFEBOT_CAPACITY_BENCH === "1")("mede rajadas isoladas sem chamar a Evolution real", async () => {
    for (const total of [50, 100, 200]) {
      let emVoo = 0;
      let maxEmVoo = 0;
      const fetchMock = vi.fn(async () => {
        emVoo++;
        maxEmVoo = Math.max(maxEmVoo, emVoo);
        await new Promise((resolve) => setTimeout(resolve, 10));
        emVoo--;
        return respostaOk();
      });
      vi.stubGlobal("fetch", fetchMock);
      const resultados = await Promise.all(Array.from({ length: total }, (_, indice) =>
        enviarTextoWhatsApp(`55119999${String(indice).padStart(4, "0")}`, "teste isolado")));
      console.log(JSON.stringify({ benchmark: "envio-mock-isolado", total,
        aceitos: resultados.filter((r) => r.ok).length, maxEmVoo }));
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(total);
    }
  }, 15_000);
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

  test("HTTP 5xx é resultado incerto e nunca é repetido automaticamente", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toMatchObject({ ok: false, motivo: "http_503", statusHttp: 503, tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("não consome uma resposta posterior após 5xx, evitando duplicidade", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response)
      .mockResolvedValueOnce(respostaOk());
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toMatchObject({ ok: false, motivo: "http_502", tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  test("erro de rede vira resultado incerto após uma única tentativa", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await enviarTextoWhatsApp("5511999998888", "oi");

    expect(resultado).toMatchObject({ ok: false, motivo: "network_error", tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(resultado.tentativas).toBe(1);
  }, 10_000);
});


describe("resposta 400 da Evolution classificada sem vazar dados", () => {
  test.each([
    [{ response: { message: ["Error: not-acceptable"] } }, "http_400_nao_aceitavel"],
    [{ response: { message: ["The number is not registered on WhatsApp"] } }, "http_400_numero_nao_registrado"],
    [{ response: { message: ["SessionError: No sessions"] } }, "http_400_sessao_indisponivel"],
    [{ response: { message: ["Invalid number"] } }, "http_400_numero_invalido"],
    [{ response: { message: [['instance requires property "text"']] } }, "http_400_formato_invalido"],
    [{ response: { message: ["Unknown", "5511999998888"] } }, "http_400"],
    [{}, "http_400"],
  ])("categoria segura para resposta", (body, esperado) => {
    const motivo = classificarFalhaEvolution400(body);
    expect(motivo).toBe(esperado);
    expect(motivo).not.toMatch(/5511|apikey|messageId/i);
  });

  test("transporte retorna categoria segura na primeira recusa, sem retry", async () => {
    process.env.WHATSAPP_OUTBOX_ROLLOUT = "off";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ response: { message: ["Error: not-acceptable"] } }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const r = await enviarTextoWhatsApp("5511999998888", "teste controlado");
    expect(r).toMatchObject({ ok: false, motivo: "http_400_nao_aceitavel", statusHttp: 400, tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
