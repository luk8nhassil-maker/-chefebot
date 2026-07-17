import { vi, describe, it, expect, beforeEach } from "vitest";

// Canário de diagnóstico do WhatsApp (Etapa G) — testa a lógica central em
// isolamento do webhook: geração/validação de token, rate limit de início,
// telefone só vindo da env, e as transições de estado do round-trip.

const { store, redisMock, hooks } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const ttls = new Map<string, number>();
  const hooks: { afterAckLockSet?: () => void | Promise<void> } = {};
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      if (opts?.ex) ttls.set(key, opts.ex);
      if (key.startsWith("whatsapp:canary:ack-lock:")) await hooks.afterAckLockSet?.();
      return "OK";
    }),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length === 1) {
        if (store.get(keys[0]) !== args[0]) return 0;
        store.delete(keys[0]);
        return 1;
      }
      const [activeKey, lastKey] = keys;
      const [expectedToken, expectedRevision, serialized, activeTtl, lastTtl] = args;
      const current = store.get(activeKey) as { token?: string; revision?: number } | undefined;
      if (!current || current.token !== expectedToken || (current.revision ?? 0) !== Number(expectedRevision)) return 0;
      const record = JSON.parse(serialized);
      store.set(activeKey, record);
      store.set(lastKey, record);
      ttls.set(activeKey, Number(activeTtl));
      ttls.set(lastKey, Number(lastTtl));
      return 1;
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    ttl: vi.fn(async (key: string) => ttls.get(key) ?? -1),
  };
  return { store, redisMock, hooks };
});
vi.mock("./redis", () => ({ redis: redisMock }));

const { logMock } = vi.hoisted(() => ({ logMock: vi.fn(async () => {}) }));
vi.mock("./logger", () => ({ log: logMock }));

vi.stubGlobal("fetch", vi.fn());

import {
  CanaryInboundRetryableError,
  iniciarCanario,
  processarPossivelInboundCanario,
  lerCanarioAtual,
} from "./whatsappCanary";

const PHONE_AUTORIZADO = "5511900000000";

