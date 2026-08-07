import { vi, describe, it, expect, beforeEach } from "vitest";

// Investigação da duplicidade de "Bem-vindo à Chefe da Pizza" relatada no
// WhatsApp real: cliente manda "oii" (recebe a saudação completa) e, logo em
// seguida, manda "boa noite" — e recebe a MESMA saudação completa de novo.
//
// Esta suíte reproduz DUAS causas raiz distintas encontradas na auditoria de
// src/app/api/whatsapp/route.ts, ambas do tipo "duas execuções concorrentes
// passam pela mesma verificação antes do estado ser salvo":
//
// 1) Sessão nova (POST() sem sessão em Redis): a rota cria a sessão com
//    step "welcome", manda as DUAS mensagens de boas-vindas, e só DEPOIS
//    grava o step final "category" — deixando uma janela em que uma segunda
//    mensagem real do cliente (que TAMBÉM bate em eSaudacao(), como
//    "boa noite") encontra `!currentSession` de novo ou lê o step "welcome"
//    intermediário e recebe a saudação completa outra vez.
//
// 2) Idempotência por messageId (msg_processed:<id>): o gate hoje é um
//    redis.get seguido de redis.set, não atômico — duas entregas
//    concorrentes do MESMO webhook (retry do provedor) podem passar as duas
//    pelo `get` antes de qualquer `set` ter efeito, processando e
//    respondendo duas vezes ao mesmo evento.
//
// Cada teste abaixo primeiro prova o bug (deve falhar no código atual) e,
// depois do patch mínimo em route.ts, passa a validar que o efeito externo
// (mensagem enviada ao cliente) acontece uma única vez.

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

// Barreira determinística: bloqueia a 1a chamada concorrente até a 2a chegar,
// então libera as duas "ao mesmo tempo" — simula duas execuções
// verdadeiramente concorrentes sem depender de timing/sleep real (nunca
// mascara a race condition com timeout artificial).
function criarBarreira() {
  let chegadas = 0;
  let resolvers: Array<() => void> = [];
  return async function aguardarSegundaChegada() {
    chegadas++;
    if (chegadas < 2) {
      await new Promise<void>((resolve) => resolvers.push(resolve));
    } else {
      resolvers.forEach((r) => r());
      resolvers = [];
    }
  };
}

const { sendGate, enviarTextoWhatsAppMock } = vi.hoisted(() => {
  const sendGate = { barreira: null as null | (() => Promise<void>) };
  const enviarTextoWhatsAppMock = vi.fn(async () => {
    if (sendGate.barreira) await sendGate.barreira();
    return { ok: true, latenciaMs: 1, tentativas: 1 };
  });
  return { sendGate, enviarTextoWhatsAppMock };
});
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarTextoWhatsAppMock }));

import { POST } from "./route";

const PHONE_A = "5599888880001";
const PHONE_B = "5599888880002";

function webhook(phone: string, texto: string, msgId?: string) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${phone}@s.whatsapp.net`, id: msgId ?? `id-${Math.random()}`, fromMe: false },
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
  sendGate.barreira = null;
  store.set("bot_ativo", true);
  // Horário de funcionamento amplo — os testes de concorrência não podem
  // depender do horário real em que rodam (mesma causa da única falha
  // conhecida do baseline em saudacaoPadraoBotPausado.test.ts).
  store.set("config:pizzaria", {
    nomePizzaria: "Chefe da Pizza",
    horaAbertura: 0,
    horaFechamento: 24,
    chavePix: "",
    nomeTitularPix: "",
    limitePico: 0,
  });
});

describe("CASO 1 — duas mensagens reais e distintas chegando quase juntas (sem sessão prévia)", () => {
  it("nao duplica a saudacao completa quando 'boa noite' chega enquanto a sessao de 'oii' ainda esta sendo criada", async () => {
    const barreira = criarBarreira();
    // A 1a mensagem ("oii") fica bloqueada bem no primeiro envio ao WhatsApp —
    // simula a 2a mensagem real do cliente chegando (outra invocação
    // serverless) antes do estado da 1a terminar de ser persistido.
    sendGate.barreira = barreira;

    const p1 = POST(webhook(PHONE_A, "oii"));
    // Deixa a 1a requisição avançar até ficar bloqueada no envio.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    sendGate.barreira = null; // a 2a mensagem processa normalmente, sem travar
    const p2 = POST(webhook(PHONE_A, "boa noite"));
    await p2;

    // Libera a 1a mensagem para terminar.
    barreira();
    await p1;

    expect(boasVindasCompletas()).toHaveLength(1);
  });
});

describe("CASO 2 — mesmo messageId entregue duas vezes (retry do provedor)", () => {
  it("responde apenas uma vez ao mesmo evento, mesmo com duas entregas concorrentes", async () => {
    const originalGet = redisMock.get.getMockImplementation()!;
    const originalSet = redisMock.set.getMockImplementation()!;
    const barreira = criarBarreira();
    redisMock.get.mockImplementation(async (key: string) => {
      if (key.startsWith("msg_processed:")) await barreira();
      return originalGet(key);
    });
    redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (key.startsWith("msg_processed:")) await barreira();
      return originalSet(key, value, opts);
    });

    const MESMO_ID = "wamid.mesma-entrega-retry";
    const [r1, r2] = await Promise.all([
      POST(webhook(PHONE_B, "oii", MESMO_ID)),
      POST(webhook(PHONE_B, "oii", MESMO_ID)),
    ]);
    void r1;
    void r2;

    expect(boasVindasCompletas()).toHaveLength(1);
  });
});

describe("regressão — comportamento normal continua intacto", () => {
  it("primeira mensagem sequencial (sem concorrência) ainda recebe a saudação padrão uma única vez", async () => {
    await POST(webhook(PHONE_A, "oii"));
    expect(boasVindasCompletas()).toHaveLength(1);
  });

  it("segunda mensagem após a sessão já estar em 'category' não repete a saudação completa", async () => {
    await POST(webhook(PHONE_A, "oii"));
    expect(boasVindasCompletas()).toHaveLength(1);
    await POST(webhook(PHONE_A, "boa noite"));
    expect(boasVindasCompletas()).toHaveLength(1);
  });
});
