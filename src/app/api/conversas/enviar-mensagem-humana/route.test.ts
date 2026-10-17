import { vi, describe, it, expect, beforeEach } from "vitest";

// Garante que POST /api/conversas/enviar-mensagem-humana renova manual:{phone}
// e session:{phone} com TTL 7200 após envio bem-sucedido pela Evolution API.

const { store, redisMock, jobs, enviarTextoMock, registrarOutboxMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const jobs = new Map<string, Record<string, unknown>>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { ex?: number }) => {
      void opts;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async () => 1),
  };
  const enviarTextoMock = vi.fn();
  const registrarOutboxMock = vi.fn(async (phone: string, autor: string, texto: string) => {
    await redisMock.set(`conversa:${phone}`, [{ autor, texto, ts: Date.now() }], { ex: 1800 });
    return true;
  });
  return { store, redisMock, jobs, enviarTextoMock, registrarOutboxMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/whatsappOutbox", () => ({
  enfileirarMensagemWhatsapp: vi.fn(async (input: Record<string, unknown>) => { const id = `job-${jobs.size + 1}`; jobs.set(id, { id, createdAt: Date.now(), attempt: 0, state: "pending", ...input }); return { jobId: id, deduplicated: false }; }),
  agendarDrenoWhatsapp: vi.fn(async () => false),
  reivindicarHistoricoMensagemHumana: vi.fn(async () => true),
  confirmarHistoricoMensagemHumana: vi.fn(async () => {}),
  processarFilaWhatsapp: vi.fn(async (executar: (job: { phone: string; text: string; opts?: unknown }) => Promise<unknown>) => { const [id, job] = [...jobs.entries()].find(([, j]) => j.state === "pending")!; const result = await executar(job as { phone: string; text: string; opts?: unknown }); jobs.set(id, { ...job, state: (result as { ok?: boolean }).ok ? "delivered" : "failed", attempt: 1, result }); return {}; }),
  obterJobWhatsapp: vi.fn(async (id: string) => jobs.get(id) ?? null),
}));
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarTextoMock }));
vi.mock("@/lib/conversa", () => ({ registrarMensagemOutbox: registrarOutboxMock }));

import { POST } from "./route";
import { createToken } from "@/lib/auth";

const PHONE = "5586988887777";

function postReq(body: unknown, token?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === "auth-token" && token ? { value: token } : undefined,
    },
    json: async () => body,
  } as never;
}

function mockFetchOk() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  enviarTextoMock.mockResolvedValue({ ok: true, latenciaMs: 1, tentativas: 1, jobId: "job-confirmed" });
}

function mockFetchFail() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
  enviarTextoMock.mockResolvedValue({ ok: false, motivo: "http_500", latenciaMs: 1, tentativas: 1 });
}

function mockFetchOkComMessageId(messageId: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ key: { id: messageId } }) })
  );
  enviarTextoMock.mockResolvedValue({ ok: true, latenciaMs: 1, tentativas: 1, jobId: "job-confirmed", messageIdInterno: messageId });
}

beforeEach(() => {
  store.clear();
  jobs.clear();
  vi.clearAllMocks();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
  // Conversa em atendimento humano por padrão
  store.set(`manual:${PHONE}`, true);
  mockFetchOk();
});

