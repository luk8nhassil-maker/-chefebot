import { vi, describe, it, expect, beforeEach } from "vitest";

// Garante que POST /api/assumir grava manual:{phone} e session:{phone}
// com TTL 7200 (2h) — evitando expiração prematura durante atendimento humano.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";
import { createToken } from "@/lib/auth";

const PHONE = "5586988887777";

function postReq(body: unknown, token?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === "auth-token" && token ? { value: token } : undefined,
    },
    json: async () => body,
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/assumir — TTL 7200", () => {
  it("sem token retorna 401 e não grava no Redis", async () => {
    const res = await POST(postReq({ telefone: PHONE }));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("grava manual:{phone} com TTL 7200", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ telefone: PHONE }, token));
    expect(res.status).toBe(200);

    const manualCall = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `manual:${PHONE}`
    );
    expect(manualCall).toBeDefined();
    expect(manualCall[1]).toBe(true);
    expect(manualCall[2]).toEqual({ ex: 7200 });
  });

  it("renova session:{phone} com TTL 7200 quando sessão existe", async () => {
    const sessao = { step: "manual", cart: [] };
    store.set(`session:${PHONE}`, sessao);

    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    await POST(postReq({ telefone: PHONE }, token));

    const sessionCall = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `session:${PHONE}`
    );
    expect(sessionCall).toBeDefined();
    expect(sessionCall[1]).toEqual(sessao);
    expect(sessionCall[2]).toEqual({ ex: 7200 });
  });

  it("não toca session:{phone} quando sessão não existe", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    await POST(postReq({ telefone: PHONE }, token));

    const sessionCall = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `session:${PHONE}`
    );
    expect(sessionCall).toBeUndefined();
  });

  it("normaliza telefone sem DDI e ainda grava manual: com TTL 7200", async () => {
    const semDDI = "86988887777";
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    await POST(postReq({ telefone: semDDI }, token));

    const manualCall = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `manual:${PHONE}`
    );
    expect(manualCall).toBeDefined();
    expect(manualCall[2]).toEqual({ ex: 7200 });
  });
});
