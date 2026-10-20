import { describe, expect, it, vi } from "vitest";
import type { EntradaRanking } from "../rankingClientes";
import type { Ranking3Store } from "./store";
import {
  PRIMEIRA_TEMPORADA_HISTORICA,
  auditarPrimeiroParticipanteLegitimo,
  concederPremioExcepcionalPrimeiraTemporada,
} from "./historico";

const encerrada = {
  temporadaId: PRIMEIRA_TEMPORADA_HISTORICA,
  tenantId: "default",
  estado: "encerrada" as const,
  fimEm: "2026-10-19T15:22:57.965Z",
};
const ranking: EntradaRanking[] = [
  { clienteId: "lider-geral-sem-consentimento", score: 38, posicao: 1 },
  { clienteId: "primeiro-participante-legitimo", score: 32, posicao: 2 },
  { clienteId: "outro-participante", score: 32, posicao: 3 },
];

function deps(overrides: Partial<Parameters<typeof auditarPrimeiroParticipanteLegitimo>[2]> = {}) {
  return {
    temporada: vi.fn().mockResolvedValue(encerrada),
    resultado: vi.fn().mockResolvedValue(null),
    ranking: vi.fn().mockResolvedValue(ranking),
    elegivel: vi.fn(async (id: string) => id !== "lider-geral-sem-consentimento"),
    resgate: vi.fn().mockResolvedValue(null),
    store: { premio: vi.fn().mockResolvedValue(null), concederExcecaoHistorica: vi.fn() } as unknown as Ranking3Store,
    ...overrides,
  };
}

describe("Ranking3 — primeira temporada histórica", () => {
  it("ignora o líder geral inelegível e preserva o desempate já ordenado", async () => {
    const d = deps();
    const resultado = await auditarPrimeiroParticipanteLegitimo("default", PRIMEIRA_TEMPORADA_HISTORICA, d);
    expect(resultado).toMatchObject({ estado: "pronto_para_conceder", vencedor: { clienteId: "primeiro-participante-legitimo", score: 32, posicao: 2 } });
    expect(d.elegivel).toHaveBeenCalledTimes(2);
    expect(d.resgate).toHaveBeenCalledWith("default", PRIMEIRA_TEMPORADA_HISTORICA, "primeiro-participante-legitimo");
  });

  it("não concede se já houver resultado materializado ou resgate anterior", async () => {
    expect((await auditarPrimeiroParticipanteLegitimo("default", PRIMEIRA_TEMPORADA_HISTORICA, deps({ resultado: vi.fn().mockResolvedValue({}) }))).estado).toBe("resultado_historico_ja_existe");
    expect((await auditarPrimeiroParticipanteLegitimo("default", PRIMEIRA_TEMPORADA_HISTORICA, deps({ resgate: vi.fn().mockResolvedValue({ codigoPublico: "PREM-ANTIGO" }) }))).estado).toBe("resgate_legado_ja_existe");
  });

  it("faz a concessão somente para o vencedor auditado", async () => {
    const conceder = vi.fn().mockResolvedValue({ premio: { id: "r3-legado-t-1789830947840-liga-1", estado: "disponivel", origem: "excecao_historica" } });
    const store = { premio: vi.fn().mockResolvedValue(null), concederExcecaoHistorica: conceder } as unknown as Ranking3Store;
    const resultado = await concederPremioExcepcionalPrimeiraTemporada("default", deps({ store }));
    expect(resultado).toMatchObject({ estado: "concedido", vencedor: { clienteId: "primeiro-participante-legitimo" }, premio: { origem: "excecao_historica" } });
    expect(conceder).toHaveBeenCalledWith(expect.objectContaining({ temporadaId: PRIMEIRA_TEMPORADA_HISTORICA, clienteId: "primeiro-participante-legitimo", posicao: 2, score: 32 }));
  });

  it("recusa outra temporada ou tenant por segurança", async () => {
    await expect(auditarPrimeiroParticipanteLegitimo("outro", PRIMEIRA_TEMPORADA_HISTORICA, deps())).rejects.toThrow("temporada_historica_nao_autorizada");
  });
});
