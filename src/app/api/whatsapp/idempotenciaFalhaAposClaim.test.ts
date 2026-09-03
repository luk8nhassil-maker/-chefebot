import { vi, describe, it, expect, beforeEach } from "vitest";

// Investigação da hipótese apontada na auditoria: a chave de idempotência
// `msg_processed:{id}` (route.ts) é gravada com claim atômico (SET NX, TTL de
// 24h) ANTES de qualquer processamento real (sessão, pedido, resposta ao
// cliente). Isso é correto para impedir duplo processamento de duas entregas
// concorrentes do MESMO messageId — mas, no código anterior a este patch, se
// o processamento estourasse uma exceção DEPOIS do claim (Redis instável,
// bug, falha transitória), o catch global só logava e respondia `ok:true`,
// sem nunca reverter a chave. Resultado: a mensagem nunca chegava a ser
// respondida, e qualquer reentrega genuína do MESMO messageId pela Evolution
// (retry HTTP, ou resync de reconexão do Baileys reenviando mensagens
// recentes) era descartada em silêncio pelo resto do TTL de 24h — sem novo
// erro, sem novo log, sem qualquer segunda chance de responder ao cliente.
//
// Este teste reproduz exatamente esse cenário: falha real no meio do
// processamento da 1a entrega, seguida da reentrega (retry) do mesmo
// messageId. Antes do patch, a reentrega é engolida e o cliente nunca recebe
// a saudação. Depois do patch (catch reverte o claim), a reentrega reprocessa
// normalmente e o cliente recebe a resposta.

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
  enviarTextoWhatsAppMock: vi.fn(async (_phone: string, _texto: string) => ({ ok: true, latenciaMs: 1, tentativas: 1 })),
}));
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarTextoWhatsAppMock }));

import { POST } from "./route";

const PHONE = "5599888880003";
const MESMO_ID = "wamid.falha-depois-do-claim";

function webhook(texto: string, msgId: string) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: msgId, fromMe: false },
        message: { conversation: texto },
      },
    }),
  } as never;
}

function mensagensEnviadasAoCliente(): string[] {
  return enviarTextoWhatsAppMock.mock.calls.map(([, texto]: [string, string]) => texto);
}

function boasVindasCompletas(): string[] {
  return mensagensEnviadasAoCliente().filter((t) => t.includes("Bem-vindo à *Chefe da Pizza*"));
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

describe("idempotência do webhook — reversão do claim quando o processamento falha", () => {
  it("reentrega do mesmo messageId volta a ser respondida depois de uma falha real na 1a tentativa", async () => {
    const originalGet = redisMock.get.getMockImplementation()!;
    let jaFalhou = false;
    // Simula uma falha transitória real DEPOIS do claim de idempotência
    // (getConfig() é a primeira leitura de Redis depois da linha do claim).
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === "config:pizzaria" && !jaFalhou) {
        jaFalhou = true;
        throw new Error("Falha simulada de Redis durante o processamento");
      }
      return originalGet(key);
    });

    // 1a entrega: processamento estoura no meio, nenhuma resposta é enviada.
    const r1 = await POST(webhook("oii", MESMO_ID));
    expect((await r1.json()).ok).toBe(true);
    expect(boasVindasCompletas()).toHaveLength(0);

    // Reentrega do MESMO messageId (retry da Evolution ou resync de conexão).
    const r2 = await POST(webhook("oii", MESMO_ID));
    expect((await r2.json()).ok).toBe(true);

    // A reentrega deve ser reprocessada e o cliente deve finalmente receber a
    // saudação — não pode ficar descartada em silêncio pelo resto do TTL.
    expect(boasVindasCompletas()).toHaveLength(1);
  });

  it("comportamento normal (sem falha) continua idempotente: reentrega de mensagem já respondida não duplica", async () => {
    const r1 = await POST(webhook("oii", MESMO_ID));
    expect((await r1.json()).ok).toBe(true);
    expect(boasVindasCompletas()).toHaveLength(1);

    const r2 = await POST(webhook("oii", MESMO_ID));
    expect((await r2.json()).ok).toBe(true);

    // Já respondida com sucesso — reentrega não deve gerar uma segunda saudação.
    expect(boasVindasCompletas()).toHaveLength(1);
  });
});
