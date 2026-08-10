import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// A primeira mensagem de uma conversa nova nunca pode ficar sem resposta —
// nem quando o bot está pausado (global ou porque a conversa já foi
// assumida). O cliente recebe a saudação padrão (mensagemSaudacaoPadrao em
// src/lib/bot.ts) uma única vez, mesmo sem ninguém no comando ainda.

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

const { enviarTextoWhatsAppMock } = vi.hoisted(() => ({
  enviarTextoWhatsAppMock: vi.fn(async (_phone: string, _texto: string) => ({ ok: true, latenciaMs: 1, tentativas: 1 })),
}));
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarTextoWhatsAppMock }));

const { registrarMensagemMock } = vi.hoisted(() => ({
  registrarMensagemMock: vi.fn(async () => {}),
}));
vi.mock("@/lib/conversa", () => ({
  registrarMensagem: registrarMensagemMock,
  ultimasMensagensRelevantes: vi.fn(async () => []),
}));

const { processMessageMock } = vi.hoisted(() => ({ processMessageMock: vi.fn() }));
vi.mock("@/lib/bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bot")>();
  return { ...actual, processMessage: processMessageMock };
});

import { POST } from "./route";

const PHONE = "5599999990002";

function webhook(texto: string) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: `id-${Math.random()}`, fromMe: false },
        message: { conversation: texto },
      },
    }),
  } as never;
}

function mensagensEnviadasAoCliente(): string[] {
  return enviarTextoWhatsAppMock.mock.calls.map(([, texto]: [string, string]) => texto);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 19h em São Paulo: o cenário "bot ligado" precisa testar a saudação de
  // horário aberto independentemente da hora em que a suíte for executada.
  vi.setSystemTime(new Date("2026-08-10T22:00:00.000Z"));
  store.clear();
  vi.clearAllMocks();
  enviarTextoWhatsAppMock.mockResolvedValue({ ok: true, latenciaMs: 1, tentativas: 1 });
});

afterEach(() => vi.useRealTimers());

describe("bot global pausado (bot_ativo === false) + sem sessão prévia — primeira mensagem", () => {
  it("envia a saudação padrão automaticamente, mesmo sem ninguém assumir a conversa", async () => {
    store.set("bot_ativo", false);
    await POST(webhook("oi, quanto custa a pizza?"));

    expect(mensagensEnviadasAoCliente()).toHaveLength(1);
    expect(mensagensEnviadasAoCliente()[0]).toContain("Bem-vindo à *Chefe da Pizza*");
    expect(mensagensEnviadasAoCliente()[0]).toContain("cardápio digital");
    expect(mensagensEnviadasAoCliente()[0]).toContain("https://chefebot-pjif.vercel.app/cardapio");
  });

  it("dispara mesmo quando a primeira mensagem não é uma saudação (ex.: já pede direto)", async () => {
    store.set("bot_ativo", false);
    await POST(webhook("queria uma pizza calabresa grande"));
    expect(mensagensEnviadasAoCliente()).toHaveLength(1);
  });

  it("não processa o fluxo do bot — só a saudação, nada mais", async () => {
    store.set("bot_ativo", false);
    await POST(webhook("oi"));
    expect(processMessageMock).not.toHaveBeenCalled();
  });

  it("não repete a saudação na segunda mensagem da mesma conversa (já existe sessão)", async () => {
    store.set("bot_ativo", false);
    await POST(webhook("oi"));
    expect(mensagensEnviadasAoCliente()).toHaveLength(1);

    await POST(webhook("alguém pode me ajudar?"));
    expect(mensagensEnviadasAoCliente()).toHaveLength(1); // continua 1, não vira 2
  });

  it("se já existe sessão (conversa já em andamento) não manda a saudação de novo", async () => {
    store.set("bot_ativo", false);
    store.set(`session:${PHONE}`, { step: "escalado", cart: [], deliveryFee: 0, escalado: true });
    await POST(webhook("oi"));
    expect(mensagensEnviadasAoCliente()).toHaveLength(0);
  });
});

describe("bot ligado, cliente novo cumprimenta — mesma copy padrão", () => {
  it("saúda com a mesma mensagem padrão usada no caminho pausado", async () => {
    store.set("bot_ativo", true);
    await POST(webhook("oi"));

    const textos = mensagensEnviadasAoCliente();
    expect(textos[0]).toContain("Bem-vindo à *Chefe da Pizza*");
    expect(textos[0]).toContain("cardápio digital");
    expect(textos[0]).toContain("https://chefebot-pjif.vercel.app/cardapio");
  });
});
