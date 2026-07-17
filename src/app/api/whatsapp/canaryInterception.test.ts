import { vi, describe, it, expect, beforeEach } from "vitest";

// Canário de diagnóstico (Etapa G) interceptado dentro do webhook real —
// garante que o round-trip do canário nunca é bloqueado pelos gates normais
// do cliente (bot_ativo, manual, spam) e nunca cria sessão/pedido, mesmo
// passando pelo POST completo de src/app/api/whatsapp/route.ts.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
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

const PHONE_CANARIO = "5599974000691";

function webhookMensagem(phone: string, texto: string, msgId = `id-${Math.random()}`) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, id: msgId, fromMe: false },
        message: { conversation: texto },
      },
    }),
  } as never;
}

function chamadasSendText() {
  return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/message/sendText/"));
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.exemplo.com");
  vi.stubEnv("EVOLUTION_API_KEY", "chave-teste");
  vi.stubEnv("WHATSAPP_CANARY_PHONE", PHONE_CANARIO);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response));
});

async function iniciarCanarioReal() {
  const { iniciarCanario } = await import("@/lib/whatsappCanary");
  const r = await iniciarCanario();
  vi.mocked(fetch).mockClear();
  return r.ok ? r.record.token : "";
}

describe("13. bot_ativo false continua pausando cliente normal", () => {
  it("cliente comum não recebe resposta quando bot_ativo=false, mesmo com canário configurado", async () => {
    store.set("bot_ativo", false);
    const res = await POST(webhookMensagem("5511999998888", "Quero uma pizza"));
    expect(res.status ?? 200).toBe(200);
    expect(chamadasSendText()).toHaveLength(0);
  });
});

describe("14. manual true continua pausando cliente normal", () => {
  it("cliente comum não recebe resposta automática quando manual:{phone}=true", async () => {
    store.set("manual:5511999998888", true);
    const res = await POST(webhookMensagem("5511999998888", "Quero uma pizza"));
    expect(res.status ?? 200).toBe(200);
    expect(chamadasSendText()).toHaveLength(0);
  });
});

describe("15. canário não é bloqueado por bot_ativo/manual/spam", () => {
  it("com bot_ativo=false e manual=true no número do canário, o round-trip ainda ocorre", async () => {
    const token = await iniciarCanarioReal();
    store.set("bot_ativo", false);
    store.set(`manual:${PHONE_CANARIO}`, true);
    store.set(`spam:${PHONE_CANARIO}`, 999);

    const res = await POST(webhookMensagem(PHONE_CANARIO, token));
    expect(res.status ?? 200).toBe(200);
    expect(chamadasSendText().length).toBeGreaterThan(0); // confirmação enviada
  });
});

describe("12. canário nunca cria pedido/sessão/carrinho", () => {
  it("nenhuma chave session:/pedidos é escrita ao processar o token do canário", async () => {
    const token = await iniciarCanarioReal();
    await POST(webhookMensagem(PHONE_CANARIO, token));

    for (const chave of store.keys()) {
      expect(chave.startsWith("session:")).toBe(false);
      expect(chave).not.toBe("pedidos");
    }
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });
});

describe("16. fromMe não cria resposta automática do canário", () => {
  it("mensagem fromMe=true com o token do canário não dispara nenhum ack", async () => {
    const token = await iniciarCanarioReal();
    const res = await POST({
      json: async () => ({
        event: "messages.upsert",
        data: {
          key: { remoteJid: `${PHONE_CANARIO}@s.whatsapp.net`, id: "id-frommecanary", fromMe: true },
          message: { conversation: token },
        },
      }),
    } as never);
    expect(res.status ?? 200).toBe(200);
    expect(chamadasSendText()).toHaveLength(0);
  });
});

describe("9. número diferente não ativa canário (nível webhook)", () => {
  it("mesmo texto do token, telefone diferente do autorizado segue fluxo normal do cliente", async () => {
    const token = await iniciarCanarioReal();
    const res = await POST(webhookMensagem("5511999998888", token));
    expect(res.status ?? 200).toBe(200);
    // Fluxo normal do cliente tenta responder normalmente (bot_ativo default true) —
    // não é o ack específico do canário.
    expect(registrarMensagemMock).toHaveBeenCalledWith("5511999998888", "cliente", token);
  });
});
