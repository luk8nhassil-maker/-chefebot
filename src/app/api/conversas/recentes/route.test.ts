import { vi, describe, test, expect, beforeEach } from "vitest";

// Regressão: GET /api/conversas/recentes sempre devolve `phone` como string
// válida e completa. O bug real era o Upstash Redis fazer JSON.parse em cada
// member do ZSET `conversas:index` — um telefone só com dígitos (ex.:
// "5586999990001") virava um `number` em runtime, mesmo com o tipo declarado
// como string[] no zrange(). Isso resultava em conversas com phone: "" no
// frontend, quebrando a seleção (ver conversas/page.test.ts).

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    zrange: vi.fn(),
    keys: vi.fn(async () => []),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { GET } from "./route";
import { createToken } from "@/lib/auth";

const PHONE_A = "5586999990001";
const PHONE_B = "5586999990002";

function getReq(token?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === "auth-token" && token ? { value: token } : undefined,
    },
  } as never;
}

function setMeta(phone: string, over: Partial<Record<string, unknown>> = {}) {
  store.set(`conversa_meta:${phone}`, {
    phone,
    nome: `Cliente ${phone}`,
    ultimaMensagem: "oi",
    ultimaTs: 1000,
    mensagensCount: 1,
    ...over,
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redisMock.keys.mockResolvedValue([]);
});

describe("GET /api/conversas/recentes — normalização do member do ZSET", () => {
  test("member do ZSET como string: phone sai como string igual à original", async () => {
    redisMock.zrange.mockResolvedValue([PHONE_A]);
    setMeta(PHONE_A);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(getReq(token));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].phone).toBe(PHONE_A);
    expect(typeof body[0].phone).toBe("string");
  });

  test("member do ZSET como number (bug real do Upstash): phone ainda sai como string completa", async () => {
    redisMock.zrange.mockResolvedValue([Number(PHONE_A)]);
    setMeta(PHONE_A);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(getReq(token));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].phone).toBe(PHONE_A);
    expect(typeof body[0].phone).toBe("string");
  });

  test("nunca usa comparação parcial: telefone completo preservado, sem slice/endsWith", async () => {
    redisMock.zrange.mockResolvedValue([Number(PHONE_A)]);
    setMeta(PHONE_A);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(getReq(token));
    const body = await res.json();
    expect(body[0].phone.length).toBe(PHONE_A.length);
  });

  test("valor inválido (string vazia, null, objeto) no ZSET é eliminado da resposta", async () => {
    redisMock.zrange.mockResolvedValue(["", null, {}, PHONE_A]);
    setMeta(PHONE_A);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(getReq(token));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].phone).toBe(PHONE_A);
  });

  test("valor numérico curto demais (não é telefone real) é eliminado", async () => {
    redisMock.zrange.mockResolvedValue([123, PHONE_A]);
    setMeta(PHONE_A);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(getReq(token));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].phone).toBe(PHONE_A);
  });

  test("duas conversas diferentes nunca recebem o mesmo phone normalizado", async () => {
    redisMock.zrange.mockResolvedValue([Number(PHONE_A), PHONE_B]);
    setMeta(PHONE_A, { ultimaTs: 2000 });
    setMeta(PHONE_B, { ultimaTs: 1000 });
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(getReq(token));
    const body = await res.json();
    expect(body).toHaveLength(2);
    const phones = body.map((c: { phone: string }) => c.phone);
    expect(new Set(phones).size).toBe(2);
    expect(phones).toContain(PHONE_A);
    expect(phones).toContain(PHONE_B);
  });

  test("todo item da resposta tem o shape público esperado", async () => {
    redisMock.zrange.mockResolvedValue([Number(PHONE_A)]);
    setMeta(PHONE_A);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await GET(getReq(token));
    const body = await res.json();
    expect(body[0]).toEqual({
      phone: PHONE_A,
      nome: `Cliente ${PHONE_A}`,
      ultimaMensagem: "oi",
      ultimaTs: 1000,
      status: "finalizado",
      mensagensCount: 1,
    });
  });
});

describe("GET /api/conversas/recentes — autenticação (inalterado)", () => {
  test("sem token retorna 401", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });
});
