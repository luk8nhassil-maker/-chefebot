import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
  },
}));

const adminToken = "tok-admin";
const devToken = "tok-dev";
const atendenteToken = "tok-atendente";

vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async (token: string) => {
    if (token === adminToken) return { role: "admin" };
    if (token === devToken) return { role: "dev" };
    if (token === atendenteToken) return { role: "atendente" };
    return null;
  }),
}));

import { GET, POST } from "./route";

function req(token: string | null, body?: unknown): NextRequest {
  const r = new NextRequest("http://localhost/api/admin/fidelidade/pontos-config", {
    method: body !== undefined ? "POST" : "GET",
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
  if (token) {
    Object.defineProperty(r, "cookies", {
      value: { get: (name: string) => name === "auth-token" ? { value: token } : undefined },
    });
  } else {
    Object.defineProperty(r, "cookies", { value: { get: () => undefined } });
  }
  return r;
}

beforeEach(() => {
  store.clear();
});

describe("GET /api/admin/fidelidade/pontos-config", () => {
  test("401 sem token", async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
  });

  test("401 para atendente", async () => {
    const res = await GET(req(atendenteToken));
    expect(res.status).toBe(401);
  });

  test("retorna default quando não há config salva", async () => {
    const res = await GET(req(adminToken));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ativo).toBe(false);
    expect(data.regraVersao).toBeUndefined();
  });

  test("retorna config salva com regraVersao", async () => {
    store.set("config:fidelidade:pontos", { ativo: true, regraVersao: "estrelas-faixas-v1", descricaoRecompensa: "Pizza" });
    const res = await GET(req(adminToken));
    const data = await res.json();
    expect(data.ativo).toBe(true);
    expect(data.regraVersao).toBe("estrelas-faixas-v1");
  });
});

describe("POST /api/admin/fidelidade/pontos-config", () => {
  test("401 sem token", async () => {
    const res = await POST(req(null, { ativo: true }));
    expect(res.status).toBe(401);
  });

  test("401 para atendente", async () => {
    const res = await POST(req(atendenteToken, { ativo: true }));
    expect(res.status).toBe(401);
  });

  test("ativa estrelas v1 com campos corretos", async () => {
    const res = await POST(req(adminToken, {
      ativo: true,
      regraVersao: "estrelas-faixas-v1",
      descricaoRecompensa: "Pizza grátis",
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.config.ativo).toBe(true);
    expect(data.config.regraVersao).toBe("estrelas-faixas-v1");
    expect(data.config.coberturaEconomicaAprovada).toBeUndefined();

    const saved = store.get("config:fidelidade:pontos") as Record<string, unknown>;
    expect(saved.regraVersao).toBe("estrelas-faixas-v1");
    expect(saved.coberturaEconomicaAprovada).toBeUndefined();
  });

  test("ativa estrelas sem descricaoRecompensa — campo não é inventado no Redis", async () => {
    // store vazio: nunca houve config salva
    const res = await POST(req(adminToken, {
      ativo: true,
      regraVersao: "estrelas-faixas-v1",
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.ativo).toBe(true);
    expect(data.config.regraVersao).toBe("estrelas-faixas-v1");
    expect(data.config.coberturaEconomicaAprovada).toBeUndefined();
    // descricaoRecompensa deve estar ausente — nunca inventar "1 Pizza Família"
    expect(data.config.descricaoRecompensa).toBeUndefined();

    const saved = store.get("config:fidelidade:pontos") as Record<string, unknown>;
    expect(saved.descricaoRecompensa).toBeUndefined();
  });

  test("ativa cobertura econômica separadamente", async () => {
    store.set("config:fidelidade:pontos", { ativo: true, regraVersao: "estrelas-faixas-v1", descricaoRecompensa: "Pizza" });
    const res = await POST(req(adminToken, { coberturaEconomicaAprovada: true }));
    const data = await res.json();
    expect(data.config.regraVersao).toBe("estrelas-faixas-v1");
    expect(data.config.coberturaEconomicaAprovada).toBe(true);
  });

  test("regraVersao inválida não ativa estrelas", async () => {
    const res = await POST(req(adminToken, { ativo: true, regraVersao: "versao-maliciosa" }));
    const data = await res.json();
    expect(data.config.regraVersao).toBeUndefined();
    expect(data.config.ativo).toBe(true);
  });

  test("regraVersao: null remove estrelas e cobertura (rollback)", async () => {
    store.set("config:fidelidade:pontos", {
      ativo: true,
      regraVersao: "estrelas-faixas-v1",
      coberturaEconomicaAprovada: true,
      metaEstrelas: 50,
      descricaoRecompensa: "Pizza",
    });
    const res = await POST(req(adminToken, { regraVersao: null }));
    const data = await res.json();
    expect(data.config.regraVersao).toBeUndefined();
    expect(data.config.coberturaEconomicaAprovada).toBeUndefined();
    expect(data.config.metaEstrelas).toBeUndefined();
  });

  test("ativo: false desativa sem apagar regraVersao", async () => {
    store.set("config:fidelidade:pontos", { ativo: true, regraVersao: "estrelas-faixas-v1", descricaoRecompensa: "Pizza" });
    const res = await POST(req(adminToken, { ativo: false }));
    const data = await res.json();
    expect(data.config.ativo).toBe(false);
    expect(data.config.regraVersao).toBe("estrelas-faixas-v1");
  });

  test("dev também pode escrever", async () => {
    const res = await POST(req(devToken, { ativo: true, regraVersao: "estrelas-faixas-v1", descricaoRecompensa: "Pizza" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test("metaEstrelas inválido é ignorado (preserva existente)", async () => {
    store.set("config:fidelidade:pontos", { ativo: true, regraVersao: "estrelas-faixas-v1", metaEstrelas: 50, descricaoRecompensa: "Pizza" });
    const res = await POST(req(adminToken, { metaEstrelas: -5 }));
    const data = await res.json();
    expect(data.config.metaEstrelas).toBe(50);
  });
});
