import { vi, describe, it, expect, beforeEach } from "vitest";

// Instrumento de discriminação do incidente real.
//
// Evidência de produção: connectionState "open", webhook registrado e correto,
// bot_ativo true — e mesmo assim `inboundLastSeenAt` parado há dias e nenhuma
// resposta do bot. Duas causas MUITO diferentes explicam exatamente isso:
//
//   H1 — a Evolution parou de entregar evento (sessão/transporte).
//   H2 — o evento chega normalmente, mas cai no filtro de JID individual
//        (`@lid` sem `remoteJidAlt`) e é descartado em silêncio.
//
// `inboundLastSeenAt` sozinho NÃO distingue as duas, porque só é gravado
// depois do filtro. Esta suíte prova que os marcadores novos distinguem.

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

vi.mock("@/lib/conversa", () => ({
  registrarMensagem: vi.fn(async () => {}),
  ultimasMensagensRelevantes: vi.fn(async () => []),
}));

const { enviarTextoWhatsAppMock } = vi.hoisted(() => ({
  enviarTextoWhatsAppMock: vi.fn(async (_phone: string, _texto: string) => ({
    ok: true,
    latenciaMs: 1,
    tentativas: 1,
  })),
}));
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarTextoWhatsAppMock }));

import { POST } from "./route";

const TELEFONE_REAL = "5599777776666";

function webhookLid(comRemoteJidAlt: boolean) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "218399119977665@lid",
          ...(comRemoteJidAlt ? { remoteJidAlt: `${TELEFONE_REAL}@s.whatsapp.net` } : {}),
          id: "wamid.TESTE-LID",
          fromMe: false,
        },
        message: { conversation: "oi" },
      },
    }),
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  enviarTextoWhatsAppMock.mockClear();
  store.set("bot_ativo", true);
  store.set("config:pizzaria", {
    nomePizzaria: "Chefe da Pizza",
    horaAbertura: 0,
    horaFechamento: 24,
    chavePix: "",
    nomeTitularPix: "",
    limitePico: 0,
  });
});

describe("telemetria que separa 'evento não chega' de 'evento chega e é descartado'", () => {
  it("LID sem remoteJidAlt: webhook marcado como recebido, inbound NÃO, e o descarte fica registrado", async () => {
    const res = await POST(webhookLid(false));
    expect((await res.json()).ok).toBe(true);

    // Transporte funcionou: a Evolution entregou o evento aqui.
    expect(store.get("whatsapp:diag:webhookLastSeenAt")).toBeTypeOf("number");
    expect(store.get("whatsapp:diag:webhookLastEvent")).toBe("messages.upsert");

    // Mas nada foi processado: é exatamente por isso que o inbound fica parado
    // sem que a Evolution tenha parado de entregar.
    expect(store.get("whatsapp:diag:inboundLastSeenAt")).toBeUndefined();
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();

    // E agora o motivo do descarte é observável.
    expect(store.get("whatsapp:diag:upsertDescartadoSufixo")).toBe("@lid");
    expect(store.get("whatsapp:diag:upsertDescartadoCampos")).toContain("remoteJid");

    // Sem PII: nem o LID nem o messageId podem ter sido persistidos.
    const gravado = JSON.stringify([...store.entries()]);
    expect(gravado).not.toContain("218399119977665");
    expect(gravado).not.toContain("wamid.TESTE-LID");
  });

  it("LID COM remoteJidAlt continua sendo processado normalmente (regressão do PR #409)", async () => {
    const res = await POST(webhookLid(true));
    expect((await res.json()).ok).toBe(true);

    expect(store.get("whatsapp:diag:webhookLastSeenAt")).toBeTypeOf("number");
    expect(store.get("whatsapp:diag:inboundLastSeenAt")).toBeTypeOf("number");
    expect(store.get("whatsapp:diag:upsertDescartadoLastAt")).toBeUndefined();
    expect(enviarTextoWhatsAppMock).toHaveBeenCalled();
  });

  it("evento de conexão também marca transporte vivo, sem tocar no inbound", async () => {
    const res = await POST({
      json: async () => ({ event: "connection.update", data: { state: "open" } }),
    } as never);
    expect((await res.json()).ok).toBe(true);

    expect(store.get("whatsapp:diag:webhookLastEvent")).toBe("connection.update");
    expect(store.get("whatsapp:diag:inboundLastSeenAt")).toBeUndefined();
  });
});
