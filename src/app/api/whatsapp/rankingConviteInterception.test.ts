import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
      set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      keys: vi.fn(async () => []),
    },
  };
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
  processMessageMock: vi.fn(() => ({
    messages: ["resposta normal"],
    session: { step: "category", cart: [], deliveryFee: 0 },
  })),
}));
vi.mock("@/lib/bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bot")>();
  return { ...actual, processMessage: processMessageMock };
});

const { consumirOptOutMock } = vi.hoisted(() => ({
  consumirOptOutMock: vi.fn(async () => false),
}));
vi.mock("@/lib/rankingConviteWhatsapp", () => ({
  consumirOptOutConviteRankingWhatsapp: consumirOptOutMock,
}));

const { consumirRespostaPesquisaMock } = vi.hoisted(() => ({
  consumirRespostaPesquisaMock: vi.fn(async () => ({ consumida: false })),
}));
vi.mock("@/lib/pesquisaPreferenciaRespostaRedis", () => ({
  consumirRespostaPesquisaPendente: consumirRespostaPesquisaMock,
}));

const { enviarTextoWhatsAppMock } = vi.hoisted(() => ({
  enviarTextoWhatsAppMock: vi.fn(async (_phone: string, _text: string, _opts?: unknown) => ({
    ok: true,
    latenciaMs: 1,
    tentativas: 1,
  })),
}));
vi.mock("@/lib/whatsappMensagem", () => ({
  enviarTextoWhatsApp: enviarTextoWhatsAppMock,
}));

import { POST } from "./route";

const PHONE = "5586999990002";

function req(texto: string, id: string) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: `${PHONE}@s.whatsapp.net`,
          id,
          fromMe: false,
        },
        message: { conversation: texto },
      },
    }),
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("bot_ativo", true);
  store.set("config:pizzaria", {
    nomePizzaria: "Chefe da Pizza",
    horaAbertura: 0,
    horaFechamento: 24,
    chavePix: "",
    nomeTitularPix: "",
    limitePico: 0,
  });
  consumirOptOutMock.mockResolvedValue(false);
  consumirRespostaPesquisaMock.mockResolvedValue({ consumida: false });
  enviarTextoWhatsAppMock.mockResolvedValue({ ok: true, latenciaMs: 1, tentativas: 1 });
});

describe("Ranking no webhook WhatsApp após mover o gatilho para a cozinha", () => {
  test("responder avaliação não anexa mais convite do Ranking", async () => {
    store.set(`avaliacao:${PHONE}`, true);

    const res = await POST(req("5", "rating-sem-ranking-1"));

    expect(res.status ?? 200).toBe(200);
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    const textoEnviado = enviarTextoWhatsAppMock.mock.calls[0]?.[1] as string;
    expect(textoEnviado).toContain("5/5");
    expect(textoEnviado).not.toContain("Ranking");
    expect(textoEnviado).not.toContain("presente");
    expect(processMessageMock).not.toHaveBeenCalled();
  });

  test("SAIR RANKING continua sendo consumido antes do fluxo normal e recebe confirmação", async () => {
    consumirOptOutMock.mockResolvedValue(true);

    await POST(req("SAIR RANKING", "ranking-optout-1"));

    expect(consumirOptOutMock).toHaveBeenCalledWith({
      telefone: PHONE,
      resposta: "SAIR RANKING",
    });
    expect(processMessageMock).not.toHaveBeenCalled();
    expect(consumirRespostaPesquisaMock).not.toHaveBeenCalled();
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    expect((enviarTextoWhatsAppMock.mock.calls[0]?.[1] as string)).toContain("não receberá mais mensagens do Ranking");
  });

  test("nota inválida mantém a avaliação pendente para a próxima tentativa", async () => {
    store.set(`avaliacao:${PHONE}`, true);

    await POST(req("8", "rating-sem-ranking-2"));

    expect(store.get(`avaliacao:${PHONE}`)).toBe(true);
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    expect((enviarTextoWhatsAppMock.mock.calls[0]?.[1] as string)).toContain("número de 1 a 5");
  });
});
