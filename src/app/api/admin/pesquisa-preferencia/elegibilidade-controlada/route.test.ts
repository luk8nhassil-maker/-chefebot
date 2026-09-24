import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyTokenMock, gateMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  gateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyToken: verifyTokenMock,
}));

vi.mock("@/lib/pesquisaPreferenciaElegibilidadeCompleta.server", () => ({
  avaliarElegibilidadeContatoPesquisaCompleta: gateMock,
}));

import { POST } from "./route";

function req(body: unknown, cookie = "auth-token=test") {
  return new NextRequest(
    "http://localhost/api/admin/pesquisa-preferencia/elegibilidade-controlada",
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
  verifyTokenMock.mockResolvedValue({ role: "admin" });
  gateMock.mockResolvedValue({
    elegibilidade: {
      status: "elegivel",
      motivos: [],
      contatosUltimos14Dias: 0,
      contatosUltimos90Dias: 1,
    },
    diagnostico: {
      fontesOperacionaisCompletas: true,
      pedidosCorrespondentes: 1,
      contatosPersistidos: 0,
      contatosBootstrapConservador: 1,
      identidadeConfirmada: true,
      checkoutWhatsappEmAndamento: false,
      checkoutWebSinalInformado: true,
      disputaExternaSinalInformado: true,
    },
  });
});

describe("POST /api/admin/pesquisa-preferencia/elegibilidade-controlada", () => {
  test("rejeita acesso sem sessão", async () => {
    verifyTokenMock.mockResolvedValue(null);
    const res = await POST(req({ telefone: "5599999999999" }, ""));
    expect(res.status).toBe(401);
  });

  test("executa somente leitura e não devolve telefone", async () => {
    const res = await POST(
      req({
        telefone: "5599999999999",
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      })
    );
    const texto = await res.text();

    expect(res.status).toBe(200);
    expect(texto).not.toContain("5599999999999");
    expect(texto).not.toContain("telefone");
    expect(res.headers.get("x-chefebot-research-mode")).toBe(
      "dry-run-controlado"
    );
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(gateMock).toHaveBeenCalledWith({
      telefone: "5599999999999",
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });
  });

  test("sinais omitidos seguem para o gate como incompletos", async () => {
    await POST(req({ telefone: "5599999999999" }));

    expect(gateMock).toHaveBeenCalledWith({
      telefone: "5599999999999",
      sinaisControlados: {},
    });
  });

  test("rejeita corpo sem telefone", async () => {
    const res = await POST(req({ checkoutWebEmAndamento: false }));
    expect(res.status).toBe(400);
    expect(gateMock).not.toHaveBeenCalled();
  });
});
