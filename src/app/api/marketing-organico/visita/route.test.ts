import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  sessao: vi.fn(),
  cliente: vi.fn(),
  derivar: vi.fn(),
  confirmar: vi.fn(),
  resolver: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({ lerSessaoCliente: mocks.sessao }));
vi.mock("@/lib/clientes", () => ({ buscarClientePorId: mocks.cliente }));
vi.mock("@/lib/fidelidade", () => ({ derivarClienteIdPorTelefone: mocks.derivar }));
vi.mock("@/lib/rankingMissaoDivulgacao", () => ({
  confirmarAberturaConviteDivulgacao: mocks.confirmar,
  resolverConviteDivulgacao: mocks.resolver,
}));

import { POST } from "./route";

function req(body: unknown, cookie?: string) {
  return new NextRequest("https://chefedapizza.com.br/api/marketing-organico/visita", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessao.mockResolvedValue(null);
  mocks.confirmar.mockResolvedValue({ valido: true, refToken: "abcdefghijklmnopqrstuvwx", bonus: "creditado" });
  mocks.resolver.mockResolvedValue({ clienteId: "cli_dono" });
});

describe("POST /api/marketing-organico/visita", () => {
  test("token válido preserva a indicação no destino", async () => {
    const res = await POST(req({ token: "ABCDEFGHIJKLMNOPQRSTUVWX" }));
    const body = await res.json();
    expect(body.destino).toBe("/pedido?ref=abcdefghijklmnopqrstuvwx");
    expect(mocks.confirmar).toHaveBeenCalledWith({
      token: "ABCDEFGHIJKLMNOPQRSTUVWX",
      visitanteClienteId: null,
    });
  });

  test("navegador que criou o link é tratado como autoabertura", async () => {
    await POST(req(
      { token: "ABCDEFGHIJKLMNOPQRSTUVWX" },
      "cf_marketing_owner=ABCDEFGHIJKLMNOPQRSTUVWX",
    ));
    expect(mocks.resolver).toHaveBeenCalledWith("ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(mocks.confirmar).toHaveBeenCalledWith({
      token: "ABCDEFGHIJKLMNOPQRSTUVWX",
      visitanteClienteId: "cli_dono",
    });
  });

  test("visitante autenticado diferente é identificado sem expor dado", async () => {
    mocks.sessao.mockResolvedValue({ clienteId: "perfil_visitante" });
    mocks.cliente.mockResolvedValue({ clienteId: "perfil_visitante", telefone: "5599999990002" });
    mocks.derivar.mockReturnValue("cli_visitante");
    await POST(req({ token: "ABCDEFGHIJKLMNOPQRSTUVWX" }));
    expect(mocks.confirmar).toHaveBeenCalledWith({
      token: "ABCDEFGHIJKLMNOPQRSTUVWX",
      visitanteClienteId: "cli_visitante",
    });
  });

  test("token inválido cai no cardápio sem ref", async () => {
    mocks.confirmar.mockResolvedValueOnce({ valido: false, refToken: null, bonus: "nao_elegivel" });
    const body = await (await POST(req({ token: "INVALIDO" }))).json();
    expect(body.destino).toBe("/pedido");
  });
});
