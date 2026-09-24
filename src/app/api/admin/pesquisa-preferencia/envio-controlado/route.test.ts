import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyTokenMock, envioMock, releaseGateMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  envioMock: vi.fn(),
  releaseGateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyToken: verifyTokenMock,
}));

vi.mock("@/lib/pesquisaPreferenciaEnvioControlado.server", () => ({
  executarEnvioPesquisaControlado: envioMock,
}));

vi.mock("@/lib/pesquisaPreferenciaRelease", () => ({
  envioControladoLiberadoNestaVersao: releaseGateMock,
}));

import { POST } from "./route";

function req(body: unknown, cookie = "auth-token=test") {
  return new NextRequest(
    "http://localhost/api/admin/pesquisa-preferencia/envio-controlado",
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

function bodyValido() {
  return {
    telefone: "5599999999999",
    momentId: "M1",
    triggerEventId: "pedido-1",
    checkoutWebEmAndamento: false,
    disputaOuEstornoExternoAberto: false,
    confirmacao: "ENVIAR_PESQUISA_CONTROLADA",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("PESQUISA_PREFERENCIA_ENVIO_CONTROLADO_ENABLED", "true");
  verifyTokenMock.mockResolvedValue({ role: "admin" });
  releaseGateMock.mockReturnValue(true);
  envioMock.mockResolvedValue({
    status: "enviado",
    exposureId: "a".repeat(64),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/pesquisa-preferencia/envio-controlado", () => {
  test("Preview nunca pode disparar provider", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    const res = await POST(req(bodyValido()));

    expect(res.status).toBe(403);
    expect(envioMock).not.toHaveBeenCalled();
  });

  test("release gate fechado em produção bloqueia antes da flag", async () => {
    releaseGateMock.mockReturnValue(false);

    const res = await POST(req(bodyValido()));

    expect(res.status).toBe(403);
    expect(envioMock).not.toHaveBeenCalled();
  });

  test("flag desligada nunca chama serviço", async () => {
    vi.stubEnv("PESQUISA_PREFERENCIA_ENVIO_CONTROLADO_ENABLED", "false");

    const res = await POST(req(bodyValido()));

    expect(res.status).toBe(403);
    expect(envioMock).not.toHaveBeenCalled();
  });

  test("somente admin pode executar", async () => {
    verifyTokenMock.mockResolvedValue({ role: "dev" });

    const res = await POST(req(bodyValido()));

    expect(res.status).toBe(401);
    expect(envioMock).not.toHaveBeenCalled();
  });

  test("exige confirmação textual exata", async () => {
    const res = await POST(
      req({ ...bodyValido(), confirmacao: "sim" })
    );

    expect(res.status).toBe(400);
    expect(envioMock).not.toHaveBeenCalled();
  });

  test("exige os dois sinais controlados como booleanos", async () => {
    const body = {
      ...bodyValido(),
      checkoutWebEmAndamento: undefined,
    };

    const res = await POST(req(body));

    expect(res.status).toBe(400);
    expect(envioMock).not.toHaveBeenCalled();
  });

  test("restringe piloto a M1 M2 M5", async () => {
    const res = await POST(req({ ...bodyValido(), momentId: "M3" }));

    expect(res.status).toBe(400);
    expect(envioMock).not.toHaveBeenCalled();
  });

  test("envio válido chama serviço uma única vez e não devolve telefone", async () => {
    const res = await POST(req(bodyValido()));
    const texto = await res.text();

    expect(res.status).toBe(200);
    expect(texto).not.toContain("5599999999999");
    expect(texto).not.toContain("telefone");
    expect(res.headers.get("x-chefebot-research-mode")).toBe(
      "controlled-one-shot"
    );
    expect(envioMock).toHaveBeenCalledTimes(1);
    expect(envioMock).toHaveBeenCalledWith({
      telefone: "5599999999999",
      momentId: "M1",
      triggerEventId: "pedido-1",
      checkoutWebEmAndamento: false,
      disputaOuEstornoExternoAberto: false,
    });
  });

  test("gate suprimido retorna 409 sem mascarar motivo", async () => {
    envioMock.mockResolvedValue({
      status: "suprimido",
      motivos: ["cooldown_14_dias"],
    });

    const res = await POST(req(bodyValido()));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.resultado.motivos).toContain("cooldown_14_dias");
  });

  test("falha comprovada do provider retorna 502 sem retry automático", async () => {
    envioMock.mockResolvedValue({
      status: "envio_nao_realizado",
      motivos: ["http_400"],
    });

    const res = await POST(req(bodyValido()));

    expect(res.status).toBe(502);
  });
});
