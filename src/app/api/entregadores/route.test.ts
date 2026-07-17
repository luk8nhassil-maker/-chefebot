import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
  };
  return { store, redisMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", () => ({ verifyToken: verifyTokenMock }));

import { GET, POST, DELETE } from "./route";

function reqGET(comToken = true) {
  return new NextRequest("https://x.test/api/entregadores", {
    headers: comToken ? { cookie: "auth-token=tok" } : {},
  });
}

function reqBody(method: string, body: unknown, comToken = true) {
  return new NextRequest("https://x.test/api/entregadores", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(comToken ? { cookie: "auth-token=tok" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.clear();
  verifyTokenMock.mockReset();
  redisMock.get.mockClear();
  redisMock.set.mockClear();
});

describe("GET /api/entregadores (leitura)", () => {
  it("401 sem cookie", async () => {
    const res = await GET(reqGET(false));
    expect(res.status).toBe(401);
  });

  it("403 role sem permissão (financeiro)", async () => {
    verifyTokenMock.mockResolvedValue({ role: "financeiro" });
    const res = await GET(reqGET());
    expect(res.status).toBe(403);
  });

  it("200 para atendente (call site real: /pedidos lê para atribuir entregador)", async () => {
    verifyTokenMock.mockResolvedValue({ role: "atendente" });
    const res = await GET(reqGET());
    expect(res.status).toBe(200);
  });

  it("200 para admin e dev", async () => {
    for (const role of ["admin", "dev"]) {
      verifyTokenMock.mockResolvedValue({ role });
      const res = await GET(reqGET());
      expect(res.status).toBe(200);
    }
  });

  it("403 para contador e entregador (sem call site)", async () => {
    for (const role of ["contador", "entregador"]) {
      verifyTokenMock.mockResolvedValue({ role });
      const res = await GET(reqGET());
      expect(res.status).toBe(403);
    }
  });
});

describe("POST /api/entregadores (cadastro/edição — só /admin chama)", () => {
  const novo = { nome: "João", telefone: "86988887777" };

  it("401 sem cookie", async () => {
    const res = await POST(reqBody("POST", novo, false));
    expect(res.status).toBe(401);
  });

  it("403 para atendente (lê mas não cadastra/edita)", async () => {
    verifyTokenMock.mockResolvedValue({ role: "atendente" });
    const res = await POST(reqBody("POST", novo));
    expect(res.status).toBe(403);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("200 para admin e cria o registro", async () => {
    verifyTokenMock.mockResolvedValue({ role: "admin" });
    const res = await POST(reqBody("POST", novo));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.entregador.nome).toBe("João");
  });

  it("200 para dev", async () => {
    verifyTokenMock.mockResolvedValue({ role: "dev" });
    const res = await POST(reqBody("POST", novo));
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/entregadores (remoção — só /admin chama)", () => {
  const body = { id: "1" };

  it("401 sem cookie", async () => {
    const res = await DELETE(reqBody("DELETE", body, false));
    expect(res.status).toBe(401);
  });

  it("403 para atendente", async () => {
    verifyTokenMock.mockResolvedValue({ role: "atendente" });
    const res = await DELETE(reqBody("DELETE", body));
    expect(res.status).toBe(403);
  });

  it("200 para admin", async () => {
    store.set("entregadores", [{ id: "1", nome: "x", telefone: "86988887777", ativo: true }]);
    verifyTokenMock.mockResolvedValue({ role: "admin" });
    const res = await DELETE(reqBody("DELETE", body));
    expect(res.status).toBe(200);
  });
});
