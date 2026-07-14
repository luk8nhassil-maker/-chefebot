import { beforeEach, describe, expect, it, vi } from "vitest";

const { executarGuardiaoMock } = vi.hoisted(() => ({
  executarGuardiaoMock: vi.fn(),
}));

vi.mock("@/lib/pixGuardiao", () => ({
  executarGuardiaoPix: (...args: unknown[]) => executarGuardiaoMock(...args),
}));

import { createToken } from "@/lib/auth";
import { POST } from "./route";

function req(token?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === "auth-token" && token ? { value: token } : undefined,
    },
  } as never;
}

const resultadoPadrao = {
  avaliadas: 2,
  saude: { healthy: 1, delayed: 1, recovering: 0, rate_limited: 0, failed: 0, confirmed: 0, cancelled: 0, expired: 0 },
  recuperacoesTentadas: 1,
  recuperacoesBemSucedidas: 1,
  ambiguos: 0,
};

beforeEach(() => {
  executarGuardiaoMock.mockClear();
});

describe("POST /api/admin/mercadopago/guardiao-pix — autorização", () => {
  it("sem cookie retorna 401 e não executa o Guardião", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(executarGuardiaoMock).not.toHaveBeenCalled();
  });

  it("token inválido retorna 401", async () => {
    const res = await POST(req("token-lixo"));
    expect(res.status).toBe(401);
    expect(executarGuardiaoMock).not.toHaveBeenCalled();
  });

  it("role sem permissão (atendente) retorna 403", async () => {
    const token = await createToken({ username: "ana", name: "Ana", role: "atendente" });
    const res = await POST(req(token));
    expect(res.status).toBe(403);
    expect(executarGuardiaoMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/mercadopago/guardiao-pix — execução autorizada", () => {
  it("admin autenticado: executa o Guardião e retorna o resultado", async () => {
    executarGuardiaoMock.mockResolvedValue(resultadoPadrao);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });

    const res = await POST(req(token));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(executarGuardiaoMock).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ ok: true, ...resultadoPadrao });
  });

  it("dev autenticado também consegue disparar o Guardião", async () => {
    executarGuardiaoMock.mockResolvedValue(resultadoPadrao);
    const token = await createToken({ username: "dev1", name: "Dev", role: "dev" });

    const res = await POST(req(token));
    expect(res.status).toBe(200);
    expect(executarGuardiaoMock).toHaveBeenCalledTimes(1);
  });
});
