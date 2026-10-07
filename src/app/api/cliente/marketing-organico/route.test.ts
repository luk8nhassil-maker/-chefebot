import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  sessao: vi.fn(),
  cliente: vi.fn(),
  derivar: vi.fn(),
  convite: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({ lerSessaoCliente: mocks.sessao }));
vi.mock("@/lib/clientes", () => ({ buscarClientePorId: mocks.cliente }));
vi.mock("@/lib/fidelidade", () => ({ derivarClienteIdPorTelefone: mocks.derivar }));
vi.mock("@/lib/rankingMissaoDivulgacao", () => ({ obterOuCriarConviteDivulgacao: mocks.convite }));

import { GET } from "./route";

function req() {
  return new NextRequest("https://chefedapizza.com.br/api/cliente/marketing-organico");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessao.mockResolvedValue({ clienteId: "perfil_1" });
  mocks.cliente.mockResolvedValue({ clienteId: "perfil_1", telefone: "5599999990001" });
  mocks.derivar.mockReturnValue("cli_1");
  mocks.convite.mockResolvedValue({
    estado: { ativa: true, elegivel: true, concluidaHoje: false, bonus: 3, expedienteId: "2026-10-07", motivoBloqueio: null },
    token: "ABCDEFGHIJKLMNOPQRSTUVWX",
    refToken: "abcdefghijklmnopqrstuvwx",
    premioDescricao: "1 Pizza Família",
  });
});

describe("GET /api/cliente/marketing-organico", () => {
  test("exige sessão", async () => {
    mocks.sessao.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  test("gera link rastreado e mensagem honesta com prêmio aprovado", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe("https://chefedapizza.com.br/m/ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(body.mensagem).toContain("1 Pizza Família");
    expect(body.mensagem).toContain("conforme as regras");
    expect(res.headers.get("set-cookie")).toContain("cf_marketing_owner=ABCDEFGHIJKLMNOPQRSTUVWX");
  });

  test("sem prêmio aprovado não promete pizza grátis", async () => {
    mocks.convite.mockResolvedValueOnce({
      estado: { ativa: true, elegivel: true, concluidaHoje: false, bonus: 3, expedienteId: "2026-10-07", motivoBloqueio: null },
      token: "ABCDEFGHIJKLMNOPQRSTUVWX",
      refToken: "abcdefghijklmnopqrstuvwx",
      premioDescricao: null,
    });
    const body = await (await GET(req())).json();
    expect(body.mensagem).toContain("juntar Estrelas");
    expect(body.mensagem.toLowerCase()).not.toContain("pizza grátis");
  });
});
