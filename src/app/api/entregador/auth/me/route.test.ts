import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/lib/entregadorAuth", () => ({ autenticarEntregador: authMock }));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/entregador/auth/me", () => {
  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://x.test/api/entregador/auth/me"))).status).toBe(401);
  });

  it("retorna somente id e nome para sessão ativa", async () => {
    authMock.mockResolvedValue({
      entregador: { id: "ent-1", nome: "Rafael", telefone: "86999990000", ativo: true },
      sessao: { entregadorId: "ent-1", nome: "Rafael", tipo: "entregador", issuedAt: 1, expiresAt: 2 },
    });
    const data = await (await GET(new NextRequest("https://x.test/api/entregador/auth/me"))).json();
    expect(data).toEqual({ ok: true, entregador: { id: "ent-1", nome: "Rafael" } });
  });
});
