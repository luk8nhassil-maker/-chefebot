import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  usuarioAssinatura: vi.fn(),
  consultarEventosAnaliticosComFallback: vi.fn(),
  calcularRadarVendas: vi.fn(),
  statusAcessoRadarVendas: vi.fn(),
}));

vi.mock("@/lib/assinaturaApiAuth", () => ({ usuarioAssinatura: mocks.usuarioAssinatura }));
vi.mock("@/lib/historicoAnalitico", () => ({ TENANT_PADRAO_ANALYTICS: "default" }));
vi.mock("@/lib/analyticsPedidosReadModel.server", () => ({
  consultarEventosAnaliticosComFallback: mocks.consultarEventosAnaliticosComFallback,
}));
vi.mock("@/lib/radarVendas", () => ({ calcularRadarVendas: mocks.calcularRadarVendas }));
vi.mock("@/lib/radarVendasEntitlement.server", () => ({ statusAcessoRadarVendas: mocks.statusAcessoRadarVendas }));

import { GET } from "./route";

function req() { return new NextRequest("https://chefedapizza.com.br/api/admin/radar-vendas"); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usuarioAssinatura.mockResolvedValue({ username: "admin", role: "admin" });
  mocks.consultarEventosAnaliticosComFallback.mockResolvedValue({
    eventos: [],
    fallbackTodos: [],
    fonte: { indiceDisponivel: true, fallbackPedidosDisponivel: true, eventosIndice: 0, eventosFallbackAdicionados: 0, origem: "pedidos" },
  });
  mocks.statusAcessoRadarVendas.mockResolvedValue({
    ativo: false, fonte: "bloqueado", currentPlanId: "basic", assinaturaBloqueada: false, desbloqueioPermanente: false,
  });
  mocks.calcularRadarVendas.mockReturnValue({
    resumo: {
      schemaVersion: 2, mode: "sales_radar_read_only", janelaAnaliseDias: 180,
      clientesAnalisados: 12, clientesComPadrao: 5, altaConfianca: 2, emJanelaAgora: 1,
      oportunidadesAtivas: 3, oportunidadesMetaTicket: 1, ticketMedioBaseCents: 6500, potencialTicketAdicionalCents: 900,
    },
    oportunidades: [{ clienteRef: "•••• 1234", score: 90 }],
  });
});

describe("GET /api/admin/radar-vendas", () => {
  test("bloqueia atendente", async () => {
    mocks.usuarioAssinatura.mockResolvedValue({ username: "a", role: "atendente" });
    expect((await GET(req())).status).toBe(401);
  });

  test("preview bloqueado usa dados reais e esconde clientes", async () => {
    const body = await (await GET(req())).json();
    expect(body.summary.potencialTicketAdicionalCents).toBe(900);
    expect(body.opportunities).toEqual([]);
    expect(body.dataSource.origem).toBe("pedidos");
  });

  test("acesso ativo recebe oportunidades mascaradas", async () => {
    mocks.statusAcessoRadarVendas.mockResolvedValue({
      ativo: true, fonte: "pro", currentPlanId: "pro", assinaturaBloqueada: false, desbloqueioPermanente: false,
    });
    const body = await (await GET(req())).json();
    expect(body.opportunities).toEqual([{ clienteRef: "•••• 1234", score: 90 }]);
    expect(JSON.stringify(body)).not.toContain("cli_");
  });
});
