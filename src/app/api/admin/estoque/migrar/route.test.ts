import { vi, describe, it, expect, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";
import { createToken } from "@/lib/auth";
import { CHAVE_ESGOTADOS } from "@/lib/estoque";

function req(body: unknown, token?: string) {
  return {
    cookies: { get: (name: string) => (name === "auth-token" && token ? { value: token } : undefined) },
    json: async () => body,
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/admin/estoque/migrar — autorização", () => {
  it("sem token: 401", async () => {
    const res = await POST(req({ acao: "dry-run" }));
    expect(res.status).toBe(401);
  });

  it("atendente não pode migrar dados (403) — mais restrito que o PATCH de esgotados", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(req({ acao: "dry-run" }, token));
    expect(res.status).toBe(403);
  });

  it("admin pode rodar dry-run", async () => {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    store.set(CHAVE_ESGOTADOS, ["Calabresa"]);
    const res = await POST(req({ acao: "dry-run" }, token));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.relatorio.dryRun).toBe(true);
  });
});

describe("POST /api/admin/estoque/migrar — validação", () => {
  it("acao inválida retorna 400", async () => {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    const res = await POST(req({ acao: "apagar-tudo" }, token));
    expect(res.status).toBe(400);
  });

  it("reverter sem chaveBackup retorna 400", async () => {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    const res = await POST(req({ acao: "reverter" }, token));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/estoque/migrar — fluxo completo", () => {
  it("migrar de verdade, depois reverter, restaura o estado anterior", async () => {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    store.set(CHAVE_ESGOTADOS, ["Calabresa"]);

    const migrar = await POST(req({ acao: "migrar" }, token));
    const dataMigrar = await migrar.json();
    expect(dataMigrar.relatorio.dryRun).toBe(false);
    expect(dataMigrar.relatorio.chaveBackup).toBeDefined();

    const reverter = await POST(req({ acao: "reverter", chaveBackup: dataMigrar.relatorio.chaveBackup }, token));
    expect(reverter.status).toBe(200);
    const dataReverter = await reverter.json();
    expect(dataReverter.ok).toBe(true);
  });
});
