import { beforeEach, describe, expect, it, vi } from "vitest";

const { reconciliarMock } = vi.hoisted(() => ({
  reconciliarMock: vi.fn(),
}));

vi.mock("@/lib/mercadoPagoReconciliacao", () => ({
  reconciliarPixMercadoPago: (...args: unknown[]) => reconciliarMock(...args),
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

const resumoPadrao = { verificados: 3, confirmados: 1, pendentes: 1, ignorados: 1, erros: 0, detalhes: [] };

beforeEach(() => {
  reconciliarMock.mockClear();
});

describe("POST /api/admin/mercadopago/reconciliar-pix — autorização", () => {
  it("sem cookie retorna 401 e não chama o conciliador", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });

  it("token inválido/adulterado retorna 401", async () => {
    const res = await POST(req("token-lixo-adulterado"));
    expect(res.status).toBe(401);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });

  it("role sem permissão (atendente) retorna 403", async () => {
    const token = await createToken({ username: "ana", name: "Ana", role: "atendente" });
    const res = await POST(req(token));
    expect(res.status).toBe(403);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/mercadopago/reconciliar-pix — execução autorizada", () => {
  it("admin autenticado: chama o conciliador e retorna o resumo", async () => {
    reconciliarMock.mockResolvedValue(resumoPadrao);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });

    const res = await POST(req(token));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(reconciliarMock).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ ok: true, ...resumoPadrao });
  });

  it("dev autenticado também consegue disparar a conciliação", async () => {
    reconciliarMock.mockResolvedValue(resumoPadrao);
    const token = await createToken({ username: "dev1", name: "Dev", role: "dev" });

    const res = await POST(req(token));
    expect(res.status).toBe(200);
    expect(reconciliarMock).toHaveBeenCalledTimes(1);
  });
});
