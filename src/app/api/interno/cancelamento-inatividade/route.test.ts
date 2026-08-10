import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

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
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { verifyMock, receiverCtorMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(async () => true),
  receiverCtorMock: vi.fn(),
}));
vi.mock("@upstash/qstash", () => ({
  Receiver: class {
    constructor(config: unknown) {
      receiverCtorMock(config);
    }
    verify = verifyMock;
  },
}));

const { geracaoAtualMock } = vi.hoisted(() => ({
  geracaoAtualMock: vi.fn(async () => 1),
}));
vi.mock("@/lib/inatividadeConversa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inatividadeConversa")>();
  return { ...actual, geracaoAtualCronometroInatividade: geracaoAtualMock };
});

const { registrarMensagemMock, ultimasMensagensMock } = vi.hoisted(() => ({
  registrarMensagemMock: vi.fn(async () => {}),
  ultimasMensagensMock: vi.fn(async () => [{ autor: "bot", texto: "oi", ts: Date.now() }]),
}));
vi.mock("@/lib/conversa", () => ({
  registrarMensagem: registrarMensagemMock,
  ultimasMensagensRelevantes: ultimasMensagensMock,
}));

const { enviarTextoWhatsAppMock } = vi.hoisted(() => ({
  enviarTextoWhatsAppMock: vi.fn(async (_phone: string, _texto: string): Promise<{ ok: boolean; motivo?: string; latenciaMs?: number; tentativas?: number }> => ({ ok: true, latenciaMs: 1, tentativas: 1 })),
}));
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarTextoWhatsAppMock }));

const PHONE = "5586999990001";

function req(body: unknown, headers: Record<string, string> = { "upstash-signature": "sig-valida" }) {
  return new NextRequest("https://chefebot-pjif.vercel.app/api/interno/cancelamento-inatividade", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.clear();
  verifyMock.mockClear().mockResolvedValue(true);
  receiverCtorMock.mockClear();
  geracaoAtualMock.mockClear().mockResolvedValue(1);
  registrarMensagemMock.mockClear();
  ultimasMensagensMock.mockClear().mockResolvedValue([{ autor: "bot", texto: "oi", ts: Date.now() }]);
  enviarTextoWhatsAppMock.mockClear().mockResolvedValue({ ok: true, latenciaMs: 1, tentativas: 1 });
  process.env.QSTASH_CURRENT_SIGNING_KEY = "current-key";
  process.env.QSTASH_NEXT_SIGNING_KEY = "next-key";
  store.set(`session:${PHONE}`, { step: "category" });
});

afterEach(() => {
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
});

describe("/api/interno/cancelamento-inatividade — segurança/assinatura", () => {
  test("sem chaves de assinatura configuradas retorna 503 e não processa", async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    expect(res.status).toBe(503);
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("sem header de assinatura retorna 401", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }, {}));
    expect(res.status).toBe(401);
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("assinatura inválida retorna 401 e não envia nada", async () => {
    verifyMock.mockResolvedValueOnce(false);
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    expect(res.status).toBe(401);
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("corpo malformado retorna 200 ignorado", async () => {
    const { POST } = await import("./route");
    const reqInvalido = new NextRequest("https://chefebot-pjif.vercel.app/api/interno/cancelamento-inatividade", {
      method: "POST",
      headers: { "upstash-signature": "sig-valida" },
      body: "{ nao é json",
    });
    const res = await POST(reqInvalido);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignorado).toBe(true);
  });

  test("payload sem phone/geracao retorna 200 ignorado", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ geracao: 1 }));
    const json = await res.json();
    expect(json.ignorado).toBe(true);
  });
});

describe("/api/interno/cancelamento-inatividade — travas contra cancelamento indevido", () => {
  test("geração desatualizada (cliente ou nós respondemos de novo depois do agendamento): ignora", async () => {
    geracaoAtualMock.mockResolvedValueOnce(2);
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.ignorado).toBe(true);
    expect(json.motivo).toBe("geracao_antiga");
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("sessão já não existe mais (expirou ou já foi encerrada): ignora", async () => {
    store.delete(`session:${PHONE}`);
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.ignorado).toBe(true);
    expect(json.motivo).toBe("etapa_nao_elegivel");
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("sessão já virou 'done' nesse meio-tempo: ignora, nunca cancela um pedido concluído", async () => {
    store.set(`session:${PHONE}`, { step: "done" });
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.ignorado).toBe(true);
    expect(json.motivo).toBe("etapa_nao_elegivel");
  });

  test("sessão em 'aguardando_pix': ignora, é papel do Guardião Pix", async () => {
    store.set(`session:${PHONE}`, { step: "aguardando_pix" });
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.motivo).toBe("etapa_nao_elegivel");
  });

  test("última mensagem já é do cliente (ele respondeu): não cancela, mesmo com geração e etapa batendo", async () => {
    ultimasMensagensMock.mockResolvedValueOnce([{ autor: "cliente", texto: "oi de novo", ts: Date.now() }]);
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.ignorado).toBe(true);
    expect(json.motivo).toBe("cliente_ja_respondeu");
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("sem nenhuma mensagem registrada: não cancela", async () => {
    ultimasMensagensMock.mockResolvedValueOnce([]);
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.ignorado).toBe(true);
  });

  test("mesmo tick entregue duas vezes (retry do QStash) só cancela uma vez", async () => {
    const { POST } = await import("./route");
    await POST(req({ phone: PHONE, geracao: 1 }));
    const res2 = await POST(req({ phone: PHONE, geracao: 1 }));
    const json2 = await res2.json();
    expect(json2.duplicado).toBe(true);
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
  });
});

describe("/api/interno/cancelamento-inatividade — cancelamento efetivo", () => {
  test("última mensagem é do bot, tudo bate: cancela a sessão e manda a mensagem com o link do cardápio", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.cancelado).toBe(true);
    expect(store.has(`session:${PHONE}`)).toBe(false);

    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    const textoEnviado = enviarTextoWhatsAppMock.mock.calls[0][1];
    expect(textoEnviado).toContain("cardápio digital");
    expect(textoEnviado).toContain("https://chefebot-pjif.vercel.app/cardapio");

    expect(registrarMensagemMock).toHaveBeenCalledWith(PHONE, "bot", textoEnviado);
  });

  test("última mensagem é do atendente (não do bot): cancela normalmente também", async () => {
    ultimasMensagensMock.mockResolvedValueOnce([{ autor: "atendente", texto: "[Kellyne] oi", ts: Date.now() }]);
    store.set(`session:${PHONE}`, { step: "escalado" });
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.cancelado).toBe(true);
    expect(store.has(`session:${PHONE}`)).toBe(false);
  });

  test("também limpa manual:{phone} ao cancelar", async () => {
    store.set(`manual:${PHONE}`, true);
    const { POST } = await import("./route");
    await POST(req({ phone: PHONE, geracao: 1 }));
    expect(store.has(`manual:${PHONE}`)).toBe(false);
  });

  test("se o envio falhar, não registra mensagem falsa e reporta cancelado:false", async () => {
    enviarTextoWhatsAppMock.mockResolvedValueOnce({ ok: false, motivo: "http_500" });
    const { POST } = await import("./route");
    const res = await POST(req({ phone: PHONE, geracao: 1 }));
    const json = await res.json();
    expect(json.cancelado).toBe(false);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
    // A sessão já foi encerrada mesmo assim — não fica um estado "cancelamento pela metade".
    expect(store.has(`session:${PHONE}`)).toBe(false);
  });
});
