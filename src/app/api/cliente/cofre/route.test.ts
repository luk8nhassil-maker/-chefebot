import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  lerSessaoCliente: vi.fn(),
  buscarClientePorId: vi.fn(),
  derivarClienteIdPorTelefone: vi.fn(),
  obterCofreClienteSomenteLeitura: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({
  lerSessaoCliente: mocks.lerSessaoCliente,
}));

vi.mock("@/lib/clientes", () => ({
  buscarClientePorId: mocks.buscarClientePorId,
}));

vi.mock("@/lib/fidelidade", () => ({
  derivarClienteIdPorTelefone: mocks.derivarClienteIdPorTelefone,
}));

vi.mock("@/lib/cofreChefReadModel", () => ({
  obterCofreClienteSomenteLeitura: mocks.obterCofreClienteSomenteLeitura,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lerSessaoCliente.mockResolvedValue({
    clienteId: "cli_sessao",
    telefone: "98999999999",
  });
  mocks.buscarClientePorId.mockResolvedValue({
    clienteId: "cli_sessao",
    telefone: "98999999999",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastLoginAt: "2026-09-01T00:00:00.000Z",
  });
  mocks.derivarClienteIdPorTelefone.mockReturnValue("cli_canonico");
  mocks.obterCofreClienteSomenteLeitura.mockResolvedValue({
    schemaVersao: 1,
    modo: "somente_leitura",
    disponivel: true,
    motivoIndisponibilidade: null,
    estrelas: { disponiveis: 35, scoreRankingTemporada: 90 },
    ranking: null,
    comportamento: null,
    proximaAcao: null,
    ofertas: [],
    economia: {
      beneficiosFinanceirosLiberados: false,
      motivo: "regras_economicas_nao_aprovadas",
    },
  });
});

describe("GET /api/cliente/cofre", () => {
  test("exige sessão do cliente", async () => {
    mocks.lerSessaoCliente.mockResolvedValue(null);

    const res = await GET(new NextRequest("https://chefedapizza.com.br/api/cliente/cofre"));

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.buscarClientePorId).not.toHaveBeenCalled();
    expect(mocks.obterCofreClienteSomenteLeitura).not.toHaveBeenCalled();
  });

  test("rejeita sessão cujo perfil não existe", async () => {
    mocks.buscarClientePorId.mockResolvedValue(null);

    const res = await GET(new NextRequest("https://chefedapizza.com.br/api/cliente/cofre"));

    expect(res.status).toBe(401);
    expect(mocks.obterCofreClienteSomenteLeitura).not.toHaveBeenCalled();
  });

  test("usa apenas o titular da sessão, ignorando clienteId arbitrário da URL", async () => {
    const res = await GET(new NextRequest(
      "https://chefedapizza.com.br/api/cliente/cofre?clienteId=cli_atacante",
    ));

    expect(res.status).toBe(200);
    expect(mocks.derivarClienteIdPorTelefone).toHaveBeenCalledWith("98999999999");
    expect(mocks.obterCofreClienteSomenteLeitura).toHaveBeenCalledTimes(1);
    expect(mocks.obterCofreClienteSomenteLeitura).toHaveBeenCalledWith({
      clienteId: "cli_canonico",
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-chefebot-cofre-mode")).toBe("read-only");

    const body = await res.json();
    expect(body.ofertas).toEqual([]);
    expect(body.economia.beneficiosFinanceirosLiberados).toBe(false);
  });

  test("mantém fallback para clienteId do perfil quando telefone não deriva", async () => {
    mocks.derivarClienteIdPorTelefone.mockReturnValue(undefined);

    await GET(new NextRequest("https://chefedapizza.com.br/api/cliente/cofre"));

    expect(mocks.obterCofreClienteSomenteLeitura).toHaveBeenCalledWith({
      clienteId: "cli_sessao",
    });
  });
});
