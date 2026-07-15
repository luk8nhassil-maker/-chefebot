import { vi, describe, it, expect, beforeEach } from "vitest";

// Etapa 2B: mensagens textuais enviadas diretamente pelo WhatsApp Business da
// pizzaria (data.key.fromMe === true) devem ser registradas como "atendente"
// no histórico independentemente de manual:{phone} e bot_ativo, e o bot nunca
// pode responder a esse evento. Mensagens enviadas pelo painel
// (/api/conversas/enviar-mensagem-humana) marcam um eco no Redis por
// messageId — quando a Evolution devolve esse mesmo ID no webhook, o webhook
// não registra de novo.

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

const { processMessageMock } = vi.hoisted(() => ({
  processMessageMock: vi.fn(),
}));
vi.mock("@/lib/bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bot")>();
  return { ...actual, processMessage: processMessageMock };
});

import { POST } from "./route";
import { marcarEcoPainel } from "@/lib/conversaEcoPainel";

const PHONE = "5586999990001";

function webhookFromMe(overrides: Record<string, unknown> = {}, msgId = `id-${Math.random()}`) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: msgId, fromMe: true },
        message: { conversation: "Já estamos preparando sua pizza!" },
        ...overrides,
      },
    }),
  } as never;
}

function chamadasAtendente() {
  return registrarMensagemMock.mock.calls.filter(([, autor]: [string, string]) => autor === "atendente");
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => "" }));
});

describe("1. fromMe=true, bot ativo, manual false", () => {
  it("registra como atendente (comportamento que antes falhava)", async () => {
    store.set("bot_ativo", true);
    store.set(`manual:${PHONE}`, false);
    const res = await POST(webhookFromMe());
    expect(res.status ?? 200).toBe(200);
    expect(chamadasAtendente()).toHaveLength(1);
    expect(chamadasAtendente()[0][2]).toBe("Já estamos preparando sua pizza!");
  });
});

describe("2. fromMe=true, bot ativo, manual ausente", () => {
  it("registra normalmente", async () => {
    store.set("bot_ativo", true);
    const res = await POST(webhookFromMe());
    expect(res.status ?? 200).toBe(200);
    expect(chamadasAtendente()).toHaveLength(1);
  });
});

describe("3. fromMe=true, manual true", () => {
  it("continua registrando uma vez", async () => {
    store.set(`manual:${PHONE}`, true);
    const res = await POST(webhookFromMe());
    expect(res.status ?? 200).toBe(200);
    expect(chamadasAtendente()).toHaveLength(1);
  });
});

describe("4. fromMe=true, bot global false", () => {
  it("continua registrando uma vez", async () => {
    store.set("bot_ativo", false);
    const res = await POST(webhookFromMe());
    expect(res.status ?? 200).toBe(200);
    expect(chamadasAtendente()).toHaveLength(1);
  });
});

describe("5. Texto em conversation", () => {
  it("registra corretamente", async () => {
    await POST(webhookFromMe({ message: { conversation: "Texto via conversation" } }));
    expect(chamadasAtendente()[0][2]).toBe("Texto via conversation");
  });
});

describe("6. Texto em extendedTextMessage.text", () => {
  it("registra corretamente", async () => {
    await POST(webhookFromMe({ message: { extendedTextMessage: { text: "Texto via extendedTextMessage" } } }));
    expect(chamadasAtendente()[0][2]).toBe("Texto via extendedTextMessage");
  });
});

describe("7. Texto vazio", () => {
  it("não registra", async () => {
    await POST(webhookFromMe({ message: { conversation: "" } }));
    expect(chamadasAtendente()).toHaveLength(0);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });
});

describe("9. Eco fromMe com o mesmo message ID de um envio do painel", () => {
  it("não registra de novo e apaga a chave de deduplicação", async () => {
    await marcarEcoPainel("EVO-MSG-ECO-1");
    expect(store.has("conversa:echo-painel:EVO-MSG-ECO-1")).toBe(true);

    const res = await POST(webhookFromMe({}, "EVO-MSG-ECO-1"));
    expect(res.status ?? 200).toBe(200);
    expect(chamadasAtendente()).toHaveLength(0);
    expect(store.has("conversa:echo-painel:EVO-MSG-ECO-1")).toBe(false);
  });
});

describe("10. Dois textos iguais enviados diretamente pelo WhatsApp com IDs diferentes", () => {
  it("ambos são registrados — prova que não há dedup baseada só em texto", async () => {
    await POST(webhookFromMe({ message: { conversation: "Chegando em 10 minutos!" } }, "ID-A"));
    await POST(webhookFromMe({ message: { conversation: "Chegando em 10 minutos!" } }, "ID-B"));
    expect(chamadasAtendente()).toHaveLength(2);
    expect(chamadasAtendente()[0][2]).toBe("Chegando em 10 minutos!");
    expect(chamadasAtendente()[1][2]).toBe("Chegando em 10 minutos!");
  });
});

describe("13. Bot nunca responde a evento fromMe", () => {
  it("processMessage nunca é chamado", async () => {
    store.set("bot_ativo", true);
    await POST(webhookFromMe());
    expect(processMessageMock).not.toHaveBeenCalled();
  });
});
