import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  garantirResultado: vi.fn(),
}));

vi.mock("./redis", () => ({ redis: { get: mocks.get, set: mocks.set } }));
vi.mock("./temporadaResultado", () => ({
  garantirResultadoTemporada: mocks.garantirResultado,
  obterResultadoTemporada: vi.fn(),
}));

import { obterResgatePremio, solicitarResgatePremio } from "./temporadaPremioResgate";

const resultado = {
  tenantId: "default",
  temporadaId: "temp-1",
  encerradaEm: "2026-10-08T12:00:00.000Z",
  premioDescricao: "1 Pizza Família",
  premioQuantidadePremiados: 1,
  premioAprovado: true,
  vencedorDeclarado: true,
  participantesTopo: [{ clienteId: "cli-1", posicao: 1, score: 80 }],
  geralTopo: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.garantirResultado.mockResolvedValue(resultado);
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue("OK");
});

describe("temporadaPremioResgate", () => {
  test("só permite o vencedor e grava um único código", async () => {
    const primeiro = await solicitarResgatePremio({ tenantId: "default", temporadaId: "temp-1", clienteId: "cli-1" });
    expect(primeiro.ok).toBe(true);
    if (primeiro.ok) {
      expect(primeiro.resgate.descricaoPremio).toBe("1 Pizza Família");
      expect(primeiro.resgate.codigoPublico).toMatch(/^PREM-[A-Z0-9]{10}$/);
    }
    expect(mocks.set).toHaveBeenCalledWith(
      "temporada:premio-resgate:default:temp-1:cli-1",
      expect.objectContaining({ status: "solicitado" }),
      { nx: true },
    );
  });

  test("recusa quem não está entre os premiados", async () => {
    const retorno = await solicitarResgatePremio({ tenantId: "default", temporadaId: "temp-1", clienteId: "cli-2" });
    expect(retorno).toEqual({ ok: false, codigo: "nao_elegivel", resgate: null });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  test("é idempotente quando o cliente clica de novo", async () => {
    const existente = {
      tenantId: "default", temporadaId: "temp-1", clienteId: "cli-1",
      codigoPublico: "PREM-ABC1234567", descricaoPremio: "1 Pizza Família",
      posicao: 1, score: 80, status: "solicitado" as const, solicitadoEm: "2026-10-08T12:00:00.000Z",
    };
    mocks.get.mockResolvedValue(existente);
    const retorno = await solicitarResgatePremio({ tenantId: "default", temporadaId: "temp-1", clienteId: "cli-1" });
    expect(retorno).toEqual({ ok: true, resgate: existente, jaExistia: true });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  test("consulta o registro sem aceitar identificador arbitrário além da chave", async () => {
    await obterResgatePremio("default", "temp-1", "cli-1");
    expect(mocks.get).toHaveBeenCalledWith("temporada:premio-resgate:default:temp-1:cli-1");
  });
});