beforeEach(() => {
  store.clear();
  hooks.afterAckLockSet = undefined;
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

  it("não sobrescreve um teste ativo mesmo se a janela curta de rate limit já tiver acabado", async () => {
    const primeiro = await iniciarCanario();
    expect(primeiro.ok).toBe(true);

    store.delete("whatsapp:canary:ratelimit");
    const segundo = await iniciarCanario();

    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.motivo).toBe("rate_limited");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("não deixa uma chave física legada bloquear depois do expiresAt lógico", async () => {
    const primeiro = await iniciarCanario();
    expect(primeiro.ok).toBe(true);
    const ativo = store.get("whatsapp:canary:active") as Record<string, unknown>;
    store.set("whatsapp:canary:active", { ...ativo, expiresAt: Date.now() - 1 });
    store.delete("whatsapp:canary:ratelimit");

    const segundo = await iniciarCanario();

    expect(segundo.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("5. outbound confirmado", () => {
  it("marca outbound_sent com token válido no formato CBTEST-XXXX", async () => {
    const r = await iniciarCanario();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.state).toBe("outbound_sent");
      expect(r.record.token).toMatch(/^CBTEST-[A-Z0-9]{4}$/);
      expect(r.record.outboundHttpStatus).toBe(200);
      expect(r.record.outboundAttempts).toBe(1);
      expect(r.record.outboundMessageIdMasked).toBe("...id-123");
      expect(r.record.transitions?.map((event) => event.state)).toEqual(["created", "outbound_sent"]);
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
    redisMock.eval.mockClear();

    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-3");
    expect(ativou).toBe(true);

    const atual = await lerCanarioAtual();
    expect(atual?.state).toBe("roundtrip_ok");
    expect(atual?.inboundAt).toBeDefined();
    expect(atual?.ackAt).toBeDefined();
    expect(atual?.ackHttpStatus).toBe(200);
    expect(atual?.ackAttempts).toBe(1);
    expect(atual?.transitions?.map((event) => event.state)).toEqual([
      "created",
      "outbound_sent",
      "inbound_received",
      "acknowledgement_sent",
      "roundtrip_ok",
    ]);
    const estadosPersistidos = redisMock.eval.mock.calls.map(([, , args]) => JSON.parse(args[2]).state);
    expect(estadosPersistidos).toEqual(["inbound_received", "acknowledgement_sent", "roundtrip_ok"]);
  });

  it("registra acknowledgement_failed quando a Evolution rejeita a confirmação", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ key: { id: "out-123" } }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) } as Response);

    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-ack-fail");

    expect(ativou).toBe(true);
    const atual = await lerCanarioAtual();
    expect(atual?.state).toBe("acknowledgement_failed");
    expect(atual?.ackError).toBe("http_403");
    expect(atual?.ackHttpStatus).toBe(403);
    expect(atual?.transitions?.map((event) => event.state)).toEqual([
      "created",
      "outbound_sent",
      "inbound_received",
      "acknowledgement_failed",
    ]);
  });

  it("alinha o TTL físico ao expiresAt estendido e não cria janela morta após falha tardia do ACK", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const ativo = store.get("whatsapp:canary:active") as { expiresAt: number };
    store.set("whatsapp:canary:active", { ...ativo, expiresAt: Date.now() + 5 });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) } as Response);

    await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-ack-tardio");

    const depois = store.get("whatsapp:canary:active") as { state: string; expiresAt: number };
    expect(depois.state).toBe("acknowledgement_failed");
    expect(depois.expiresAt).toBeGreaterThanOrEqual(Date.now() + 119_000);

    const novoInicio = await iniciarCanario();
    expect(novoInicio.ok).toBe(false);
    if (!novoInicio.ok) {
      expect(novoInicio.retryAfterSeconds).toBeGreaterThan(0);
      expect(novoInicio.retryAfterSeconds).toBeLessThanOrEqual(120);
    }
  });

  it("não regride roundtrip quando o inbound termina antes da resposta HTTP do outbound", async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      const ativo = store.get("whatsapp:canary:active") as { token: string };
      await processarPossivelInboundCanario(PHONE_AUTORIZADO, ativo.token, "msg-ultrarrapida");
      return { ok: true, status: 200, json: async () => ({ key: { id: "outbound-tardio-123456" } }) } as Response;
    });

    const iniciado = await iniciarCanario();

    expect(iniciado.ok).toBe(true);
    if (iniciado.ok) {
      expect(iniciado.record.state).toBe("roundtrip_ok");
      expect(iniciado.record.outboundHttpStatus).toBe(200);
      expect(iniciado.record.outboundMessageIdMasked).toBe("...123456");
      expect(iniciado.record.outboundAt).toBeLessThanOrEqual(iniciado.record.inboundAt!);
      expect(iniciado.record.transitions.map((event) => event.state)).toEqual([
        "created",
        "outbound_sent",
        "inbound_received",
        "acknowledgement_sent",
        "roundtrip_ok",
      ]);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("10A. CAS liveness durante a resposta outbound", () => {
  it("continua o inbound quando a evidencia outbound vence o CAS entre o lock e a persistencia", async () => {
    let liberarOutbound!: (response: Response) => void;
    let sinalizarOutboundSolicitado!: () => void;
    const outboundSolicitado = new Promise<void>((resolve) => {
      sinalizarOutboundSolicitado = resolve;
    });
    const respostaOutbound = new Promise<Response>((resolve) => {
      liberarOutbound = resolve;
    });
    let chamadaFetch = 0;
    vi.mocked(fetch).mockImplementation(() => {
      chamadaFetch += 1;
      if (chamadaFetch === 1) {
        sinalizarOutboundSolicitado();
        return respostaOutbound;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ key: { id: "ack-cas-1" } }),
      } as Response);
    });

    const inicioPendente = iniciarCanario();
    await outboundSolicitado;
    const criado = store.get("whatsapp:canary:active") as { token: string };
    hooks.afterAckLockSet = async () => {
      liberarOutbound({
        ok: true,
        status: 200,
        json: async () => ({ key: { id: "outbound-cas-1" } }),
      } as Response);
      await inicioPendente;
    };

    const consumido = await processarPossivelInboundCanario(PHONE_AUTORIZADO, criado.token, "msg-cas-antes-inbound");
    const iniciado = await inicioPendente;

    expect(consumido).toBe(true);
    expect(iniciado.ok).toBe(true);
    const atual = await lerCanarioAtual();
    expect(atual?.state).toBe("roundtrip_ok");
    expect(atual?.outboundHttpStatus).toBe(200);
    expect(atual?.transitions.map((event) => event.state)).toEqual([
      "created",
      "outbound_sent",
      "inbound_received",
      "acknowledgement_sent",
      "roundtrip_ok",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("continua o ACK quando a evidencia outbound vence o CAS durante o sendText", async () => {
    let liberarOutbound!: (response: Response) => void;
    let liberarAck!: (response: Response) => void;
    let sinalizarOutboundSolicitado!: () => void;
    let sinalizarAckSolicitado!: () => void;
    const outboundSolicitado = new Promise<void>((resolve) => {
      sinalizarOutboundSolicitado = resolve;
    });
    const ackSolicitado = new Promise<void>((resolve) => {
      sinalizarAckSolicitado = resolve;
    });
    const respostaOutbound = new Promise<Response>((resolve) => {
      liberarOutbound = resolve;
    });
    const respostaAck = new Promise<Response>((resolve) => {
      liberarAck = resolve;
    });
    let chamadaFetch = 0;
    vi.mocked(fetch).mockImplementation(() => {
      chamadaFetch += 1;
      if (chamadaFetch === 1) {
        sinalizarOutboundSolicitado();
        return respostaOutbound;
      }
      if (chamadaFetch === 2) {
        sinalizarAckSolicitado();
        return respostaAck;
      }
      throw new Error(`fetch inesperado #${chamadaFetch}`);
    });

    const inicioPendente = iniciarCanario();
    await outboundSolicitado;
    const criado = store.get("whatsapp:canary:active") as { token: string };
    const inboundPendente = processarPossivelInboundCanario(
      PHONE_AUTORIZADO,
      criado.token,
      "msg-cas-durante-ack"
    );
    await ackSolicitado;

    liberarOutbound({
      ok: true,
      status: 200,
      json: async () => ({ key: { id: "outbound-cas-2" } }),
    } as Response);
    await inicioPendente;
    liberarAck({ ok: true, status: 200, json: async () => ({ key: { id: "ack-cas-2" } }) } as Response);

    const consumido = await inboundPendente;

    expect(consumido).toBe(true);
    const atual = await lerCanarioAtual();
    expect(atual?.state).toBe("roundtrip_ok");
    expect(atual?.outboundHttpStatus).toBe(200);
    expect(atual?.ackHttpStatus).toBe(200);
    expect(atual?.transitions.map((event) => event.state)).toEqual([
      "created",
      "outbound_sent",
      "inbound_received",
      "acknowledgement_sent",
      "roundtrip_ok",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("persiste a falha do ACK após um bump concorrente e permite recuperação", async () => {
    let liberarOutbound!: (response: Response) => void;
    let liberarAckFalho!: (response: Response) => void;
    let sinalizarOutboundSolicitado!: () => void;
    let sinalizarAckSolicitado!: () => void;
    const outboundSolicitado = new Promise<void>((resolve) => {
      sinalizarOutboundSolicitado = resolve;
    });
    const ackSolicitado = new Promise<void>((resolve) => {
      sinalizarAckSolicitado = resolve;
    });
    const respostaOutbound = new Promise<Response>((resolve) => {
      liberarOutbound = resolve;
    });
    const respostaAckFalho = new Promise<Response>((resolve) => {
      liberarAckFalho = resolve;
    });
    let chamadaFetch = 0;
    vi.mocked(fetch).mockImplementation(() => {
      chamadaFetch += 1;
      if (chamadaFetch === 1) {
        sinalizarOutboundSolicitado();
        return respostaOutbound;
      }
      if (chamadaFetch === 2) {
        sinalizarAckSolicitado();
        return respostaAckFalho;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ key: { id: "ack-recovery" } }),
      } as Response);
    });

    const inicioPendente = iniciarCanario();
    await outboundSolicitado;
    const criado = store.get("whatsapp:canary:active") as { token: string };
    const primeiroInbound = processarPossivelInboundCanario(
      PHONE_AUTORIZADO,
      criado.token,
      "msg-cas-ack-falho"
    );
    await ackSolicitado;

    liberarOutbound({
      ok: true,
      status: 200,
      json: async () => ({ key: { id: "outbound-antes-falha" } }),
    } as Response);
    await inicioPendente;
    liberarAckFalho({ ok: false, status: 403, json: async () => ({}) } as Response);
    await primeiroInbound;

    expect((await lerCanarioAtual())?.state).toBe("acknowledgement_failed");
    expect(store.has(`whatsapp:canary:ack-lock:${criado.token}`)).toBe(false);

    await processarPossivelInboundCanario(PHONE_AUTORIZADO, criado.token, "msg-retry-ack");
    const recuperado = await lerCanarioAtual();
    expect(recuperado?.state).toBe("roundtrip_ok");
    expect(recuperado?.transitions.map((event) => event.state)).toEqual([
      "created",
      "outbound_sent",
      "inbound_received",
      "acknowledgement_failed",
      "inbound_received",
      "acknowledgement_sent",
      "roundtrip_ok",
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("10B. propriedade do lock de ACK", () => {
  it("um worker antigo não apaga o lock readquirido por outro worker", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    let liberarAckAntigo!: (response: Response) => void;
    let liberarAckNovo!: (response: Response) => void;
    let sinalizarAckAntigo!: () => void;
    let sinalizarAckNovo!: () => void;
    const ackAntigoSolicitado = new Promise<void>((resolve) => {
      sinalizarAckAntigo = resolve;
    });
    const ackNovoSolicitado = new Promise<void>((resolve) => {
      sinalizarAckNovo = resolve;
    });
    const respostaAckAntigo = new Promise<Response>((resolve) => {
      liberarAckAntigo = resolve;
    });
    const respostaAckNovo = new Promise<Response>((resolve) => {
      liberarAckNovo = resolve;
    });
    let chamadaAck = 0;
    vi.mocked(fetch).mockImplementation(() => {
      chamadaAck += 1;
      if (chamadaAck === 1) {
        sinalizarAckAntigo();
        return respostaAckAntigo;
      }
      sinalizarAckNovo();
      return respostaAckNovo;
    });

    const workerAntigo = processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-worker-antigo");
    await ackAntigoSolicitado;
    const lockKey = `whatsapp:canary:ack-lock:${token}`;
    const ownerAntigo = store.get(lockKey);
    store.delete(lockKey); // simula a expiração da lease do primeiro worker

    const workerNovo = processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-worker-novo");
    await ackNovoSolicitado;
    const ownerNovo = store.get(lockKey);
    expect(ownerNovo).not.toBe(ownerAntigo);

    liberarAckAntigo({ ok: false, status: 403, json: async () => ({}) } as Response);
    await workerAntigo;
    expect(store.get(lockKey)).toBe(ownerNovo);

    liberarAckNovo({ ok: true, status: 200, json: async () => ({ key: { id: "ack-worker-novo" } }) } as Response);
    await workerNovo;
    expect((await lerCanarioAtual())?.state).toBe("roundtrip_ok");
    expect(fetch).toHaveBeenCalledTimes(3); // outbound + os dois workers controlados
  });
});

describe("11A. tokens de canário nunca vazam para o fluxo normal", () => {
  it("intercepta token reconhecível do número autorizado mesmo sem teste ativo", async () => {
    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, "CBTEST-ABCD", "msg-sem-ativo");
    expect(ativou).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("intercepta resposta tardia depois da expiração sem enviar confirmação", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const atual = store.get("whatsapp:canary:active") as { expiresAt: number };
    store.set("whatsapp:canary:active", { ...atual, expiresAt: Date.now() - 1 });

    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-expirada");

    expect(ativou).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("intercepta nova entrega depois de roundtrip_ok sem enviar outro ack", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-primeira");
    const chamadasAntes = vi.mocked(fetch).mock.calls.length;

    const ativou = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-nova-entrega");

    expect(ativou).toBe(true);
    expect(vi.mocked(fetch).mock.calls.length).toBe(chamadasAntes);
  });

  it("eventos concorrentes sem messageId disparam uma única confirmação", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";

    const resultados = await Promise.allSettled([
      processarPossivelInboundCanario(PHONE_AUTORIZADO, token, undefined),
      processarPossivelInboundCanario(PHONE_AUTORIZADO, token, undefined),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
    const rejeitado = resultados.find((r) => r.status === "rejected");
    expect(rejeitado?.status).toBe("rejected");
    if (rejeitado?.status === "rejected") {
      expect(rejeitado.reason).toBeInstanceOf(CanaryInboundRetryableError);
    }
    expect(fetch).toHaveBeenCalledTimes(2); // outbound inicial + um único ack
  });

  it("CAS impede inbound antigo de sobrescrever uma nova geração na fronteira do TTL", async () => {
    const iniciado = await iniciarCanario();
    const tokenAntigo = iniciado.ok ? iniciado.record.token : "";
    const antigo = store.get("whatsapp:canary:active") as Record<string, unknown>;
    const novaGeracao = { ...antigo, token: "CBTEST-ZZZZ", createdAt: Date.now(), expiresAt: Date.now() + 600_000 };
    hooks.afterAckLockSet = () => store.set("whatsapp:canary:active", novaGeracao);

    const consumido = await processarPossivelInboundCanario(PHONE_AUTORIZADO, tokenAntigo, "msg-fronteira");

    expect(consumido).toBe(true);
    expect((store.get("whatsapp:canary:active") as { token: string }).token).toBe("CBTEST-ZZZZ");
    expect(fetch).toHaveBeenCalledTimes(1); // nenhum ACK da geração antiga
  });

  it("fecha acknowledgement_sent válido mesmo com o lock órfão ainda ativo", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const atual = store.get("whatsapp:canary:active") as {
      revision: number;
      transitions: Array<{ state: string; at: number }>;
    } & Record<string, unknown>;
    const ackAt = Date.now();
    store.set("whatsapp:canary:active", {
      ...atual,
      schemaVersion: 2,
      state: "acknowledgement_sent",
      revision: atual.revision + 1,
      ackAt,
      ackHttpStatus: 200,
      ackAttempts: 1,
      ackError: undefined,
      transitions: [...atual.transitions, { state: "acknowledgement_sent", at: ackAt }],
    });
    const lockKey = `whatsapp:canary:ack-lock:${token}`;
    store.set(lockKey, "owner-que-caiu");
    vi.mocked(fetch).mockClear();

    const consumido = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-recovery-ack");

    expect(consumido).toBe(true);
    expect((await lerCanarioAtual())?.state).toBe("roundtrip_ok");
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get(lockKey)).toBe("owner-que-caiu");
  });

  it("migra acknowledgement_sent legado com erro sem produzir falso roundtrip", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const atual = store.get("whatsapp:canary:active") as {
      phoneMascarado: string;
      createdAt: number;
      expiresAt: number;
      outboundAt?: number;
      outboundLatencyMs?: number;
    };
    const ackAt = Date.now();
    store.set("whatsapp:canary:active", {
      token,
      phoneMascarado: atual.phoneMascarado,
      state: "acknowledgement_sent",
      createdAt: atual.createdAt,
      expiresAt: atual.expiresAt,
      outboundAt: atual.outboundAt,
      outboundLatencyMs: atual.outboundLatencyMs,
      inboundAt: ackAt - 100,
      ackAt,
      ackError: "http_500",
    });
    vi.mocked(fetch).mockClear();

    expect((await lerCanarioAtual())?.state).toBe("acknowledgement_failed");
    await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-retry-legado");

    const recuperado = await lerCanarioAtual();
    expect(recuperado?.state).toBe("roundtrip_ok");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recuperado?.transitions.map((event) => event.state)).toEqual([
      "acknowledgement_sent",
      "acknowledgement_failed",
      "inbound_received",
      "acknowledgement_sent",
      "roundtrip_ok",
    ]);
  });

  it("recupera inbound_received depois que o lock curto expira dentro da lease ativa", async () => {
    const iniciado = await iniciarCanario();
    const token = iniciado.ok ? iniciado.record.token : "";
    const atual = store.get("whatsapp:canary:active") as Record<string, unknown>;
    store.set("whatsapp:canary:active", {
      ...atual,
      state: "inbound_received",
      inboundAt: Date.now(),
      expiresAt: Date.now() + 120_000,
    });
    store.delete(`whatsapp:canary:ack-lock:${token}`); // simula expiração após kill

    const consumido = await processarPossivelInboundCanario(PHONE_AUTORIZADO, token, "msg-recovery");

    expect(consumido).toBe(true);
    expect((store.get("whatsapp:canary:active") as { state: string }).state).toBe("roundtrip_ok");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("11B. expiração do histórico", () => {
  it("marca o último registro como expired mesmo depois de a chave active sumir", async () => {
    await iniciarCanario();
    const ultimo = store.get("whatsapp:canary:last") as { expiresAt: number };
    store.delete("whatsapp:canary:active");
    store.set("whatsapp:canary:last", { ...ultimo, expiresAt: Date.now() - 1 });

    const atual = await lerCanarioAtual();

    expect(atual?.state).toBe("expired");
    expect(atual?.transitions?.at(-1)?.state).toBe("expired");
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
