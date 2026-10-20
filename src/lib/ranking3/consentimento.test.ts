import { describe, it, expect } from "vitest";
import { elegibilidadeRankingNoCorte } from "../consentimentoRanking";
const registro = (ativo: boolean, registradoEm: string, aceitaRevelacao30d = true) => ({ ativo, registradoEm, aceitaRevelacao30d, eventoId: "sintetico", origem: "area_cliente_autenticada", versao: "ranking-participacao-v2" });
describe("Ranking3 — participação no corte, sem depender de exposição pública", () => {
  it("saída depois da virada não muda retroativamente vencedor elegível", () => {
    const corte = Date.parse("2026-11-19T06:00:00Z");
    const historico = [registro(false, "2026-11-20T06:00:00Z"), registro(true, "2026-10-20T06:00:00Z")];
    expect(elegibilidadeRankingNoCorte(historico, corte)).toBe(true);
    expect(elegibilidadeRankingNoCorte(historico, Date.parse("2026-11-21T06:00:00Z"))).toBe(false);
  });
  it("não inventa consentimento em dado ausente, corrompido ou futuro", () => {
    const corte = Date.parse("2026-11-19T06:00:00Z");
    expect(elegibilidadeRankingNoCorte([], corte)).toBe(false);
    expect(elegibilidadeRankingNoCorte([{ ativo: true }], corte)).toBe(false);
    expect(elegibilidadeRankingNoCorte([registro(true, "2026-11-20T06:00:00Z")], corte)).toBe(false);
    expect(elegibilidadeRankingNoCorte([registro(true, "2026-11-18T06:00:00Z", false)], corte)).toBe(false);
  });
});
