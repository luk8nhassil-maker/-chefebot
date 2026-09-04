import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      if (token === "token-admin") return { username: "brito", name: "Admin", role: "admin" };
      if (token === "token-dev") return { username: "ominix", name: "Dev", role: "dev" };
      if (token === "token-atendente") return { username: "kellyne", name: "Atendente", role: "atendente" };
      return null;
    }),
  };
});

const { salvarStatusConexao, garantirWebhookEvolution } = vi.hoisted(() => ({
  salvarStatusConexao: vi.fn(async () => {}),
  garantirWebhookEvolution: vi.fn(async () => ({ ok: true, status: 201 })),
}));
vi.mock("@/lib/conexaoWhatsapp", () => ({ salvarStatusConexao }));
vi.mock("@/lib/evolutionWebhook", () => ({ garantirWebhookEvolution }));

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

vi.stubGlobal("fetch", vi.fn());

import { POST } from "./route";

function req(token?: string) {
  return new NextRequest("http://localhost/api/whatsapp/trocar-numero", {
    method: "POST",
    headers: token ? { cookie: `auth-token=${token}` } : {},
  });
}

function response(status: number, data: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  salvarStatusConexao.mockClear();
  garantirWebhookEvolution.mockClear();
  redisMock.get.mockClear();
  redisMock.set.mockClear();
  redisMock.del.mockClear();
  store.clear();

  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
  process.env.EVOLUTION_INSTANCE_NAME = "chefebot";
  delete process.env.EVOLUTION_WEBHOOK_URL;

  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/whatsapp/trocar-numero — autenticação e fail-closed", () => {
  test("sem autenticação retorna 401 e não toca Evolution", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente não pode derrubar a conexão", async () => {
    const res = await POST(req("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("sem provider configurado falha sem chamada externa", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await POST(req("token-admin"));
    expect(res.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("lock concorrente bloqueia segundo reset antes de tocar Evolution", async () => {
    store.set("whatsapp:trocar-numero:lock:chefebot", "outro-token");
    const res = await POST(req("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.estado).toBe("busy");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/whatsapp/trocar-numero — caminho normal não destrutivo", () => {
  test("logout que fecha a sessão não apaga nem recria instância", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(200, { status: "SUCCESS" });
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "close" } });
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ ok: true, estado: "disconnected", recovery: "logout" });
    const urls = vi.mocked(fetch).mock.calls.map(c => String(c[0]));
    expect(urls.some(url => url.includes("/instance/delete/"))).toBe(false);
    expect(urls.some(url => url.includes("/instance/create"))).toBe(false);
    expect(salvarStatusConexao).toHaveBeenCalledWith("disconnected");
  });

  test("HTTP 500 no logout ainda é sucesso quando estado real fechou", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(500, { error: "provider bug" });
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "close" } });
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-dev"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.recovery).toBe("logout");
  });

  test("não executa hard reset se connectionState ficar indisponível", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(500);
      if (url.includes("/instance/connectionState/chefebot")) return response(502);
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.estado).toBe("provider_state_unavailable");
    const urls = vi.mocked(fetch).mock.calls.map(c => String(c[0]));
    expect(urls.some(url => url.includes("/instance/delete/"))).toBe(false);
  });
});

