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
import { SALAO_COOKIE, lerSessaoSalao } from "@/lib/salaoAuth";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/salao/login", () => {
  it("sempre emite uma sessão do Salão válida — não há mais código de acesso", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(SALAO_COOKIE);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);

    const sessao = await lerSessaoSalao({ cookies: { get: () => ({ value: cookie!.value }) } } as never);
    expect(sessao).toEqual({ tipo: "salao" });
  });

  it("chamadas repetidas continuam emitindo sessão válida", async () => {
    const res1 = await POST();
    const res2 = await POST();
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
