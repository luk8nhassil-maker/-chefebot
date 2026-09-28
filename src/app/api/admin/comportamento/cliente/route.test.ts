import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  behaviorAnalyticsEnabled: vi.fn(),
  consultarTimelineComportamentalCliente: vi.fn(),
  derivarClienteIdPorTelefone: vi.fn(),
  buscarClientePorTelefone: vi.fn(),
  sanitizeTelefoneCliente: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("@/lib/behaviorAnalytics", () => ({
  behaviorAnalyticsEnabled: mocks.behaviorAnalyticsEnabled,
}));
vi.mock("@/lib/behaviorAnalyticsRead", () => ({
  consultarTimelineComportamentalCliente: mocks.consultarTimelineComportamentalCliente,
}));
vi.mock("@/lib/fidelidade", () => ({
  derivarClienteIdPorTelefone: mocks.derivarClienteIdPorTelefone,
}));
vi.mock("@/lib/clientes", () => ({
  buscarClientePorTelefone: mocks.buscarClientePorTelefone,
  sanitizeTelefoneCliente: mocks.sanitizeTelefoneCliente,
}));

import { POST } from "./route";

function req(body: unknown) {
  const r = new NextRequest("https://chefedapizza.com.br/api/admin/comportamento/cliente", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  r.cookies.set("auth-token", "token");
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.behaviorAnalyticsEnabled.mockReturnValue(true);
  mocks.verifyToken.mockResolvedValue({ username: "admin", role: "admin" });
  mocks.sanitizeTelefoneCliente.mockImplementation((v) => typeof v === "string" ? v.replace(/\D/g, "") : "");
  mocks.derivarClienteIdPorTelefone.mockImplementation((v) => v.length >= 10 ? "cli_canonico" : undefined);
  mocks.buscarClientePorTelefone.mockResolvedValue({
    clienteId: "cli_canonico",
    telefone: "5599999999999",
    nome: "Maria",
    apelido: "Mah",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  mocks.consultarTimelineComportamentalCliente.mockResolvedValue({
    truncated: false,
    events: [{
      eventId: "evt",
      sessionId: "sess",
      type: "app_open",
      occurredAtMs: 1,
      receivedAtMs: 1,
      context: { source: "cardapio" },
      identificado: false,
    }],
  });
});

describe("POST /api/admin/comportamento/cliente", () => {
  test("gate fechado não processa telefone", async () => {
    mocks.behaviorAnalyticsEnabled.mockReturnValue(false);
    const res = await POST(req({ telefone: "5599999999999" }));
    expect(res.status).toBe(404);
    expect(mocks.sanitizeTelefoneCliente).not.toHaveBeenCalled();
  });

  test("exige admin/dev", async () => {
    mocks.verifyToken.mockResolvedValue({ username: "x", role: "atendente" });
    expect((await POST(req({ telefone: "5599999999999" }))).status).toBe(401);
  });

  test("telefone inválido falha fechado", async () => {
    mocks.derivarClienteIdPorTelefone.mockReturnValue(undefined);
    const res = await POST(req({ telefone: "12" }));
    expect(res.status).toBe(400);
    expect(mocks.consultarTimelineComportamentalCliente).not.toHaveBeenCalled();
  });

  test("resolve cliente no servidor e não devolve telefone nem actor hash", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
    const res = await POST(req({ telefone: "(55) 99999-9999", periodo: 30, clienteId: "forjado" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.consultarTimelineComportamentalCliente).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: "cli_canonico",
    }));
    expect(body.cliente).toEqual({
      nome: "Maria",
      apelido: "Mah",
      cadastradoEm: "2026-09-01T00:00:00.000Z",
    });
    const serializado = JSON.stringify(body);
    expect(serializado).not.toContain("5599999999999");
    expect(serializado).not.toContain("actorHash");
    expect(serializado).not.toContain("forjado");
    dateSpy.mockRestore();
  });
});
