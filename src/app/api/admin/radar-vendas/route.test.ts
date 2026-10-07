import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  usuarioAssinatura: vi.fn(),
  consultarEventosPorPeriodo: vi.fn(),
  calcularRadarVendas: vi.fn(),
  statusAcessoRadarVendas: vi.fn(),
}));

vi.mock("@/lib/assinaturaApiAuth", () => ({ usuarioAssinatura: mocks.usuarioAssinatura }));
vi.mock("@/lib/historicoAnalitico", () => ({
  consultarEventosPorPeriodo: mocks.consultarEventosPorPeriodo,
  TENANT_PADRAO_ANALYTICS: "default",
}));
vi.mock("@/lib/radarVendas", () => ({ calcularRadarVendas: mocks.calcularRadarVendas }));
vi.mock("@/lib/radarVendasEntitlement.server", () => ({ statusAcessoRadarVendas: mocks.statusAcessoRadarVendas }));

import { GET } from "./route";

function req() {
  return new NextRequest("https://chefedapizza.com.br/api/admin/radar-vendas");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usuarioAssinatura.mockResolvedValue({ username: "admin", role: "admin" });
  mocks.consultarEventosPorPeriodo.mockResolvedValue([]);
  mocks.statusAcessoRadarVendas.mockResolvedValue({
    ativo: false,
    fonte: "bloqueado",
    currentPlanId: "basic",
    assinaturaBloqueada: false,
    desbloqueioPermanente: false,
  });
  mocks.calcularRadarVendas.mockReturnValue({
    resumo: {
      schemaVersion: 2,
      mode: "sales_radar_read_only",
      janelaAnaliseDias: 180,
      clientesAnalisados: 12,
      clientesComPadrao: 5,
      altaConfianca: 2,
      emJanelaAgora: 1,
      oportunidadesAtivas: 3,
      oportunidadesMetaTicket: 1,
      ticketMedioBaseCents: 6500,
      potencialTicketAdicionalCents: 900,
    },
    oportunidades: [{ clienteRef: "•••• 1234", score: 90 }],
  });
});

describe("GET /api/admin/radar-vendas", () => {
  test("bloqueia role não autorizada", async () => {
    mocks.usuarioAssinatura.mockResolvedValue({ username: "atendente", role: "atendente" });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.consultarEventosPorPeriodo).not.toHaveBeenCalled();
  });

  test("plano bloqueado vê preview agregado, mas não vê oportunidades", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary.clientesComPadrao).toBe(5);
    expect(body.summary.potencialTicketAdicionalCents).toBe(900);
    expect(body.opportunities).toEqual([]);
    expect(body.access).toMatchObject({ active: false, currentPlanId: "basic", upgradePlanId: "pro" });
  });

  test("acesso ativo recebe oportunidades mascaradas", async () => {
    mocks.statusAcessoRadarVendas.mockResolvedValue({
      ativo: true,
      fonte: "pro",
      currentPlanId: "pro",
      assinaturaBloqueada: false,
      desbloqueioPermanente: false,
    });
    const res = await GET(req());
    const body = await res.json();
    expect(body.opportunities).toEqual([{ clienteRef: "•••• 1234", score: 90 }]);
    expect(JSON.stringify(body)).not.toContain("cli_");
  });
});
