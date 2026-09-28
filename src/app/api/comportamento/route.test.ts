import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  behaviorAnalyticsEnabled: vi.fn(),
  consumirLimiteIngestaoComportamental: vi.fn(),
  registrarEventosClienteComportamento: vi.fn(),
  validarEventoClienteComportamento: vi.fn(),
  validarVinculoCookieComportamento: vi.fn(),
  lerSessaoCliente: vi.fn(),
}));

vi.mock("@/lib/behaviorAnalytics", () => ({
  behaviorAnalyticsEnabled: mocks.behaviorAnalyticsEnabled,
  consumirLimiteIngestaoComportamental: mocks.consumirLimiteIngestaoComportamental,
  registrarEventosClienteComportamento: mocks.registrarEventosClienteComportamento,
  validarEventoClienteComportamento: mocks.validarEventoClienteComportamento,
  validarVinculoCookieComportamento: mocks.validarVinculoCookieComportamento,
}));

vi.mock("@/lib/clienteAuth", () => ({
  lerSessaoCliente: mocks.lerSessaoCliente,
}));

import { POST } from "./route";

const EVENTO_VALIDO = {
  eventId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  type: "app_open",
  occurredAtMs: 123,
  context: { source: "cardapio" },
};

function req(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("https://chefedapizza.com.br/api/comportamento", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.behaviorAnalyticsEnabled.mockReturnValue(true);
  mocks.consumirLimiteIngestaoComportamental.mockResolvedValue(true);
  mocks.validarEventoClienteComportamento.mockImplementation((x) => x);
  mocks.validarVinculoCookieComportamento.mockReturnValue(null);
  mocks.registrarEventosClienteComportamento.mockResolvedValue({ accepted: 1, duplicated: 0 });
  mocks.lerSessaoCliente.mockResolvedValue(null);
});

describe("POST /api/comportamento", () => {
  test("release gate fechado responde 404 sem tocar sessão nem storage", async () => {
    mocks.behaviorAnalyticsEnabled.mockReturnValue(false);
    const res = await POST(req({ events: [EVENTO_VALIDO] }));

    expect(res.status).toBe(404);
    expect(mocks.lerSessaoCliente).not.toHaveBeenCalled();
    expect(mocks.registrarEventosClienteComportamento).not.toHaveBeenCalled();
  });

  test("usa apenas identidade de cookie validado, nunca identidade do body", async () => {
    mocks.validarVinculoCookieComportamento.mockReturnValue("a".repeat(32));
    const res = await POST(req({ events: [EVENTO_VALIDO], clienteId: "forjado" }, { cookie: "behavior-link-v1=token" }));
    expect(res.status).toBe(202);
    expect(mocks.registrarEventosClienteComportamento).toHaveBeenCalledWith(expect.objectContaining({ actorHashVerificado: "a".repeat(32) }));
  });

  test("rejeita corpo acima do limite mesmo com content-length falsamente pequeno", async () => {
    const res = await POST(req(
      { events: [{ ...EVENTO_VALIDO, campoExtra: "x".repeat(33 * 1024) }] },
      { "content-length": "1" },
    ));

    expect(res.status).toBe(413);
    expect(mocks.registrarEventosClienteComportamento).not.toHaveBeenCalled();
  });

  test("rejeita lote vazio ou acima de 20 eventos", async () => {
    expect((await POST(req({ events: [] }))).status).toBe(400);
    expect((await POST(req({ events: Array.from({ length: 21 }, () => EVENTO_VALIDO) }))).status).toBe(400);
  });

  test("rejeita evento fora do contrato", async () => {
    mocks.validarEventoClienteComportamento.mockReturnValueOnce(null);
    const res = await POST(req({ events: [EVENTO_VALIDO] }));

    expect(res.status).toBe(400);
    expect(mocks.registrarEventosClienteComportamento).not.toHaveBeenCalled();
  });

  test("bloqueia abuso antes de persistir eventos", async () => {
    mocks.consumirLimiteIngestaoComportamental.mockResolvedValue(false);
    const res = await POST(req({ events: [EVENTO_VALIDO] }, { "x-forwarded-for": "203.0.113.10" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(mocks.registrarEventosClienteComportamento).not.toHaveBeenCalled();
  });

  test("associa identidade somente pela sessão do servidor", async () => {
    mocks.lerSessaoCliente.mockResolvedValue({ clienteId: "cli_real", telefone: "5599999999999" });

    const res = await POST(req({
      clienteId: "cli_falso",
      telefone: "00000000000",
      events: [EVENTO_VALIDO],
    }));

    expect(res.status).toBe(202);
    expect(mocks.registrarEventosClienteComportamento).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: "cli_real",
      events: [EVENTO_VALIDO],
    }));
    expect(res.headers.get("x-chefebot-analytics")).toBe("behavior-v1");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("sem login registra sessão anônima, nunca inventa cliente", async () => {
    const res = await POST(req({ events: [EVENTO_VALIDO] }));

    expect(res.status).toBe(202);
    expect(mocks.registrarEventosClienteComportamento).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: null,
    }));
  });
});
