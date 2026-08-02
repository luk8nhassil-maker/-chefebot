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

import { POST } from "./route";
import { criarTokenSalao, definirCodigoAcessoSalao, lerSessaoSalao, SALAO_COOKIE } from "@/lib/salaoAuth";

function req(comToken: boolean) {
  return {
    cookies: { get: (nome: string) => (comToken && nome === "auth-token" ? { value: "tok" } : undefined) },
  } as never;
}
function reqComSessaoSalao(token: string) {
  return { cookies: { get: (nome: string) => (nome === SALAO_COOKIE ? { value: token } : undefined) } } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  verifyTokenMock.mockResolvedValue({ username: "brito", name: "Brito", role: "admin" });
});

describe("POST /api/admin/salao/revogar", () => {
  it("bloqueia sem sessão administrativa", async () => {
    const res = await POST(req(false));
    expect(res.status).toBe(401);
  });

  it("bloqueia atendente (só admin/dev)", async () => {
    verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(req(true));
    expect(res.status).toBe(401);
  });

  it("derruba uma sessão do Salão já ativa, sem trocar o código configurado", async () => {
    await definirCodigoAcessoSalao("mesa2026");
    const token = await criarTokenSalao();
    expect(await lerSessaoSalao(reqComSessaoSalao(token))).toEqual({ tipo: "salao" });

    const res = await POST(req(true));
    expect(res.status).toBe(200);

    expect(await lerSessaoSalao(reqComSessaoSalao(token))).toBeNull();
  });
});
