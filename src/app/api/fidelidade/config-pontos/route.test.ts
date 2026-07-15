import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
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

import { GET, POST } from "./route";
import { salvarConfigFidelidade } from "@/lib/fidelidade";

function getRequest(token?: string) {
  const url = "http://localhost/api/fidelidade/config-pontos";
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

function postRequest(token: string | undefined, body: Record<string, unknown>) {
  const url = "http://localhost/api/fidelidade/config-pontos";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  store.clear();
});

describe("GET /api/fidelidade/config-pontos — autorizacao", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  test("token invalido retorna 401", async () => {
    const res = await GET(getRequest("token-lixo"));
    expect(res.status).toBe(401);
  });

  test("admin/dev/atendente conseguem ler a configuracao", async () => {
    for (const token of ["token-admin", "token-dev", "token-atendente"]) {
      const res = await GET(getRequest(token));
      expect(res.status).toBe(200);
    }
  });
});

describe("GET /api/fidelidade/config-pontos — ponte com o modelo legado", () => {
  test("chave nova ausente + legado ativo: retorna programa efetivo ativo", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    const res = await GET(getRequest("token-admin"));
    const body = await res.json();

    expect(body.ativo).toBe(true);
    expect(body.metaPontos).toBe(720);
    expect(body.descricaoRecompensa).toBe("1 Pizza Família");
  });

  test("chave nova ausente + legado inativo: retorna programa efetivo inativo", async () => {
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    const res = await GET(getRequest("token-admin"));
    const body = await res.json();

    expect(body.ativo).toBe(false);
  });

  test("chave nova presente e ativa: usa integralmente a config nova", async () => {
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await POST(postRequest("token-admin", { ativo: true, metaPontos: 300, descricaoRecompensa: "Combo especial" }));

    const res = await GET(getRequest("token-admin"));
    const body = await res.json();

    expect(body).toEqual({ ativo: true, metaPontos: 300, descricaoRecompensa: "Combo especial" });
  });

  test("chave nova presente e inativa: nao herda o legado ativo", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await POST(postRequest("token-admin", { ativo: false, metaPontos: 300, descricaoRecompensa: "Combo especial" }));

    const res = await GET(getRequest("token-admin"));
    const body = await res.json();

    expect(body.ativo).toBe(false);
  });
});

describe("POST /api/fidelidade/config-pontos — autorizacao", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(postRequest(undefined, { ativo: true, metaPontos: 500, descricaoRecompensa: "x" }));
    expect(res.status).toBe(401);
  });

  test("admin consegue salvar", async () => {
    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: 500, descricaoRecompensa: "x" }));
    expect(res.status).toBe(200);
  });

  test("dev consegue salvar", async () => {
    const res = await POST(postRequest("token-dev", { ativo: true, metaPontos: 500, descricaoRecompensa: "x" }));
    expect(res.status).toBe(200);
  });

  test("atendente consegue ler mas NAO consegue salvar (403)", async () => {
    const res = await POST(postRequest("token-atendente", { ativo: true, metaPontos: 500, descricaoRecompensa: "x" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/fidelidade/config-pontos — validacao e persistencia", () => {
  test("salva e grava exatamente na chave config:fidelidade:pontos", async () => {
    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: 500, descricaoRecompensa: "Desconto" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.config).toEqual({ ativo: true, metaPontos: 500, descricaoRecompensa: "Desconto" });
    expect(store.get("config:fidelidade:pontos")).toEqual({ ativo: true, metaPontos: 500, descricaoRecompensa: "Desconto" });
  });

  test("meta de pontos ausente e rejeitada (400), nada e salvo", async () => {
    const res = await POST(postRequest("token-admin", { ativo: true, descricaoRecompensa: "Desconto" }));
    expect(res.status).toBe(400);
    expect(store.has("config:fidelidade:pontos")).toBe(false);
  });

  test("meta de pontos zero ou negativa e rejeitada (400)", async () => {
    const resZero = await POST(postRequest("token-admin", { ativo: true, metaPontos: 0, descricaoRecompensa: "x" }));
    expect(resZero.status).toBe(400);

    const resNegativa = await POST(postRequest("token-admin", { ativo: true, metaPontos: -10, descricaoRecompensa: "x" }));
    expect(resNegativa.status).toBe(400);
  });

  test("meta de pontos nao numerica e rejeitada (400)", async () => {
    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: "abc", descricaoRecompensa: "x" }));
    expect(res.status).toBe(400);
  });

  test("descricao da recompensa vazia e rejeitada (400)", async () => {
    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: 500, descricaoRecompensa: "   " }));
    expect(res.status).toBe(400);
  });

  test("descricao da recompensa e cortada em 120 caracteres", async () => {
    const descricaoLonga = "x".repeat(200);
    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: 500, descricaoRecompensa: descricaoLonga }));
    const body = await res.json();
    expect(body.config.descricaoRecompensa).toHaveLength(120);
  });
});
