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

import { createToken } from "@/lib/auth";
import { MERCADO_PAGO_INTEGRATION_KEY } from "@/lib/mercadoPagoIntegracao";
import { GET, PUT } from "./route";

function req(body?: unknown, token?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === "auth-token" && token ? { value: token } : undefined,
    },
    json: async () => body,
  } as never;
}

async function token(role: "admin" | "dev" | "atendente" = "admin") {
  return await createToken({ username: role, name: role, role });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-secret-mercado-pago");
});

describe("/api/admin/integracoes/mercadopago", () => {
  it("usuario sem token nao acessa", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("usuario sem permissao nao acessa", async () => {
    const res = await GET(req(undefined, await token("atendente")));
    expect(res.status).toBe(403);
  });

  it("salva token e nao retorna token completo no PUT nem no GET", async () => {
    const accessToken = "APP_USR-token-super-secreto-1234";
    const putRes = await PUT(req({ enabled: true, accessToken }, await token("admin")));
    expect(putRes.status).toBe(200);

    const putData = await putRes.json();
    expect(JSON.stringify(putData)).not.toContain(accessToken);
    expect(putData.config.configured).toBe(true);
    expect(putData.config.tokenMasked).toBe("********1234");

    const saved = store.get(MERCADO_PAGO_INTEGRATION_KEY) as Record<string, unknown>;
    expect(saved.accessTokenEncrypted).toBeTypeOf("string");
    expect(saved.accessTokenEncrypted).not.toBe(accessToken);
    expect(saved.accessTokenLast4).toBe("1234");

    const getData = await (await GET(req(undefined, await token("dev")))).json();
    expect(JSON.stringify(getData)).not.toContain(accessToken);
    expect(getData.tokenMasked).toBe("********1234");
  });

  it("token vazio no PUT nao apaga token existente", async () => {
    await PUT(req({ enabled: true, accessToken: "APP_USR-token-existente-abcd" }, await token()));
    const before = store.get(MERCADO_PAGO_INTEGRATION_KEY) as Record<string, unknown>;

    const res = await PUT(req({ enabled: false, accessToken: "" }, await token()));
    expect(res.status).toBe(200);

    const after = store.get(MERCADO_PAGO_INTEGRATION_KEY) as Record<string, unknown>;
    expect(after.accessTokenEncrypted).toBe(before.accessTokenEncrypted);
    expect(after.accessTokenLast4).toBe("abcd");

    const data = await res.json();
    expect(data.config.configured).toBe(true);
    expect(data.config.tokenMasked).toBe("********abcd");
  });

  it("clearToken true remove token salvo", async () => {
    await PUT(req({ enabled: true, accessToken: "APP_USR-token-removivel-wxyz" }, await token()));

    const res = await PUT(req({ clearToken: true }, await token()));
    expect(res.status).toBe(200);

    const saved = store.get(MERCADO_PAGO_INTEGRATION_KEY) as Record<string, unknown>;
    expect(saved.accessTokenEncrypted).toBeUndefined();
    expect(saved.accessTokenLast4).toBeUndefined();

    const data = await res.json();
    expect(data.config.configured).toBe(false);
    expect(data.config.tokenMasked).toBeNull();
  });
});
