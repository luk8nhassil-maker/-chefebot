import { vi, describe, it, expect, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Garante que o PATCH /api/cardapio (marcar esgotado/disponível) exige login
// com role admin/atendente/dev, enquanto o GET continua público.
// ─────────────────────────────────────────────────────────────────────────────

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

import { GET, PATCH } from "./route";
import { createToken } from "@/lib/auth";

// Monta um request fake com cookie opcional e body JSON.
function patchReq(body: unknown, token?: string) {
  return {
    cookies: { get: (name: string) => (name === "auth-token" && token ? { value: token } : undefined) },
    json: async () => body,
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("PATCH /api/cardapio — autorização", () => {
  it("sem token retorna 401 e não grava no Redis", async () => {
    const res = await PATCH(patchReq({ nome: "Calabresa", esgotado: true }));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("token com role inválida retorna 401", async () => {
    const token = await createToken({ username: "joao", name: "Joao", role: "entregador" as never });
    const res = await PATCH(patchReq({ nome: "Calabresa", esgotado: true }, token));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("token de admin marca produto como esgotado (200)", async () => {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    const res = await PATCH(patchReq({ nome: "Calabresa", esgotado: true }, token));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.esgotados).toContain("Calabresa");
    expect(store.get("esgotados")).toContain("Calabresa");
  });

  it("token de atendente também é autorizado", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await PATCH(patchReq({ nome: "Bacon", esgotado: true }, token));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/cardapio — público", () => {
  it("retorna 200 sem nenhuma autenticação", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    // menu base sempre presente + listas de esgotados
    expect(Array.isArray(data.saltyFlavors)).toBe(true);
    expect(Array.isArray(data.esgotados)).toBe(true);
  });
});
