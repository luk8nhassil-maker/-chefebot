import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifyToken: verifyTokenMock,
}));

import { GET, POST } from "./route";

function req(comToken: boolean) {
  return {
    cookies: { get: (nome: string) => (comToken && nome === "auth-token" ? { value: "tok" } : undefined) },
  } as never;
}
function postReq(body: unknown, comToken = true) {
  return {
    json: async () => body,
    cookies: { get: (nome: string) => (comToken && nome === "auth-token" ? { value: "tok" } : undefined) },
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  verifyTokenMock.mockResolvedValue({ username: "brito", name: "Brito", role: "admin" });
});

describe("GET /api/admin/salao/config", () => {
  it("bloqueia sem sessão", async () => {
    const res = await GET(req(false));
    expect(res.status).toBe(401);
  });

  it("bloqueia atendente (só admin/dev)", async () => {
    verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(req(true));
    expect(res.status).toBe(401);
  });

  it("aceita admin e dev, nunca devolve o código em texto claro", async () => {
    for (const role of ["admin", "dev"]) {
      verifyTokenMock.mockResolvedValue({ username: "x", name: "X", role });
      const res = await GET(req(true));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).not.toHaveProperty("codigoAcesso");
      expect(data).not.toHaveProperty("codigo");
    }
  });

  it("informa configurado:false quando nenhum código foi definido", async () => {
    const res = await GET(req(true));
    const data = await res.json();
    expect(data.configurado).toBe(false);
  });
});

describe("POST /api/admin/salao/config", () => {
  it("bloqueia sem sessão administrativa", async () => {
    const res = await POST(postReq({ codigo: "1234" }, false));
    expect(res.status).toBe(401);
  });

  it("recusa código curto demais", async () => {
    const res = await POST(postReq({ codigo: "12" }));
    expect(res.status).toBe(400);
  });

  it("define o código e ele passa a valer no /salao/login", async () => {
    const res = await POST(postReq({ codigo: "mesa2026" }));
    expect(res.status).toBe(200);
    const check = await GET(req(true));
    expect((await check.json()).configurado).toBe(true);
  });
});
