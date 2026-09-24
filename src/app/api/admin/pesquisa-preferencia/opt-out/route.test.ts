import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyTokenMock, registrarMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  registrarMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyToken: verifyTokenMock,
}));

vi.mock("@/lib/pesquisaPreferenciaOptOutRedis", () => ({
  registrarOptOutPesquisa: registrarMock,
}));

import { POST } from "./route";

function req(body: unknown, cookie = "auth-token=test") {
  return new NextRequest(
    "http://localhost/api/admin/pesquisa-preferencia/opt-out",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  verifyTokenMock.mockResolvedValue({ role: "admin" });
  registrarMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/pesquisa-preferencia/opt-out", () => {
  test("bloqueia Preview antes de qualquer escrita", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    const res = await POST(req({ telefone: "5599999999999" }));

    expect(res.status).toBe(403);
    expect(registrarMock).not.toHaveBeenCalled();
  });

  test("exige role admin", async () => {
    verifyTokenMock.mockResolvedValue({ role: "dev" });

    const res = await POST(req({ telefone: "5599999999999" }));

    expect(res.status).toBe(401);
    expect(registrarMock).not.toHaveBeenCalled();
  });

  test("registra em produção sem devolver telefone", async () => {
    const res = await POST(req({ telefone: "5599999999999" }));
    const texto = await res.text();

    expect(res.status).toBe(200);
    expect(texto).not.toContain("5599999999999");
    expect(texto).not.toContain("telefone");
    expect(registrarMock).toHaveBeenCalledWith({
      telefone: "5599999999999",
    });
  });

  test("rejeita identidade inválida", async () => {
    registrarMock.mockResolvedValue(false);

    const res = await POST(req({ telefone: "123" }));

    expect(res.status).toBe(400);
  });
});
