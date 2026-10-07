import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  lerSessao: vi.fn(),
  buscarCliente: vi.fn(),
  derivar: vi.fn(),
  regra: vi.fn(),
  resultado: vi.fn(),
  janelaAtiva: vi.fn(),
  lerBlob: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({ lerSessaoCliente: mocks.lerSessao }));
vi.mock("@/lib/clientes", () => ({ buscarClientePorId: mocks.buscarCliente }));
vi.mock("@/lib/fidelidade", () => ({ derivarClienteIdPorTelefone: mocks.derivar }));
vi.mock("@/lib/consentimentoRanking", () => ({ obterRegraJogoSecretoRanking: mocks.regra }));
vi.mock("@/lib/temporadaResultado", () => ({ obterResultadoTemporada: mocks.resultado }));
vi.mock("@/lib/rankingJogoSecreto", () => ({ janelaRevelacaoAtiva: mocks.janelaAtiva }));
vi.mock("@/lib/perfilFotoStorage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/perfilFotoStorage")>("@/lib/perfilFotoStorage");
  return { ...actual, lerFotoPerfilBlob: mocks.lerBlob };
});

import { GET } from "./route";

function req(query = "?temporadaId=temp_1&posicao=1") {
  return new NextRequest(`https://chefedapizza.com.br/api/cliente/ranking/resultado-foto${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lerSessao.mockResolvedValue({ clienteId: "cli_viewer" });
  mocks.derivar.mockReturnValue("cli_viewer");
  mocks.buscarCliente.mockImplementation(async (id: string) => id === "cli_viewer"
    ? { clienteId: "cli_viewer", telefone: "5599999990001" }
    : { clienteId: "cli_alvo", telefone: "5599999990002", fotoPerfilPathname: "perfil/x/avatar", fotoPerfilContentType: "image/webp" });
  mocks.regra.mockResolvedValue({ participa: true, aceitaRevelacao30d: true });
  mocks.janelaAtiva.mockReturnValue(true);
  mocks.resultado.mockResolvedValue({
    temporadaId: "temp_1",
    encerradaEm: "2026-10-01T00:00:00.000Z",
    participantesTopo: [{ clienteId: "cli_alvo", posicao: 1, score: 100 }],
  });
  mocks.lerBlob.mockResolvedValue(new Response(new Uint8Array([1,2,3]), {
    headers: { "Content-Type": "image/webp", ETag: "etag-x" },
  }));
});

describe("GET /api/cliente/ranking/resultado-foto", () => {
  test("exige sessão e regra ativa do observador", async () => {
    mocks.lerSessao.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);

    mocks.lerSessao.mockResolvedValue({ clienteId: "cli_viewer" });
    mocks.regra.mockResolvedValueOnce({ participa: false, aceitaRevelacao30d: false });
    expect((await GET(req())).status).toBe(403);
  });

  test("não serve foto fora da janela de 30 dias", async () => {
    mocks.janelaAtiva.mockReturnValue(false);
    expect((await GET(req())).status).toBe(404);
    expect(mocks.lerBlob).not.toHaveBeenCalled();
  });

  test("não serve foto se o dono do perfil saiu do jogo", async () => {
    mocks.regra
      .mockResolvedValueOnce({ participa: true, aceitaRevelacao30d: true })
      .mockResolvedValueOnce({ participa: false, aceitaRevelacao30d: false });
    expect((await GET(req())).status).toBe(404);
    expect(mocks.lerBlob).not.toHaveBeenCalled();
  });

  test("serve somente a foto da posição resolvida no snapshot", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(mocks.buscarCliente).toHaveBeenCalledWith("cli_alvo");
    expect(mocks.lerBlob).toHaveBeenCalledWith("perfil/x/avatar");
  });
});
