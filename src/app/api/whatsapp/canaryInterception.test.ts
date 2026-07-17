import { vi, describe, it, expect, beforeEach } from "vitest";

// Canário de diagnóstico (Etapa G) interceptado dentro do webhook real —
// garante que o round-trip do canário nunca é bloqueado pelos gates normais
// do cliente (bot_ativo, manual, spam) e nunca cria sessão/pedido, mesmo
// passando pelo POST completo de src/app/api/whatsapp/route.ts.

const { store, redisMock, hooks } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const hooks: { failGetOnceFor?: string } = {};
  const redisMock = {
    get: vi.fn(async (key: string) => {
      if (hooks.failGetOnceFor === key) {
        hooks.failGetOnceFor = undefined;
        throw new Error("redis_transient_test");
      }
      return store.has(key) ? store.get(key) : null;
    }),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length === 1) {
        if (store.get(keys[0]) !== args[0]) return 0;
        store.delete(keys[0]);
        return 1;
      }
      const [activeKey, lastKey] = keys;
      const [expectedToken, expectedRevision, serialized] = args;
      const current = store.get(activeKey) as { token?: string; revision?: number } | undefined;
      if (!current || current.token !== expectedToken || (current.revision ?? 0) !== Number(expectedRevision)) return 0;
      const record = JSON.parse(serialized);
      store.set(activeKey, record);
      store.set(lastKey, record);
      return 1;
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    ttl: vi.fn(async () => 30),
    keys: vi.fn(async () => []),
  };
  return { store, redisMock, hooks };
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

const PHONE_CANARIO = "5511900000000";

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
  hooks.failGetOnceFor = undefined;
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

  it("preserva sessão, carrinho e pedidos preexistentes sem registrar conversa", async () => {
    const sessaoExistente = { state: "MENU", cart: [{ item: "pizza", quantity: 1 }] };
    const pedidosExistentes = [{ id: "pedido-existente" }];
    store.set(`session:${PHONE_CANARIO}`, sessaoExistente);
    store.set("pedidos", pedidosExistentes);
    const token = await iniciarCanarioReal();

    await POST(webhookMensagem(PHONE_CANARIO, token, "id-preserva-dados"));

    expect(store.get(`session:${PHONE_CANARIO}`)).toEqual(sessaoExistente);
    expect(store.get("pedidos")).toEqual(pedidosExistentes);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });
});

describe("12A. token tardio do canário continua isolado do fluxo comercial", () => {
  it("não cria sessão, pedido ou histórico quando o token chega expirado", async () => {
    const token = await iniciarCanarioReal();
    const atual = store.get("whatsapp:canary:active") as { expiresAt: number };
    store.set("whatsapp:canary:active", { ...atual, expiresAt: Date.now() - 1 });
    vi.mocked(fetch).mockClear();

    await POST(webhookMensagem(PHONE_CANARIO, token, "id-token-expirado"));

    expect(chamadasSendText()).toHaveLength(0);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
    expect(store.has(`session:${PHONE_CANARIO}`)).toBe(false);
    expect(store.has("pedidos")).toBe(false);
  });

  it("não cai no bot normal ao receber nova entrega depois de roundtrip_ok", async () => {
    const token = await iniciarCanarioReal();
    await POST(webhookMensagem(PHONE_CANARIO, token, "id-roundtrip-primeiro"));
    vi.mocked(fetch).mockClear();
    registrarMensagemMock.mockClear();

    await POST(webhookMensagem(PHONE_CANARIO, token, "id-roundtrip-novo"));

    expect(chamadasSendText()).toHaveLength(0);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });
});

describe("16. fromMe não cria resposta automática do canário", () => {
  it("mensagem fromMe=true com o token do canário não dispara ack nem contamina o histórico", async () => {
    const token = await iniciarCanarioReal();
    const mensagens = [
      token,
      `Teste técnico do ChefeBot: ${token}\nResponda exatamente: ${token}`,
      "Teste concluído ✅ O ChefeBot recebeu sua resposta e respondeu pela produção.",
    ];

    for (const [index, texto] of mensagens.entries()) {
      const res = await POST({
        json: async () => ({
          event: "messages.upsert",
          data: {
            key: { remoteJid: `${PHONE_CANARIO}@s.whatsapp.net`, id: `id-frommecanary-${index}`, fromMe: true },
            message: { conversation: texto },
          },
        }),
      } as never);
      expect(res.status ?? 200).toBe(200);
    }
    expect(chamadasSendText()).toHaveLength(0);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
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

describe("17. texto comum do número autorizado continua no chatbot", () => {
  it("uma mensagem oi não é confundida com canário e entra no histórico normal", async () => {
    const res = await POST(webhookMensagem(PHONE_CANARIO, "oi", "id-oi-normal"));

    expect(res.status ?? 200).toBe(200);
    expect(registrarMensagemMock).toHaveBeenCalledWith(PHONE_CANARIO, "cliente", "oi");
  });
});

describe("18. lock de canário ocupado pede reentrega do webhook", () => {
  it("responde 503 sem cair no fluxo comercial enquanto o owner está processando", async () => {
    const token = await iniciarCanarioReal();
    const atual = store.get("whatsapp:canary:active") as Record<string, unknown>;
    store.set("whatsapp:canary:active", {
      ...atual,
      state: "inbound_received",
      inboundAt: Date.now(),
      expiresAt: Date.now() + 120_000,
    });
    store.set(`whatsapp:canary:ack-lock:${token}`, "owner-em-andamento");
    vi.mocked(fetch).mockClear();

    const res = await POST(webhookMensagem(PHONE_CANARIO, token, "id-lock-ocupado"));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(chamadasSendText()).toHaveLength(0);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });

  it("falha Redis transitória responde 503 e a reentrega conclui sem fluxo comercial", async () => {
    const token = await iniciarCanarioReal();
    hooks.failGetOnceFor = "whatsapp:canary:active";

    const primeira = await POST(webhookMensagem(PHONE_CANARIO, token, "id-redis-falha"));

    expect(primeira.status).toBe(503);
    expect(primeira.headers.get("Retry-After")).toBe("1");
    expect(chamadasSendText()).toHaveLength(0);
    expect(registrarMensagemMock).not.toHaveBeenCalled();

    const reentrega = await POST(webhookMensagem(PHONE_CANARIO, token, "id-redis-retry"));

    expect(reentrega.status).toBe(200);
    expect(chamadasSendText()).toHaveLength(1);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
    expect((store.get("whatsapp:canary:active") as { state: string }).state).toBe("roundtrip_ok");
  });
});
