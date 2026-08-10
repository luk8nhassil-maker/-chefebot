import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const CONFIG_MOCK = vi.hoisted(() => ({
  nomePizzaria: "Chefe da Pizza",
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: "chave-pix-secreta",
  nomeTitularPix: "Fulano de Tal",
  limitePico: 0,
  whatsappPizzaria: "5511999999999",
  tempoEntregaDelivery: "40-60 minutos",
  tempoEntregaRetirada: "20-30 minutos",
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(CONFIG_MOCK),
    set: vi.fn().mockResolvedValue("OK"),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      const role = { "token-admin": "admin", "token-dev": "dev", "token-atendente": "atendente" }[token];
      return role ? { username: `dev-${role}`, name: `Dev QA (${role})`, role } : null;
    }),
  };
});

import { redis } from "@/lib/redis";
import { GET, PATCH, POST } from "./route";

function requestComCookie(token?: string) {
  const url = "http://localhost/api/configuracoes";
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

function requestComBody(method: "POST" | "PATCH", token: string | undefined, body: Record<string, unknown>) {
  const url = "http://localhost/api/configuracoes";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
}

function postRequestComCookie(token: string | undefined, body: Record<string, unknown>) {
  return requestComBody("POST", token, body);
}

describe("GET /api/configuracoes — autorizacao e sanitizacao por role", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie());
    expect(res.status).toBe(401);
  });

  test("role admin retorna 200 com chavePix e nomeTitularPix", async () => {
    const res = await GET(requestComCookie("token-admin"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chavePix).toBe("chave-pix-secreta");
    expect(body.nomeTitularPix).toBe("Fulano de Tal");
  });

  test("role dev retorna 200 com chavePix e nomeTitularPix", async () => {
    const res = await GET(requestComCookie("token-dev"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chavePix).toBe("chave-pix-secreta");
    expect(body.nomeTitularPix).toBe("Fulano de Tal");
  });

  test("role atendente retorna 200 sem chavePix e sem nomeTitularPix", async () => {
    const res = await GET(requestComCookie("token-atendente"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chavePix).toBeUndefined();
    expect(body.nomeTitularPix).toBeUndefined();
    expect(body.nomePizzaria).toBe("Chefe da Pizza");
  });
});

describe("POST /api/configuracoes — autorizacao e protecao do Pix por role", () => {
  const payloadComPix = {
    nomePizzaria: "Chefe da Pizza",
    horaAbertura: 18,
    horaFechamento: 23,
    chavePix: "chave-pix-tentativa-invasora",
    nomeTitularPix: "Invasor",
    whatsappPizzaria: "5511999999999",
    tempoEntregaDelivery: "40-60 minutos",
    tempoEntregaRetirada: "20-30 minutos",
  };

  test("sem cookie retorna 401 e nao chama redis.set", async () => {
    vi.mocked(redis.set).mockClear();
    const res = await POST(postRequestComCookie(undefined, payloadComPix));
    expect(res.status).toBe(401);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("token invalido retorna 401 e nao chama redis.set", async () => {
    vi.mocked(redis.set).mockClear();
    const res = await POST(postRequestComCookie("token-inexistente", payloadComPix));
    expect(res.status).toBe(401);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("role admin salva com sucesso, incluindo chavePix e nomeTitularPix", async () => {
    const res = await POST(postRequestComCookie("token-admin", payloadComPix));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.config.chavePix).toBe("chave-pix-tentativa-invasora");
    expect(body.config.nomeTitularPix).toBe("Invasor");
  });

  test("role dev salva com sucesso, incluindo chavePix e nomeTitularPix", async () => {
    const res = await POST(postRequestComCookie("token-dev", payloadComPix));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.config.chavePix).toBe("chave-pix-tentativa-invasora");
    expect(body.config.nomeTitularPix).toBe("Invasor");
  });

  test("role atendente salva configuracao geral, mas chavePix/nomeTitularPix do body sao ignorados (preserva valor ja salvo)", async () => {
    const res = await POST(postRequestComCookie("token-atendente", payloadComPix));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.config.chavePix).toBeUndefined();
    expect(body.config.nomeTitularPix).toBeUndefined();
    expect(body.config.nomePizzaria).toBe("Chefe da Pizza");

    const configSalva = vi.mocked(redis.set).mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(configSalva.chavePix).toBe(CONFIG_MOCK.chavePix);
    expect(configSalva.nomeTitularPix).toBe(CONFIG_MOCK.nomeTitularPix);
  });
});

describe("PATCH /api/configuracoes — horario instantaneo", () => {
  test("atualiza somente o horario e preserva as demais configuracoes", async () => {
    vi.mocked(redis.set).mockClear();
    const res = await PATCH(requestComBody("PATCH", "token-admin", { horaAbertura: 18, horaFechamento: 23 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.config).toMatchObject({
      horaAbertura: 18,
      horaFechamento: 23,
      chavePix: CONFIG_MOCK.chavePix,
      limitePico: CONFIG_MOCK.limitePico,
    });
    expect(redis.set).toHaveBeenCalledWith("config:pizzaria", body.config);
  });

  test.each([
    { horaAbertura: -1, horaFechamento: 23 },
    { horaAbertura: 18, horaFechamento: 25 },
    { horaAbertura: 23, horaFechamento: 18 },
    { horaAbertura: 18.5, horaFechamento: 23 },
  ])("rejeita horario invalido sem alterar o Redis: $horaAbertura-$horaFechamento", async (payload) => {
    vi.mocked(redis.set).mockClear();
    const res = await PATCH(requestComBody("PATCH", "token-admin", payload));
    expect(res.status).toBe(400);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("exige autenticacao", async () => {
    vi.mocked(redis.set).mockClear();
    const res = await PATCH(requestComBody("PATCH", undefined, { horaAbertura: 18, horaFechamento: 23 }));
    expect(res.status).toBe(401);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
