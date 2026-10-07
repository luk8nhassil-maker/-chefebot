import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  lerSessao: vi.fn(),
  buscarCliente: vi.fn(),
  derivar: vi.fn(),
  regra: vi.fn(),
  listar: vi.fn(),
  garantir: vi.fn(),
  projetar: vi.fn(),
  janelaAtiva: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({ lerSessaoCliente: mocks.lerSessao }));
vi.mock("@/lib/clientes", () => ({ buscarClientePorId: mocks.buscarCliente }));
vi.mock("@/lib/fidelidade", () => ({ derivarClienteIdPorTelefone: mocks.derivar }));
vi.mock("@/lib/consentimentoRanking", () => ({ obterRegraJogoSecretoRanking: mocks.regra }));
vi.mock("@/lib/temporadas", () => ({ listarTemporadas: mocks.listar }));
vi.mock("@/lib/temporadaResultado", () => ({
  garantirResultadoTemporada: mocks.garantir,
  projetarResultadoTemporada: mocks.projetar,
}));
vi.mock("@/lib/rankingJogoSecreto", () => ({ janelaRevelacaoAtiva: mocks.janelaAtiva }));

import { GET } from "./route";

function req() {
  return new NextRequest("https://chefedapizza.com.br/api/cliente/ranking/resultado-recente");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lerSessao.mockResolvedValue({ clienteId: "cli_viewer" });
  mocks.buscarCliente.mockResolvedValue({ clienteId: "cli_viewer", telefone: "5599999990001" });
  mocks.derivar.mockReturnValue("cli_viewer");
  mocks.regra.mockResolvedValue({ participa: true, aceitaRevelacao30d: true });
  mocks.janelaAtiva.mockReturnValue(true);
  mocks.listar.mockResolvedValue([
    { temporadaId: "antiga", estado: "encerrada", encerradaEm: "2026-09-01T00:00:00.000Z" },
    { temporadaId: "recente", estado: "encerrada", encerradaEm: "2026-10-01T00:00:00.000Z" },
  ]);
  mocks.garantir.mockResolvedValue({ temporadaId: "recente", encerradaEm: "2026-10-01T00:00:00.000Z" });
  mocks.projetar.mockResolvedValue({
    temporadaId: "recente",
    encerradaEm: "2026-10-01T00:00:00.000Z",
    revelacaoAte: "2026-10-31T00:00:00.000Z",
    premioDescricao: null,
    participantesTopo: [
      {
        posicao: 1,
        score: 100,
        identidade: {
          participaCampanha: true,
          nomePublico: "Ana",
          telefoneMascarado: null,
          fotoPerfilUrl: null,
          codinomeSecreto: "Chef Brasa 42",
          revelado: true,
        },
      },
      {
        posicao: 2,
        score: 90,
        identidade: {
          participaCampanha: false,
          nomePublico: null,
          telefoneMascarado: null,
          fotoPerfilUrl: null,
          codinomeSecreto: "Ninja Forno 18",
          revelado: false,
        },
      },
    ],
  });
});

describe("GET /api/cliente/ranking/resultado-recente", () => {
  test("exige sessão", async () => {
    mocks.lerSessao.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  test("quem não mantém a regra do jogo não recebe resultado", async () => {
    mocks.regra.mockResolvedValue({ participa: true, aceitaRevelacao30d: false });
    const body = await (await GET(req())).json();
    expect(body).toEqual({ resultado: null, motivo: "regra_jogo_inativa" });
    expect(mocks.listar).not.toHaveBeenCalled();
  });

  test("entrega só a temporada encerrada mais recente dentro da janela", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(mocks.garantir).toHaveBeenCalledWith("default", "recente");
    expect(body.resultado.temporadaId).toBe("recente");
    expect(body.resultado.participantesTopo).toHaveLength(1);
    expect(body.resultado.participantesTopo[0].identidade.nomePublico).toBe("Ana");
    expect(JSON.stringify(body)).not.toContain("cli_");
    expect(JSON.stringify(body)).not.toContain("telefone");
  });
});
