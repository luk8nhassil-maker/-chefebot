import { vi, describe, it, expect, beforeEach } from "vitest";

// Incidente de produção: /admin mostrava WhatsApp conectado (Evolution real),
// mas o webhook pausava a resposta automática porque whatsapp_connection_status
// no Redis ainda guardava um status antigo (disconnected/connecting) — a
// própria chegada de um messages.upsert real já prova que o canal de entrada
// está operacional, então ele não pode mais ser bloqueado só por esse cache
// desatualizado. Esta suíte comprova o patch em src/app/api/whatsapp/route.ts:
// nenhum early-return baseado só no status em cache, sincronização best-effort
// para "connected" a cada messages.upsert real, e que connection.update
// continua sendo a única fonte que grava "connecting"/"disconnected".

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    keys: vi.fn(async () => []),
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { registrarMensagemMock } = vi.hoisted(() => ({
  registrarMensagemMock: vi.fn(async () => {}),
}));
vi.mock("@/lib/conversa", () => ({
  registrarMensagem: registrarMensagemMock,
  ultimasMensagensRelevantes: vi.fn(async () => []),
}));

import { POST } from "./route";
import { persistirQrAtual } from "@/lib/whatsappQrCache";

const PHONE = "5586999990001";

function webhookMensagem(texto: string, overrides: Record<string, unknown> = {}) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: `id-${Math.random()}`, fromMe: false },
        message: { conversation: texto },
        ...overrides,
      },
    }),
  } as never;
}

function webhookConnectionUpdate(state: string) {
  return {
    json: async () => ({ event: "connection.update", data: { state } }),
  } as never;
}

function webhookEventoDesconhecido() {
  return {
    json: async () => ({ event: "messages.update", data: {} }),
  } as never;
}

function webhookQrAtualizado(evento: string, base64: string) {
  return {
    json: async () => ({ event: evento, data: { qrcode: { base64 } } }),
  } as never;
}

function qrCacheSalvo() {
  return store.get("whatsapp:qr:chefebot") as { base64: string; hash: string; generationId: number } | undefined;
}

function chamadasPorAutor(autor: string) {
  return registrarMensagemMock.mock.calls.filter(([, a]: [string, string]) => a === autor);
}

function statusConexaoSalvo() {
  return store.get("whatsapp_connection_status") as { status: string; atualizadoEm: string } | undefined;
}

function chamadasSendText() {
  return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/message/sendText/"));
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.exemplo.com");
  vi.stubEnv("EVOLUTION_API_KEY", "chave-teste");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => "" }));
});

describe("1. Redis marcado disconnected + messages.upsert real", () => {
  it("processa a mensagem, tenta o envio pela Evolution e sincroniza o status para connected", async () => {
    store.set("whatsapp_connection_status", { status: "disconnected", atualizadoEm: "2020-01-01T00:00:00.000Z" });

    const res = await POST(webhookMensagem("Oi, quero uma pizza"));

    expect(res.status ?? 200).toBe(200);
    expect(chamadasPorAutor("cliente")).toHaveLength(1);
    expect(chamadasSendText().length).toBeGreaterThan(0);
    expect(statusConexaoSalvo()?.status).toBe("connected");
    expect(statusConexaoSalvo()?.atualizadoEm).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("2. Redis marcado connecting + messages.upsert real", () => {
  it("não ocorre early-return silencioso — mensagem processada e envio tentado", async () => {
    store.set("whatsapp_connection_status", { status: "connecting", atualizadoEm: "2020-01-01T00:00:00.000Z" });

    const res = await POST(webhookMensagem("Oi, quero uma pizza"));

    expect(res.status ?? 200).toBe(200);
    expect(chamadasPorAutor("cliente")).toHaveLength(1);
    expect(chamadasSendText().length).toBeGreaterThan(0);
    expect(statusConexaoSalvo()?.status).toBe("connected");
  });
});

describe("3. connection.update com state close", () => {
  it("continua salvando disconnected", async () => {
    const res = await POST(webhookConnectionUpdate("close"));
    expect(res.status ?? 200).toBe(200);
    expect(statusConexaoSalvo()?.status).toBe("disconnected");
  });
});

describe("4. connection.update com state open", () => {
  it("continua salvando connected", async () => {
    const res = await POST(webhookConnectionUpdate("open"));
    expect(res.status ?? 200).toBe(200);
    expect(statusConexaoSalvo()?.status).toBe("connected");
  });
});

describe("5. Falha HTTP da Evolution no sendText", () => {
  it("não registra mensagem do bot no histórico", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => "erro" } as Response);

    const res = await POST(webhookMensagem("Oi, quero uma pizza"));

    expect(res.status ?? 200).toBe(200);
    expect(chamadasPorAutor("bot")).toHaveLength(0);
  });
});

describe("6. Falha de rede da Evolution", () => {
  it("não cria bolha falsa do bot e o webhook continua com tratamento seguro", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const res = await POST(webhookMensagem("Oi, quero uma pizza"));

    expect(res.status ?? 200).toBe(200);
    const data = await (res as Response).json?.();
    if (data !== undefined) expect(data).toEqual({ ok: true });
    expect(chamadasPorAutor("bot")).toHaveLength(0);
  });
});

