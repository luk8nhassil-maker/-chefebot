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

const {
  prepararConviteMock,
  confirmarConviteMock,
  consumirOptOutMock,
} = vi.hoisted(() => ({
  prepararConviteMock: vi.fn(),
  confirmarConviteMock: vi.fn(async () => true),
  consumirOptOutMock: vi.fn(async () => false),
}));
vi.mock("@/lib/rankingConviteWhatsapp", () => ({
  prepararConviteRankingWhatsapp: prepararConviteMock,
  confirmarConviteRankingWhatsapp: confirmarConviteMock,
  consumirOptOutConviteRankingWhatsapp: consumirOptOutMock,
}));

const { consumirRespostaPesquisaMock } = vi.hoisted(() => ({
  consumirRespostaPesquisaMock: vi.fn(async () => ({ consumida: false })),
}));
vi.mock("@/lib/pesquisaPreferenciaRespostaRedis", () => ({
  consumirRespostaPesquisaPendente: consumirRespostaPesquisaMock,
}));

const { enviarTextoWhatsAppMock } = vi.hoisted(() => ({
  enviarTextoWhatsAppMock: vi.fn(async () => ({
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
  prepararConviteMock.mockResolvedValue({ status: "suprimido", motivo: "cooldown_14_dias" });
  confirmarConviteMock.mockResolvedValue(true);
  consumirOptOutMock.mockResolvedValue(false);
  consumirRespostaPesquisaMock.mockResolvedValue({ consumida: false });
  enviarTextoWhatsAppMock.mockResolvedValue({ ok: true, latenciaMs: 1, tentativas: 1 });
});

describe("convite persuasivo do Ranking no webhook WhatsApp", () => {
  test("nota 4/5 usa o pedido real como evento e anexa o convite à mesma mensagem", async () => {
    store.set(`avaliacao:${PHONE}`, "pedido-real-123");
    prepararConviteMock.mockResolvedValue({
      status: "pronto",
      exposureId: "exp-ranking-1",
      situacao: "progresso_estrelas",
      mensagem: "CONVITE CONTEXTUAL DO RANKING",
    });

    const res = await POST(req("5", "rating-ranking-1"));

    expect(res.status ?? 200).toBe(200);
    expect(prepararConviteMock).toHaveBeenCalledWith({
      telefone: PHONE,
      triggerEventId: "avaliacao:pedido-real-123",
      notaAvaliacao: 5,
    });
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    const textoEnviado = enviarTextoWhatsAppMock.mock.calls[0]?.[1] as string;
    expect(textoEnviado).toContain("5/5");
    expect(textoEnviado).toContain("CONVITE CONTEXTUAL DO RANKING");
    expect(confirmarConviteMock).toHaveBeenCalledWith({ exposureId: "exp-ranking-1" });
    expect(processMessageMock).not.toHaveBeenCalled();
  });

  test("convite suprimido mantém exatamente o agradecimento normal", async () => {
    store.set(`avaliacao:${PHONE}`, "pedido-real-124");
    prepararConviteMock.mockResolvedValue({ status: "suprimido", motivo: "ja_participa" });

    await POST(req("4", "rating-ranking-2"));

    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    const textoEnviado = enviarTextoWhatsAppMock.mock.calls[0]?.[1] as string;
    expect(textoEnviado).toContain("4/5");
    expect(textoEnviado).not.toContain("Ranking do Chefe");
    expect(confirmarConviteMock).not.toHaveBeenCalled();
  });

  test("falha interna do motor nunca impede o agradecimento da avaliação", async () => {
    store.set(`avaliacao:${PHONE}`, "pedido-real-125");
    prepararConviteMock.mockRejectedValue(new Error("redis_indisponivel"));

    const res = await POST(req("5", "rating-ranking-3"));

    expect(res.status ?? 200).toBe(200);
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    expect((enviarTextoWhatsAppMock.mock.calls[0]?.[1] as string)).toContain("5/5");
    expect(confirmarConviteMock).not.toHaveBeenCalled();
  });

  test("SAIR RANKING é consumido antes do fluxo normal e recebe confirmação", async () => {
    consumirOptOutMock.mockResolvedValue(true);

    await POST(req("SAIR RANKING", "ranking-optout-1"));

    expect(consumirOptOutMock).toHaveBeenCalledWith({
      telefone: PHONE,
      resposta: "SAIR RANKING",
    });
    expect(processMessageMock).not.toHaveBeenCalled();
    expect(consumirRespostaPesquisaMock).not.toHaveBeenCalled();
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    expect((enviarTextoWhatsAppMock.mock.calls[0]?.[1] as string)).toContain("não receberá mais convites do Ranking");
  });

  test("nota inválida preserva o pedidoId da avaliação para a próxima tentativa", async () => {
    store.set(`avaliacao:${PHONE}`, "pedido-real-126");

    await POST(req("8", "rating-ranking-4"));

    expect(store.get(`avaliacao:${PHONE}`)).toBe("pedido-real-126");
    expect(prepararConviteMock).not.toHaveBeenCalled();
  });
});
