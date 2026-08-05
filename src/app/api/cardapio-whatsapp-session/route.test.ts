import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PHONE = "5599974000691";
const TOKEN = "a".repeat(32);

const redisStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
  },
}));

const { sincronizarCronometroMock } = vi.hoisted(() => ({
  sincronizarCronometroMock: vi.fn(async () => {}),
}));
vi.mock("@/lib/inatividadeConversa", () => ({
  sincronizarCronometroInatividade: sincronizarCronometroMock,
}));

import { GET } from "./route";

function requestSessao(token?: string) {
  const url = token
    ? `http://localhost/api/cardapio-whatsapp-session?t=${token}`
    : "http://localhost/api/cardapio-whatsapp-session";
  return new NextRequest(url);
}

beforeEach(() => {
  redisStore.clear();
  sincronizarCronometroMock.mockClear();
});

describe("GET /api/cardapio-whatsapp-session — reconhecimento do WhatsApp do link", () => {
  test("token válido devolve só as máscaras (4 finais + formato de exibição), nunca o número completo", async () => {
    redisStore.set(`cardapio:token:${TOKEN}`, { phone: PHONE, createdAt: Date.now() });

    const res = await GET(requestSessao(TOKEN));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.phoneFinal).toBe("0691");
    expect(body.phoneMascarado).toBe("(99) 9••••-0691");

    const serializado = JSON.stringify(body);
    expect(serializado).not.toContain(PHONE);
    expect(serializado).not.toContain(PHONE.slice(-8));
    expect(serializado).not.toContain("7400");
  });

  test("token inexistente/expirado devolve ok:false sem detalhes", async () => {
    const res = await GET(requestSessao(TOKEN));
    const body = await res.json();
    expect(body).toEqual({ ok: false });
  });

  test("sem token devolve ok:false", async () => {
    const res = await GET(requestSessao());
    const body = await res.json();
    expect(body).toEqual({ ok: false });
  });
});

describe("GET /api/cardapio-whatsapp-session — pausa o cronômetro de cancelamento por inatividade", () => {
  test("token válido avisa o cronômetro como 'cliente' (pausa sem registrar mensagem falsa)", async () => {
    redisStore.set(`cardapio:token:${TOKEN}`, { phone: PHONE, createdAt: Date.now() });
    await GET(requestSessao(TOKEN));
    expect(sincronizarCronometroMock).toHaveBeenCalledWith(PHONE, "cliente");
  });

  test("token inválido/expirado nunca chama o cronômetro", async () => {
    await GET(requestSessao(TOKEN));
    expect(sincronizarCronometroMock).not.toHaveBeenCalled();
  });

  test("falha ao sincronizar o cronômetro nunca derruba a resolução do token", async () => {
    redisStore.set(`cardapio:token:${TOKEN}`, { phone: PHONE, createdAt: Date.now() });
    sincronizarCronometroMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    const res = await GET(requestSessao(TOKEN));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.phoneFinal).toBe("0691");
  });
});