describe("7. Eventos diferentes de messages.upsert/connection.update", () => {
  it("continuam ignorados sem regressão — nenhum processamento, nenhuma escrita de status", async () => {
    const res = await POST(webhookEventoDesconhecido());
    expect(res.status ?? 200).toBe(200);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
    expect(statusConexaoSalvo()).toBeUndefined();
  });
});

describe("9. QRCODE_UPDATED (e variações do nome) — antes descartado silenciosamente", () => {
  it("persiste o QR mais recente no cache, nunca loga o payload", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(webhookQrAtualizado("QRCODE_UPDATED", "data:image/png;base64,SEGREDO-QR"));
    expect(res.status ?? 200).toBe(200);
    expect(qrCacheSalvo()?.base64).toBe("data:image/png;base64,SEGREDO-QR");
    const textoLogs = logSpy.mock.calls.map((c) => JSON.stringify(c)).join(" ");
    expect(textoLogs).not.toContain("SEGREDO-QR");
    logSpy.mockRestore();
  });

  it("reconhece a variação dot-case 'qrcode.updated'", async () => {
    const res = await POST(webhookQrAtualizado("qrcode.updated", "data:image/png;base64,OUTRO"));
    expect(res.status ?? 200).toBe(200);
    expect(qrCacheSalvo()?.base64).toBe("data:image/png;base64,OUTRO");
  });

  it("um QR mais novo substitui o anterior no cache", async () => {
    await POST(webhookQrAtualizado("QRCODE_UPDATED", "data:image/png;base64,PRIMEIRO"));
    const primeiraGeracao = qrCacheSalvo()?.generationId;
    await POST(webhookQrAtualizado("QRCODE_UPDATED", "data:image/png;base64,SEGUNDO"));
    expect(qrCacheSalvo()?.base64).toBe("data:image/png;base64,SEGUNDO");
    expect(qrCacheSalvo()?.generationId).toBeGreaterThanOrEqual(primeiraGeracao ?? 0);
  });

  it("nunca escreve whatsapp_connection_status nem processa como mensagem", async () => {
    await POST(webhookQrAtualizado("QRCODE_UPDATED", "data:image/png;base64,X"));
    expect(statusConexaoSalvo()).toBeUndefined();
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });
});

describe("10. connection.update limpa o QR persistido quando sai de 'connecting'", () => {
  it("state 'open' limpa o QR do cache", async () => {
    await persistirQrAtual("chefebot", "data:image/png;base64,PENDENTE");
    expect(qrCacheSalvo()).toBeDefined();
    await POST(webhookConnectionUpdate("open"));
    expect(qrCacheSalvo()).toBeUndefined();
  });

  it("state 'close' também limpa o QR do cache (definitivamente inválido)", async () => {
    await persistirQrAtual("chefebot", "data:image/png;base64,PENDENTE");
    await POST(webhookConnectionUpdate("close"));
    expect(qrCacheSalvo()).toBeUndefined();
  });

  it("state 'connecting' NUNCA limpa o QR — é o estado normal de QR pendente", async () => {
    await persistirQrAtual("chefebot", "data:image/png;base64,PENDENTE");
    await POST(webhookConnectionUpdate("connecting"));
    expect(qrCacheSalvo()).toBeDefined();
  });
});

describe("8. fromMe", () => {
  it("continua sem resposta automática mesmo com o novo patch de sincronização", async () => {
    const res = await POST(
      webhookMensagem("Já estamos preparando sua pizza!", {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: `id-${Math.random()}`, fromMe: true },
      })
    );
    expect(res.status ?? 200).toBe(200);
    expect(chamadasPorAutor("atendente")).toHaveLength(1);
    expect(chamadasPorAutor("bot")).toHaveLength(0);
    expect(chamadasSendText()).toHaveLength(0);
  });
});
