import { vi, describe, it, expect, beforeEach } from "vitest";

// Canário de diagnóstico do WhatsApp (Etapa G) — testa a lógica central em
// isolamento do webhook: geração/validação de token, rate limit de início,
// telefone só vindo da env, e as transições de estado do round-trip.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const ttls = new Map<string, number>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      if (opts?.ex) ttls.set(key, opts.ex);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    ttl: vi.fn(async (key: string) => ttls.get(key) ?? -1),
  };
  return { store, redisMock };
});
vi.mock("./redis", () => ({ redis: redisMock }));

const { logMock } = vi.hoisted(() => ({ logMock: vi.fn(async () => {}) }));
vi.mock("./logger", () => ({ log: logMock }));

vi.stubGlobal("fetch", vi.fn());

import { iniciarCanario, processarPossivelInboundCanario, lerCanarioAtual } from "./whatsappCanary";

const PHONE_AUTORIZADO = "5599974000691";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.exemplo.com");
  vi.stubEnv("EVOLUTION_API_KEY", "chave-teste");
  vi.stubEnv("WHATSAPP_CANARY_PHONE", PHONE_AUTORIZADO);
  vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ key: { id: "evo-id-123" } }) } as Response);
});

describe("2. telefone vem apenas da env", () => {
  it("sem WHATSAPP_CANARY_PHONE, iniciarCanario recusa com provider_not_configured", async () => {
    vi.stubEnv("WHATSAPP_CANARY_PHONE", "");
    const r = await iniciarCanario();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("provider_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("4. rate limit", () => {
  it("permite o primeiro início e bloqueia o segundo dentro da janela de 5 minutos", async () => {
    const primeiro = await iniciarCanario();
    expect(primeiro.ok).toBe(true);

    const segundo = await iniciarCanario();
    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.motivo).toBe("rate_limited");
  });
});

describe("5. outbound confirmado", () => {
  it("marca outbound_sent com token válido no formato CBTEST-XXXX", async () => {
    const r = await iniciarCanario();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.state).toBe("outbound_sent");
      expect(r.record.token).toMatch(/^CBTEST-[A-Z0-9]{4}$/);
    }
  });
});

describe("6. outbound HTTP failure", () => {
  it("marca outbound_failed sem lançar", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    const r = await iniciarCanario();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.state).toBe("outbound_failed");
  });
});

describe("7. outbound network failure", () => {
  it("marca outbound_failed com motivo network_error/timeout sem lançar", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));
    const r = await iniciarCanario();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.state).toBe("outbound_failed");
      expect(r.record.outboundError).toBe("network_error");
    }
  });
});

describe("8. token errado não ativa canário", () => {
  it("retorna false e não altera o estado do canário ativo", async () => {
    await iniciarCanario();
    const antes = await lerCanarioAtual();
    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, "CBTEST-ERRADO", "msg-1");
    expect(ativou).toBe(false);
    const depois = await lerCanarioAtual();
    expect(depois?.state).toBe(antes?.state);
  });
});

describe("9. número diferente não ativa canário", () => {
  it("mesmo com o token correto, telefone diferente não ativa", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const ativou = await processarPossivelInboundCanario("5511999998888", token, "msg-2");
    expect(ativou).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1); // só o outbound inicial, nenhum ack
  });
});

describe("10 e 11. token correto + número autorizado marca inbound_received e roundtrip_ok", () => {
  it("processa o round-trip completo e envia confirmação", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";

    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-3");
    expect(ativou).toBe(true);

    const atual = await lerCanarioAtual();
    expect(atual?.state).toBe("roundtrip_ok");
    expect(atual?.inboundAt).toBeDefined();
    expect(atual?.ackAt).toBeDefined();
  });
});

describe("12. canário nunca cria pedido/sessão/carrinho", () => {
  it("não escreve nenhuma chave session:/pedidos ao processar o round-trip", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-4");

    for (const chave of store.keys()) {
      expect(chave.startsWith("session:")).toBe(false);
      expect(chave).not.toBe("pedidos");
    }
  });
});

describe("15. canário não é bloqueado por estado manual antigo do número de teste", () => {
  it("mesmo com manual:{phone}=true, processarPossivelInboundCanario ainda ativa o round-trip", async () => {
    store.set(`manual:${PHONE_AUTORIZADO}`, true);
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-5");
    expect(ativou).toBe(true);
  });
});

describe("18. duplicidade real não envia duas respostas", () => {
  it("o mesmo messageId processado duas vezes só dispara um ack", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";

    await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-dup");
    const chamadasAntes = vi.mocked(fetch).mock.calls.length;
    const ativouDeNovo = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-dup");
    expect(ativouDeNovo).toBe(true);
    expect(vi.mocked(fetch).mock.calls.length).toBe(chamadasAntes); // nenhum novo fetch
  });
});

describe("20. logs sem telefone/texto/segredo", () => {
  it("nenhuma chamada de log() inclui o telefone completo ou a API key", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-6");

    for (const chamada of logMock.mock.calls) {
      const textoCompleto = JSON.stringify(chamada);
      expect(textoCompleto.includes(PHONE_AUTORIZADO)).toBe(false);
      expect(textoCompleto.includes("chave-teste")).toBe(false);
    }
  });
});