describe("POST /api/conversas/enviar-mensagem-humana — TTL 7200", () => {
  it("sem token retorna 401 e não grava no Redis", async () => {
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("409 quando conversa não está em atendimento humano", async () => {
    store.delete(`manual:${PHONE}`);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(409);
  });

  it("renova manual:{phone} com TTL 7200 após envio bem-sucedido", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Pedido confirmado!" }, token));
    expect(res.status).toBe(200);

    const manualCall = redisMock.set.mock.calls.find(([k]) =>
      k === `manual:${PHONE}`
    );
    expect(manualCall).toBeDefined();
    expect(manualCall?.[1]).toBe(true);
    expect(manualCall?.[2]).toEqual({ ex: 7200 });
  });

  it("renova session:{phone} com TTL 7200 quando sessão existe", async () => {
    const sessao = { step: "manual", cart: [] };
    store.set(`session:${PHONE}`, sessao);

    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    await POST(postReq({ phone: PHONE, text: "Seu pedido está a caminho!" }, token));

    const sessionCall = redisMock.set.mock.calls.find(([k]) =>
      k === `session:${PHONE}`
    );
    expect(sessionCall).toBeDefined();
    expect(sessionCall?.[1]).toEqual(sessao);
    expect(sessionCall?.[2]).toEqual({ ex: 7200 });
  });

  it("não renova TTL quando Evolution API retorna erro HTTP", async () => {
    mockFetchFail();
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(502);

    const manualRenewal = redisMock.set.mock.calls.find(([k]) =>
      k === `manual:${PHONE}`
    );
    expect(manualRenewal).toBeUndefined();
  });

  it("não renova TTL quando Evolution API lança exceção de rede", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    enviarTextoMock.mockResolvedValue({ ok: false, motivo: "network_error", latenciaMs: 1, tentativas: 1 });
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(502);

    const manualRenewal = redisMock.set.mock.calls.find(([k]) =>
      k === `manual:${PHONE}`
    );
    expect(manualRenewal).toBeUndefined();
  });

  it("202 identifica mensagem humana enfileirada sem registrá-la como enviada", async () => {
    enviarTextoMock.mockResolvedValue({ ok: false, motivo: "queued_pending", jobId: "job-pending", latenciaMs: 1, tentativas: 0 });
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Aguarde um momento" }, token));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, status: "queued", jobId: "job-pending" });
    expect(redisMock.set.mock.calls.some(([k]) => k === `conversa:${PHONE}`)).toBe(false);
    expect(redisMock.set.mock.calls.some(([k, value, opts]) => k === `manual:${PHONE}` && value === true && (opts as { ex?: number })?.ex === 7200)).toBe(true);
  });

  it("resultado incerto informa reconciliação e não induz reenvio", async () => {
    enviarTextoMock.mockResolvedValue({ ok: false, motivo: "timeout", jobId: "job-ambiguous", latenciaMs: 1, tentativas: 1 });
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Aguarde um momento" }, token));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, status: "ambiguous", jobId: "job-ambiguous" });
  });

  it("propaga clientMessageId como chave estável de idempotência", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    await POST(postReq({ phone: PHONE, text: "Pedido pronto", clientMessageId: "cliente-msg-123456" }, token));
    expect(enviarTextoMock).toHaveBeenCalledWith(PHONE, "Pedido pronto", expect.objectContaining({ idempotencyKey: `human:${PHONE}:cliente-msg-123456` }));
  });

  it("provider nao configurado retorna 503, nunca chama fetch, nunca vaza segredo", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// Etapa 2B: auditoria do retorno de envio da Evolution para deduplicação
// do eco fromMe no webhook (ver conversaEcoPainel.ts).
describe("POST /api/conversas/enviar-mensagem-humana — eco do painel (Etapa 2B)", () => {
  it("registra a mensagem e cria chave de eco com TTL quando a Evolution retorna key.id", async () => {
    mockFetchOkComMessageId("WHATS-MSG-ID-1");
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Seu pedido está pronto!" }, token));
    expect(res.status).toBe(200);

    const ecoCall = redisMock.set.mock.calls.find(([k]) => k === "conversa:echo-painel:WHATS-MSG-ID-1");
    expect(ecoCall).toBeDefined();
    expect(ecoCall?.[1]).toBe(true);
    expect(ecoCall?.[2]).toEqual({ ex: 600 });
    // A chave/valor não contêm texto, telefone ou nome da atendente.
    expect(ecoCall?.[0]).not.toContain(PHONE);
    expect(ecoCall?.[0]).not.toContain("Kellyne");
    expect(JSON.stringify(ecoCall)).not.toContain("Seu pedido está pronto");
  });

  it("falha no Redis de eco não transforma resposta confirmada em erro de envio", async () => {
    const original = redisMock.set.getMockImplementation();
    expect(original).toBeDefined();
    mockFetchOkComMessageId("WHATS-ECO-INDISPONIVEL");
    redisMock.set.mockImplementation(async (key, value, opts) => {
      if (key === "conversa:echo-painel:WHATS-ECO-INDISPONIVEL") throw new Error("eco indisponível");
      return original!(key, value, opts);
    });
    try {
      const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
      const res = await POST(postReq({ phone: PHONE, text: "Pedido pronto" }, token));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expect.objectContaining({ status: "delivered" }));
      expect(registrarOutboxMock).toHaveBeenCalledTimes(1);
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
    } finally {
      redisMock.set.mockImplementation(original!);
    }
  });

  it("registra a mensagem mesmo quando a Evolution não retorna message id, sem criar chave de eco inválida", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(200);

    const ecoCalls = redisMock.set.mock.calls.filter(([k]) => k.startsWith("conversa:echo-painel:"));
    expect(ecoCalls).toHaveLength(0);
  });

  it("registra a mensagem mesmo quando o corpo da resposta não é JSON válido (sem método json)", async () => {
    mockFetchOk(); // resposta sem .json()
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(200);

    const ecoCalls = redisMock.set.mock.calls.filter(([k]) => k.startsWith("conversa:echo-painel:"));
    expect(ecoCalls).toHaveLength(0);
  });

  it("falha no envio: não registra mensagem e não cria chave de eco", async () => {
    mockFetchFail();
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(502);

    const ecoCalls = redisMock.set.mock.calls.filter(([k]) => k.startsWith("conversa:echo-painel:"));
    expect(ecoCalls).toHaveLength(0);
  });

  it("marca a chave de eco ANTES de registrar a mensagem (fecha a janela de corrida do webhook fromMe)", async () => {
    mockFetchOkComMessageId("WHATS-MSG-ORDEM-1");
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Chegando em instantes!" }, token));
    expect(res.status).toBe(200);

    const chaves = redisMock.set.mock.calls.map(([k]) => k);
    const idxEco = chaves.indexOf("conversa:echo-painel:WHATS-MSG-ORDEM-1");
    const idxConversa = chaves.indexOf(`conversa:${PHONE}`);
    expect(idxEco).toBeGreaterThanOrEqual(0);
    expect(idxConversa).toBeGreaterThanOrEqual(0);
    expect(idxEco).toBeLessThan(idxConversa);
  });
});
