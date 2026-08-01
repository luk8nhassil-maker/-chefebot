import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
  return { store, redisMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifyToken: verifyTokenMock,
}));

import { GET } from "./route";

function req(telefone: string | null, comToken = true) {
  return {
    cookies: { get: (name: string) => (comToken && name === "auth-token" ? { value: "tok" } : undefined) },
    nextUrl: { searchParams: new URLSearchParams(telefone !== null ? { telefone } : {}) },
  } as never;
}

beforeEach(() => {
  store.clear();
  redisMock.get.mockClear();
  verifyTokenMock.mockReset();
  verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
});

describe("GET /api/admin/clientes/buscar-telefone — autorização", () => {
  it("bloqueia sem cookie de sessão", async () => {
    const res = await GET(req("86999998888", false));
    expect(res.status).toBe(401);
  });

  it("bloqueia papel não administrativo (ex.: entregador)", async () => {
    verifyTokenMock.mockResolvedValue({ username: "x", name: "X", role: "entregador" });
    const res = await GET(req("86999998888"));
    expect(res.status).toBe(401);
  });

  it("aceita admin, atendente e dev", async () => {
    for (const role of ["admin", "atendente", "dev"]) {
      verifyTokenMock.mockResolvedValue({ username: "x", name: "X", role });
      const res = await GET(req("86999998888"));
      expect(res.status).toBe(200);
    }
  });
});

describe("GET /api/admin/clientes/buscar-telefone — busca", () => {
  it("telefone com menos de 10 dígitos não busca no Redis e devolve não encontrado", async () => {
    const res = await GET(req("8699"));
    const data = await res.json();
    expect(data).toEqual({ ok: true, encontrado: false });
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it("sem parâmetro telefone devolve não encontrado, sem erro", async () => {
    const res = await GET(req(null));
    const data = await res.json();
    expect(data).toEqual({ ok: true, encontrado: false });
  });

  it("cliente cadastrado por correspondência normalizada exata devolve só o nome", async () => {
    store.set("perfil-cliente:86999998888", {
      clienteId: "cli_86999998888",
      telefone: "86999998888",
      nome: "Fernanda",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await GET(req("(86) 99999-8888"));
    const data = await res.json();
    expect(data).toEqual({ ok: true, encontrado: true, nome: "Fernanda" });
  });

  it("nunca devolve clienteId, telefone, pedidos ou qualquer outro campo do cadastro", async () => {
    store.set("perfil-cliente:86999998888", {
      clienteId: "cli_86999998888",
      telefone: "86999998888",
      nome: "Fernanda",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: "2026-01-01T00:00:00.000Z",
      fidelidadeAtivadaEm: "2026-01-01T00:00:00.000Z",
    });
    const res = await GET(req("86999998888"));
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(["encontrado", "nome", "ok"]);
  });

  it("cliente inexistente devolve encontrado=false, nunca 404 nem erro", async () => {
    const res = await GET(req("86977776666"));
    const data = await res.json();
    expect(data).toEqual({ ok: true, encontrado: false });
  });

  it("cliente cadastrado sem nome (perfil incompleto) conta como não encontrado", async () => {
    store.set("perfil-cliente:86999998888", {
      clienteId: "cli_86999998888",
      telefone: "86999998888",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await GET(req("86999998888"));
    const data = await res.json();
    expect(data).toEqual({ ok: true, encontrado: false });
  });

  it("falha do Redis devolve 503 sanitizado, nunca 500 cru", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("redis offline"));
    const res = await GET(req("86999998888"));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).not.toMatch(/redis offline/i);
  });
});
