import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyTokenMock, listarMock, retryMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  listarMock: vi.fn(async () => []),
  retryMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: verifyTokenMock }));
vi.mock("@/lib/fidelidadeEfeitos", () => ({
  obterPendenciasEfeitosFidelidade: listarMock,
  reprocessarPendenciaEfeitosFidelidade: retryMock,
}));

import { GET, POST } from "./route";

function request(method: string, body?: unknown, cookie?: string) {
  const req = new NextRequest("http://localhost/api/admin/fidelidade/pendencias", {
    method,
    headers: cookie ? new Headers({ cookie: `auth-token=${cookie}` }) : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (cookie) req.cookies.set("auth-token", cookie);
  return req;
}

describe("/api/admin/fidelidade/pendencias", () => {
  it("bloqueia leitura sem autenticação", async () => {
    verifyTokenMock.mockResolvedValue(null);
    const response = await GET(request("GET"));
    expect(response.status).toBe(401);
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("permite retry somente para admin/dev e encaminha pela autoridade única", async () => {
    verifyTokenMock.mockResolvedValue({ username: "kellyne", role: "admin" });
    const req = request("POST", { pedidoId: "ped-1", acao: "entregue" }, "token");
    expect(req.cookies.get("auth-token")?.value).toBe("token");
    const response = await POST(req);
    expect(verifyTokenMock).toHaveBeenCalledWith("token");
    expect(response.status).toBe(200);
    expect(retryMock).toHaveBeenCalledWith("ped-1", "entregue");
  });

  it("rejeita ação inválida sem executar retry", async () => {
    verifyTokenMock.mockResolvedValue({ username: "kellyne", role: "admin" });
    retryMock.mockClear();
    const response = await POST(request("POST", { pedidoId: "ped-1", acao: "qualquer" }, "token"));
    expect(response.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });
});
