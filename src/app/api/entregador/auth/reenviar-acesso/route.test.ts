import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock, enviarMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      eval: vi.fn(async () => 1),
    },
    enviarMock: vi.fn(async () => ({ ok: true as const })),
  };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarMock }));

import { POST } from "./route";

function request(body: unknown, ip = "203.0.113.10") {
  return new NextRequest("https://x.test/api/entregador/auth/reenviar-acesso", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redisMock.eval.mockResolvedValue(1);
  enviarMock.mockResolvedValue({ ok: true });
});

describe("POST /api/entregador/auth/reenviar-acesso", () => {
  it("usa exclusivamente o telefone cadastrado e não retorna o ticket", async () => {
    store.set("entregadores", [{ id: "ent-1", nome: "Rafael", telefone: "(86) 99999-0000", ativo: true }]);
    const res = await POST(request({ entregadorId: "ent-1", telefone: "5511999999999" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(enviarMock).toHaveBeenCalledTimes(1);
    expect(enviarMock.mock.calls[0][0]).toBe("5586999990000");
    expect(enviarMock.mock.calls[0][0]).not.toBe("5511999999999");
    expect(enviarMock.mock.calls[0][1]).toContain("/entregador#acesso=");
    expect(enviarMock.mock.calls[0][1]).not.toContain("?acesso=");
    expect(JSON.stringify(data)).not.toContain("acesso=");
    expect(JSON.stringify(data)).not.toContain("ent-1");
  });

  it("id inexistente e inativo têm a mesma resposta pública e não enviam", async () => {
    store.set("entregadores", [{ id: "ent-2", nome: "Inativo", telefone: "86999990001", ativo: false }]);
    const inexistente = await POST(request({ entregadorId: "ent-x" }));
    const inativo = await POST(request({ entregadorId: "ent-2" }, "203.0.113.11"));
    expect(await inexistente.json()).toEqual(await inativo.json());
    expect(enviarMock).not.toHaveBeenCalled();
  });

  it("rate limit bloqueia novo envio sem revelar o motivo", async () => {
    store.set("entregadores", [{ id: "ent-1", nome: "Rafael", telefone: "86999990000", ativo: true }]);
    redisMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const primeira = await POST(request({ entregadorId: "ent-1" }));
    const segunda = await POST(request({ entregadorId: "ent-1" }));
    expect(await primeira.json()).toEqual(await segunda.json());
    expect(enviarMock).toHaveBeenCalledTimes(1);
  });
});
