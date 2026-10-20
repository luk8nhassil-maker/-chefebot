import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ classificacao: vi.fn(), top10: [] as string[] }));
vi.mock("../redis", () => ({ redis: { get: async () => -1 } }));
vi.mock("./store", () => ({ Ranking3Store: class {
  async atual() { return { id: "r3-2026-10-20-0", indice: 0, inicio: "2026-10-20T06:00:00Z", fim: "2026-11-19T06:00:00Z" }; }
  async carteira() { return []; }
  async cohort() { return { top10: m.top10, nivel3: [], meta: 15, pendentes: [] }; }
  chave(s: string) { return s; }
  classificacao = m.classificacao;
} }));
vi.mock("../consentimentoRanking", () => ({ obterRegrasJogoSecretoParaClientes: async (ids: string[]) => new Map(ids.map((id) => [id, { participa: true, aceitaRevelacao30d: true }])) }));
import { painelRanking3 } from "./server";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("RANKING3_ENABLED", "true"); m.top10 = []; });
afterEach(() => vi.unstubAllEnvs());
describe("Ranking3 — leitura econômica da projeção, sem apuração no GET", () => {
  it("reaproveita ordem da projeção inclusive em empate, sem consultar todos os ledgers", async () => {
    const painel = await painelRanking3("a", Date.now(), [{ clienteId: "b", score: 10, posicao: 1 }, { clienteId: "a", score: 10, posicao: 2 }]);
    expect(painel && !painel.atualizando && painel.posicao).toBe(2);
    expect(m.classificacao).not.toHaveBeenCalled();
  });
  it("mantém Liga Top 10 separada, sem acrescentar posição de outra liga", async () => {
    m.top10 = ["a"];
    const painel = await painelRanking3("a", Date.now(), [{ clienteId: "b", score: 30, posicao: 1 }, { clienteId: "a", score: 10, posicao: 2 }]);
    expect(painel).toMatchObject({ liga: 2, posicao: 1, meta: 15, lista: [{ posicao: 1, score: 10, eVoce: true }] });
    expect(m.classificacao).not.toHaveBeenCalled();
  });
});
