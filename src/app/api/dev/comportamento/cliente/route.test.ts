import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  behaviorAnalyticsEnabled: vi.fn(),
  consultarTimelineComportamentalCliente: vi.fn(),
  resumirTimelineComportamentalCliente: vi.fn(),
  derivarClienteIdPorTelefone: vi.fn(),
  sanitizeTelefoneCliente: vi.fn(),
  consultarEventosCliente: vi.fn(),
  calcularRitmoCompraCliente: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("@/lib/behaviorAnalytics", () => ({
  behaviorAnalyticsEnabled: mocks.behaviorAnalyticsEnabled,
}));
vi.mock("@/lib/behaviorAnalyticsRead", () => ({
  consultarTimelineComportamentalCliente: mocks.consultarTimelineComportamentalCliente,
  resumirTimelineComportamentalCliente: mocks.resumirTimelineComportamentalCliente,
}));
vi.mock("@/lib/fidelidade", () => ({
  derivarClienteIdPorTelefone: mocks.derivarClienteIdPorTelefone,
}));
vi.mock("@/lib/clientes", () => ({
  sanitizeTelefoneCliente: mocks.sanitizeTelefoneCliente,
}));
vi.mock("@/lib/historicoAnalitico", () => ({
  consultarEventosCliente: mocks.consultarEventosCliente,
  TENANT_PADRAO_ANALYTICS: "default",
}));
vi.mock("@/lib/purchaseTiming", () => ({
  calcularRitmoCompraCliente: mocks.calcularRitmoCompraCliente,
}));

import { POST } from "./route";

function req(body: unknown) {
  const r = new NextRequest("https://chefedapizza.com.br/api/dev/comportamento/cliente", {
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
  mocks.verifyToken.mockResolvedValue({ username: "ominix", role: "dev" });
  mocks.sanitizeTelefoneCliente.mockImplementation((v) => typeof v === "string" ? v.replace(/\D/g, "") : "");
  mocks.derivarClienteIdPorTelefone.mockImplementation((v) => v.length >= 10 ? "cli_canonico" : undefined);
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
  mocks.consultarEventosCliente.mockResolvedValue([]);
  mocks.calcularRitmoCompraCliente.mockReturnValue({
    schemaVersion: 1,
    mode: "purchase_timing_read_only",
    janelaAnaliseDias: 180,
    pedidosAnalisados: 4,
    primeiraCompraEmMs: 1,
    ultimaCompraEmMs: 2,
    faseMes: "inicio",
    faseMesLabel: "Comeco do mes",
    concentracaoPercentual: 75,
    confianca: "media",
    janelaProvavel: { inicioDia: 3, fimDia: 7 },
    diaCentralProvavel: 5,
    diaSemanaMaisForte: { indice: 5, label: "sexta", percentual: 50 },
    horarioMaisForte: { inicioHora: 18, fimHora: 21, percentual: 50 },
    distribuicaoMes: { inicio: 3, meio: 1, fim: 0 },
  });
  mocks.resumirTimelineComportamentalCliente.mockReturnValue({
    schemaVersion: 1,
    mode: "behavior_customer_summary_read_only",
    sessions: 1,
    sessionsWithOrder: 0,
    sessionsWithoutOrder: 1,
    appOpens: 1,
    searches: 0,
    productViews: 0,
    cartInteractions: 0,
    checkoutStarts: 0,
    rankingOpens: 0,
    fidelityOpens: 0,
    totalEngagementSeconds: 0,
    medianEngagementSeconds: null,
    medianDaysBetweenSessions: null,
    firstSeenAtMs: 1,
    lastSeenAtMs: 1,
  });
});

describe("POST /api/dev/comportamento/cliente", () => {
  test("gate fechado não processa telefone", async () => {
    mocks.behaviorAnalyticsEnabled.mockReturnValue(false);
    const res = await POST(req({ telefone: "5599999999999" }));
    expect(res.status).toBe(404);
    expect(mocks.sanitizeTelefoneCliente).not.toHaveBeenCalled();
  });

  test("somente dev pode consultar; admin do dono fica bloqueado", async () => {
    mocks.verifyToken.mockResolvedValue({ username: "admin", role: "admin" });
    expect((await POST(req({ telefone: "5599999999999" }))).status).toBe(401);
  });

  test("telefone inválido falha fechado", async () => {
    mocks.derivarClienteIdPorTelefone.mockReturnValue(undefined);
    const res = await POST(req({ telefone: "12" }));
    expect(res.status).toBe(400);
    expect(mocks.consultarTimelineComportamentalCliente).not.toHaveBeenCalled();
    expect(mocks.consultarEventosCliente).not.toHaveBeenCalled();
  });

  test("resolve o cliente no servidor e mantém o read model sem dados pessoais", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
    const res = await POST(req({ telefone: "(55) 99999-9999", periodo: 30, clienteId: "forjado" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.consultarTimelineComportamentalCliente).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: "cli_canonico",
    }));
    expect(mocks.consultarEventosCliente).toHaveBeenCalledWith(
      "default",
      "cli_canonico",
      1_000_000_000 - 180 * 24 * 60 * 60 * 1000,
      1_000_000_000,
    );
    expect(body).not.toHaveProperty("cliente");
    expect(body.summary).toEqual(expect.objectContaining({
      sessions: 1,
      sessionsWithoutOrder: 1,
      appOpens: 1,
    }));
    expect(mocks.resumirTimelineComportamentalCliente).toHaveBeenCalledWith(body.timeline.events);
    expect(body.purchaseTiming).toEqual(expect.objectContaining({
      faseMes: "inicio",
      concentracaoPercentual: 75,
      pedidosAnalisados: 4,
    }));
    expect(mocks.calcularRitmoCompraCliente).toHaveBeenCalledWith([], 180);
    const serializado = JSON.stringify(body);
    expect(serializado).not.toContain("5599999999999");
    expect(serializado).not.toContain("actorHash");
    expect(serializado).not.toContain("Maria");
    expect(serializado).not.toContain("Mah");
    expect(serializado).not.toContain("forjado");
    expect(serializado).not.toContain("endereco");
    expect(serializado).not.toContain("logradouro");
    dateSpy.mockRestore();
  });
});
