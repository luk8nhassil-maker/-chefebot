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

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";
import { SALAO_COOKIE, definirCodigoAcessoSalao, lerSessaoSalao } from "@/lib/salaoAuth";

function req(body: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/salao/login", () => {
  it("recusa sem código configurado", async () => {
    const res = await POST(req({ codigo: "1234" }));
    expect(res.status).toBe(401);
  });

  it("recusa código vazio", async () => {
    await definirCodigoAcessoSalao("1234");
    const res = await POST(req({ codigo: "" }));
    expect(res.status).toBe(400);
  });

  it("recusa código errado", async () => {
    await definirCodigoAcessoSalao("1234");
    const res = await POST(req({ codigo: "9999" }));
    expect(res.status).toBe(401);
  });

  it("aceita o código certo e grava um cookie de sessão do Salão válido", async () => {
    await definirCodigoAcessoSalao("1234");
    const res = await POST(req({ codigo: "1234" }));
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(SALAO_COOKIE);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);

    const sessao = await lerSessaoSalao({ cookies: { get: () => ({ value: cookie!.value }) } } as never);
    expect(sessao).toEqual({ tipo: "salao" });
  });

  it("payload inválido devolve 400, nunca 500", async () => {
    const res = await POST({ json: async () => { throw new Error("bad json"); } } as never);
    expect(res.status).toBe(400);
  });
});
