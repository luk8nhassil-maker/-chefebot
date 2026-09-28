import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  lerSessaoCliente: vi.fn(),
  recordPublicBehaviorEvent: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({
  lerSessaoCliente: mocks.lerSessaoCliente,
}));

vi.mock("@/lib/behaviorAnalytics", () => ({
  recordPublicBehaviorEvent: mocks.recordPublicBehaviorEvent,
}));

import { POST } from "./route";

const EVENT = "22222222-2222-4222-8222-222222222222";
const SESSION = "11111111-1111-4111-8111-111111111111";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://chefedapizza.com.br/api/comportamento/evento", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lerSessaoCliente.mockResolvedValue(null);
  mocks.recordPublicBehaviorEvent.mockResolvedValue({
    recorded: true,
    duplicate: false,
    customerLinked: false,
  });
});

describe("POST /api/comportamento/evento", () => {
  test("não aceita cross-site", async () => {
    const res = await POST(req(
      { eventId: EVENT, sessionId: SESSION, type: "app_open" },
      { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    ));

    expect(res.status).toBe(204);
    expect(mocks.recordPublicBehaviorEvent).not.toHaveBeenCalled();
  });

  test("nunca aceita clienteId do body como autoridade", async () => {
    mocks.lerSessaoCliente.mockResolvedValue({
      clienteId: "cli_servidor",
      telefone: "5599999999999",
    });

    const res = await POST(req({
      eventId: EVENT,
      sessionId: SESSION,
      type: "page_view",
      clienteId: "cli_atacante",
      telefone: "5599974000691",
      nome: "Maria",
      data: { page: "cliente" },
    }));

    expect(res.status).toBe(204);
    expect(mocks.recordPublicBehaviorEvent).toHaveBeenCalledWith({
      eventId: EVENT,
      sessionId: SESSION,
      type: "page_view",
      data: { page: "cliente" },
      clienteId: "cli_servidor",
    });
  });

  test("sem sessão registra como anônimo", async () => {
    await POST(req({
      eventId: EVENT,
      sessionId: SESSION,
      type: "app_open",
      data: { page: "cardapio" },
    }));

    expect(mocks.recordPublicBehaviorEvent).toHaveBeenCalledWith({
      eventId: EVENT,
      sessionId: SESSION,
      type: "app_open",
      data: { page: "cardapio" },
      clienteId: null,
    });
  });

  test("conflito de dono pede nova sessão ao navegador", async () => {
    mocks.recordPublicBehaviorEvent.mockResolvedValue({
      recorded: false,
      duplicate: false,
      customerLinked: false,
      reason: "session_owner_conflict",
    });

    const res = await POST(req({
      eventId: EVENT,
      sessionId: SESSION,
      type: "page_view",
      data: { page: "cliente" },
    }));

    expect(res.status).toBe(409);
    expect(res.headers.get("x-chefebot-behavior-reset-session")).toBe("1");
  });

  test("body inválido é silencioso e nunca quebra o app", async () => {
    const res = await POST(new NextRequest(
      "https://chefedapizza.com.br/api/comportamento/evento",
      { method: "POST", body: "nao-json" },
    ));

    expect(res.status).toBe(204);
    expect(mocks.recordPublicBehaviorEvent).not.toHaveBeenCalled();
  });
});