describe("POST /api/whatsapp/trocar-numero — recuperação da raiz do provider", () => {
  test("sessão que permanece open é removida e recriada com settings preservados", async () => {
    let deleted = false;
    let created = false;
    let settingsBody: unknown = null;

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("/instance/logout/chefebot")) return response(500, { error: "logout travado" });
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });

      if (url.includes("/instance/fetchInstances")) {
        if (deleted && !created) return response(200, []);
        return response(200, [{
          name: "chefebot",
          integration: "WHATSAPP-BAILEYS",
          connectionStatus: "open",
          number: "5599999999999",
        }]);
      }

      if (url.includes("/settings/find/chefebot")) {
        return response(200, {
          rejectCall: true,
          msgCall: "Não atendemos ligação por aqui.",
          groupsIgnore: true,
          alwaysOnline: false,
          readMessages: true,
          readStatus: false,
          syncFullHistory: false,
        });
      }

      if (url.includes("/instance/delete/chefebot")) {
        deleted = true;
        return response(500, { error: "resposta enganosa do provider" });
      }

      if (url.endsWith("/instance/create")) {
        created = true;
        return response(201, { base64: "data:image/png;base64,NOVOQR" });
      }

      if (url.includes("/settings/set/chefebot")) {
        settingsBody = JSON.parse(String((init as RequestInit)?.body));
        return response(201, { ok: true });
      }

      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      estado: "qr_required",
      recovery: "recreated",
    });
    expect(data.qrcode.base64).toContain("NOVOQR");

    expect(settingsBody).toEqual({
      rejectCall: true,
      msgCall: "Não atendemos ligação por aqui.",
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: true,
      readStatus: false,
      syncFullHistory: false,
    });
    expect(garantirWebhookEvolution).toHaveBeenCalledTimes(1);
    expect(salvarStatusConexao).toHaveBeenCalledWith("connecting");

    const urls = vi.mocked(fetch).mock.calls.map(c => String(c[0]));
    expect(urls.filter(url => url.includes("/instance/delete/chefebot"))).toHaveLength(1);
    expect(urls.filter(url => url.endsWith("/instance/create"))).toHaveLength(1);
    expect(urls.some(url => url.includes("/api/orders"))).toBe(false);
    expect(urls.some(url => url.includes("/pix"))).toBe(false);
  });

  test("não apaga nada se não conseguir preservar settings", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(500);
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });
      if (url.includes("/instance/fetchInstances")) {
        return response(200, [{ name: "chefebot", integration: "WHATSAPP-BAILEYS" }]);
      }
      if (url.includes("/settings/find/chefebot")) return response(500);
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.estado).toBe("settings_snapshot_failed");
    const urls = vi.mocked(fetch).mock.calls.map(c => String(c[0]));
    expect(urls.some(url => url.includes("/instance/delete/"))).toBe(false);
    expect(urls.some(url => url.endsWith("/instance/create"))).toBe(false);
  });

  test("configuração sensível bloqueia reset destrutivo antes do delete", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(500);
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });
      if (url.includes("/instance/fetchInstances")) {
        return response(200, [{ name: "chefebot", integration: "WHATSAPP-BAILEYS" }]);
      }
      if (url.includes("/settings/find/chefebot")) {
        return response(200, { alwaysOnline: true, wavoipToken: "segredo-que-nao-pode-ser-copiado" });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.estado).toBe("sensitive_settings_present");
    const urls = vi.mocked(fetch).mock.calls.map(c => String(c[0]));
    expect(urls.some(url => url.includes("/instance/delete/"))).toBe(false);
    expect(JSON.stringify(data)).not.toContain("segredo-que-nao-pode-ser-copiado");
  });

  test("integração diferente de Baileys é bloqueada antes do delete", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(500);
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });
      if (url.includes("/instance/fetchInstances")) {
        return response(200, [{ name: "chefebot", integration: "WHATSAPP-BUSINESS" }]);
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data.estado).toBe("unsupported_integration");
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/delete/"))).toBe(false);
  });

  test("delete que não remove a instância falha sem criar duplicata", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(500);
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });
      if (url.includes("/instance/fetchInstances")) {
        return response(200, [{ name: "chefebot", integration: "WHATSAPP-BAILEYS" }]);
      }
      if (url.includes("/settings/find/chefebot")) return response(200, { alwaysOnline: true });
      if (url.includes("/instance/delete/chefebot")) return response(500);
      // Sessão de fato viva: /instance/connect devolve o estado, sem QR — o
      // último recurso não destrutivo não tem o que entregar e o erro
      // original é preservado.
      if (url.includes("/instance/connect/chefebot")) {
        return response(200, { instance: { instanceName: "chefebot", state: "open" } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.estado).toBe("provider_delete_failed");
    // O status observado no delete precisa sobreviver até o admin — sem ele o
    // diagnóstico morre numa mensagem genérica.
    expect(data.error).toContain("500");
    const urls = vi.mocked(fetch).mock.calls.map(c => String(c[0]));
    expect(urls.some(url => url.endsWith("/instance/create"))).toBe(false);
  });

  test("se create falhar após delete, segundo clique retoma sem deletar novamente", async () => {
    let deleted = false;
    let createAttempts = 0;
    let deleteCalls = 0;

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("/instance/logout/chefebot")) return response(500);
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });

      if (url.includes("/instance/fetchInstances")) {
        return response(200, deleted ? [] : [{ name: "chefebot", integration: "WHATSAPP-BAILEYS" }]);
      }
      if (url.includes("/settings/find/chefebot")) return response(200, { readMessages: true });
      if (url.includes("/instance/delete/chefebot")) {
        deleteCalls += 1;
        deleted = true;
        return response(200);
      }
      if (url.endsWith("/instance/create")) {
        createAttempts += 1;
        if (createAttempts === 1) return response(500);
        return response(201, { base64: "data:image/png;base64,QR-RETOMADO" });
      }
      if (url.includes("/settings/set/chefebot")) {
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({ readMessages: true });
        return response(201);
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const first = await POST(req("token-admin"));
    const firstData = await first.json();
    expect(first.status).toBe(502);
    expect(firstData.estado).toBe("instance_recreate_failed");

    const second = await POST(req("token-admin"));
    const secondData = await second.json();
    expect(second.status).toBe(200);
    expect(secondData.qrcode.base64).toContain("QR-RETOMADO");
    expect(deleteCalls).toBe(1);
    expect(createAttempts).toBe(2);
  });

  // Incidente real (03/09): o painel mostrava "WhatsApp conectado / Bot ativo",
  // a Evolution respondia connectionState "open" e webhook correto, mas nenhuma
  // mensagem chegava havia 3 dias — sessão fantasma. Ao clicar em "Trocar
  // número", o logout não tirava do "open" e a Evolution RECUSAVA o
  // /instance/delete (versões que exigem a instância desconectada para apagar),
  // então o fluxo morria em "A Evolution não conseguiu remover a sessão
  // travada" e NENHUM QR aparecia — deixando o admin sem saída pelo painel.
  test("delete recusado pela Evolution ainda entrega QR novo sem remover a instância", async () => {
    let createChamado = false;
    let deleteChamado = false;

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/instance/logout/chefebot")) return response(200);
      // Sessão fantasma: continua "open" para a API mesmo depois do logout.
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });
      if (url.includes("/instance/fetchInstances")) {
        return response(200, [{ name: "chefebot", integration: "WHATSAPP-BAILEYS" }]);
      }
      if (url.includes("/settings/find/chefebot")) return response(200, { alwaysOnline: true });
      if (url.includes("/instance/delete/chefebot")) {
        deleteChamado = true;
        // A Evolution recusa remover enquanto a instância estiver "open".
        return response(400, { message: "The instance needs to be disconnected" });
      }
      // A sessão não tem vínculo real com o WhatsApp: o connect devolve QR novo.
      if (url.includes("/instance/connect/chefebot")) {
        return response(200, { base64: "data:image/png;base64,QR-SEM-REMOCAO" });
      }
      if (url.endsWith("/instance/create")) {
        createChamado = true;
        return response(201, {});
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.qrcode.base64).toContain("QR-SEM-REMOCAO");
    expect(data.recovery).toBe("qr_sem_remocao");

    // Garantia mais forte que "não recriou": quando pedir o QR já resolve, a
    // remoção NEM É TENTADA. Nada de destrutivo chega a sair daqui.
    expect(deleteChamado).toBe(false);
    expect(createChamado).toBe(false);

    // Sem etapa destrutiva pendente, a recuperação é encerrada — um segundo
    // clique não pode retomar um delete que nunca aconteceu.
    expect(await redisMock.get("whatsapp:trocar-numero:recovery:chefebot")).toBeNull();
    expect(salvarStatusConexao).toHaveBeenCalledWith("connecting");
  });

  test("QR entregue sem remoção mantém o webhook garantido", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(200);
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });
      if (url.includes("/instance/fetchInstances")) {
        return response(200, [{ name: "chefebot", integration: "WHATSAPP-BAILEYS" }]);
      }
      if (url.includes("/settings/find/chefebot")) return response(200, {});
      if (url.includes("/instance/delete/chefebot")) return response(400);
      if (url.includes("/instance/connect/chefebot")) {
        return response(200, { base64: "data:image/png;base64,QR-WEBHOOK" });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    expect(res.status).toBe(200);
    expect(garantirWebhookEvolution).toHaveBeenCalled();
  });

  test("falha de rede no connect preserva o erro original de remoção", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instance/logout/chefebot")) return response(200);
      if (url.includes("/instance/connectionState/chefebot")) return response(200, { instance: { state: "open" } });
      if (url.includes("/instance/fetchInstances")) {
        return response(200, [{ name: "chefebot", integration: "WHATSAPP-BAILEYS" }]);
      }
      if (url.includes("/settings/find/chefebot")) return response(200, {});
      if (url.includes("/instance/delete/chefebot")) return response(400);
      if (url.includes("/instance/connect/chefebot")) throw new Error("rede caiu");
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.estado).toBe("provider_delete_failed");
    expect(data.error).toContain("400");
  });
});
