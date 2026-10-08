import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock, verifyTokenMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const verifyTokenMock = vi.fn(async (session: string) => {
    if (session === "admin-session") return { username: "admin", name: "Admin", role: "admin" };
    if (session === "staff-session") return { username: "staff", name: "Staff", role: "atendente" };
    if (session === "dev-session") return { username: "dev", name: "Dev", role: "dev" };
    return null;
  });
  return { store, redisMock, verifyTokenMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", () => ({ verifyToken: verifyTokenMock }));

import { GET, POST } from "./route";

function postReq(body: unknown, session?: string) {
  return {
    cookies: { get: () => (session ? { value: session } : undefined) },
    json: async () => body,
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("/api/bot-status", () => {
  it("GET continua somente leitura e público", async () => {
    store.set("bot_ativo", false);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ativo: false });
  });

  it("POST sem sessão não consegue pausar o bot global", async () => {
    store.set("bot_ativo", true);
    const res = await POST(postReq({ ativo: false }));
    expect(res.status).toBe(401);
    expect(store.get("bot_ativo")).toBe(true);
    expect(store.get("bot_status:last_change")).toBeUndefined();
  });

  it("admin autenticado pode pausar e a origem fica auditável", async () => {
    store.set("bot_ativo", true);
    const res = await POST(postReq({ ativo: false, source: "painel_toggle" }, "admin-session"));
    expect(res.status).toBe(200);
    expect(store.get("bot_ativo")).toBe(false);
    expect(store.get("bot_status:last_change")).toMatchObject({
      ativo: false,
      anterior: true,
      username: "admin",
      role: "admin",
      source: "painel_toggle",
    });
  });

  it("atendente autenticado mantém a permissão operacional por cliente", async () => {
    const res = await POST(postReq({ ativo: false, phone: "5599999999999" }, "staff-session"));
    expect(res.status).toBe(200);
    expect(store.get("manual:5599999999999")).toBe(true);
  });

  it("source arbitrário não entra no registro de auditoria", async () => {
    const res = await POST(postReq({ ativo: false, source: "qualquer-coisa" }, "dev-session"));
    expect(res.status).toBe(200);
    expect(store.get("bot_status:last_change")).toMatchObject({ source: "api" });
  });
});
