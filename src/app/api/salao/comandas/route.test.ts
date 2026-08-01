import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
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
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function reqSalao(token: string, query = "") {
  return {
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as never;
}
function reqAdmin(query = "") {
  return {
    cookies: { get: (n: string) => (n === "auth-token" ? { value: "tok" } : undefined) },
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as never;
}
function reqSemSessao() {
  return { cookies: { get: () => undefined }, nextUrl: { searchParams: new URLSearchParams() } } as never;
}
function postReqSalao(body: unknown, token: string) {
  return {
    json: async () => body,
    cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) },
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  verifyTokenMock.mockResolvedValue({ username: "brito", name: "Brito", role: "admin" });
});

describe("GET /api/salao/comandas", () => {
  it("bloqueia sem nenhuma sessão", async () => {
    const res = await GET(reqSemSessao());
    expect(res.status).toBe(401);
  });

  it("uma sessão do Salão consegue listar", async () => {
    const token = await criarTokenSalao();
    const res = await GET(reqSalao(token));
    expect(res.status).toBe(200);
  });

  it("uma sessão administrativa também consegue listar (visão do painel)", async () => {
    const res = await GET(reqAdmin());
    expect(res.status).toBe(200);
  });

  it("filtra por status quando informado", async () => {
    const token = await criarTokenSalao();
    await POST(postReqSalao({ mesa: "5" }, token));
    const abertas = await GET(reqSalao(token, "status=aberta"));
    const fechadas = await GET(reqSalao(token, "status=fechada"));
    expect((await abertas.json()).comandas).toHaveLength(1);
    expect((await fechadas.json()).comandas).toHaveLength(0);
  });
});

describe("POST /api/salao/comandas (abrir)", () => {
  it("bloqueia sem sessão do Salão (sessão administrativa não abre comanda)", async () => {
    const res = await POST({ json: async () => ({ mesa: "5" }), cookies: { get: () => ({ value: "tok" }) } } as never);
    expect(res.status).toBe(401);
  });

  it("abre uma comanda nova com mesa obrigatória", async () => {
    const token = await criarTokenSalao();
    const semMesa = await POST(postReqSalao({ mesa: "" }, token));
    expect(semMesa.status).toBe(400);

    const res = await POST(postReqSalao({ mesa: "5", complemento: "Varanda" }, token));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comanda.mesa).toBe("5");
    expect(data.comanda.complemento).toBe("Varanda");
    expect(data.comanda.status).toBe("aberta");
  });
});
