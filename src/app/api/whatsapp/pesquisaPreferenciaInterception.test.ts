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
    messages: ["resposta normal do bot"],
    session: { step: "category", cart: [], deliveryFee: 0 },
  })),
}));
vi.mock("@/lib/bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bot")>();
  return {
    ...actual,
    processMessage: processMessageMock,
  };
});

const { consumirRespostaPesquisaMock } = vi.hoisted(() => ({
  consumirRespostaPesquisaMock: vi.fn(),
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

const PHONE = "5586999990001";

function req(texto: string, id = `msg-${Math.random()}`) {
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
  consumirRespostaPesquisaMock.mockResolvedValue({ consumida: false });
});

describe("interceptação de resposta do Motor de Preferência", () => {
  test("resposta pendente é registrada como inbound e não entra no fluxo de pedido", async () => {
    consumirRespostaPesquisaMock.mockResolvedValue({
      consumida: true,
      tipo: "resposta",
      exposureId: "exp-1",
    });

    const res = await POST(req("Foi a qualidade da pizza.", "research-reply-1"));

    expect(res.status ?? 200).toBe(200);
    expect(registrarMensagemMock).toHaveBeenCalledWith(
      PHONE,
      "cliente",
      "Foi a qualidade da pizza."
    );
    expect(consumirRespostaPesquisaMock).toHaveBeenCalledWith({
      telefone: PHONE,
      resposta: "Foi a qualidade da pizza.",
    });
    expect(processMessageMock).not.toHaveBeenCalled();
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("sem pesquisa pendente o fluxo normal permanece ativo", async () => {
    await POST(req("quero pizza", "normal-1"));

    expect(consumirRespostaPesquisaMock).toHaveBeenCalledWith({
      telefone: PHONE,
      resposta: "quero pizza",
    });
    expect(processMessageMock).toHaveBeenCalled();
  });

  test("avaliação 1–5 existente continua tendo prioridade sobre o Motor", async () => {
    store.set(`avaliacao:${PHONE}`, true);
    consumirRespostaPesquisaMock.mockResolvedValue({
      consumida: true,
      tipo: "resposta",
      exposureId: "exp-1",
    });

    await POST(req("5", "rating-1"));

    expect(consumirRespostaPesquisaMock).not.toHaveBeenCalled();
    expect(processMessageMock).not.toHaveBeenCalled();
    const avaliacoes = store.get("avaliacoes") as Array<{ nota: number }> | undefined;
    expect(avaliacoes?.at(-1)?.nota).toBe(5);
  });

  test("falha na persistência da resposta não deixa texto cair no pedido", async () => {
    consumirRespostaPesquisaMock.mockRejectedValue(
      new Error("research_response_write_failed")
    );

    const res = await POST(req("minha resposta", "research-fail-1"));

    expect((await res.json()).ok).toBe(true);
    expect(processMessageMock).not.toHaveBeenCalled();
    // O claim do webhook é revertido pelo catch global para permitir retry.
    expect(store.has("msg_processed:research-fail-1")).toBe(false);
  });
});
