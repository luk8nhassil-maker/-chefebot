import { describe, expect, test } from "vitest";
import {
  codinomeSecretoRanking,
  fimJanelaRevelacao,
  janelaRevelacaoAtiva,
} from "./rankingJogoSecreto";

describe("rankingJogoSecreto", () => {
  test("codinome é estável na mesma temporada", () => {
    expect(codinomeSecretoRanking("cli_1", "temp_1")).toBe(codinomeSecretoRanking("cli_1", "temp_1"));
    expect(codinomeSecretoRanking("cli_1", "temp_1")).toMatch(/\S+ \S+ \d{2}/);
  });

  test("codinome muda entre temporadas", () => {
    expect(codinomeSecretoRanking("cli_1", "temp_1")).not.toBe(codinomeSecretoRanking("cli_1", "temp_2"));
  });

  test("janela de revelação dura 30 dias exatos", () => {
    const encerrada = "2026-10-01T00:00:00.000Z";
    expect(fimJanelaRevelacao(encerrada)).toBe("2026-10-31T00:00:00.000Z");
    expect(janelaRevelacaoAtiva(encerrada, Date.parse("2026-10-31T00:00:00.000Z"))).toBe(true);
    expect(janelaRevelacaoAtiva(encerrada, Date.parse("2026-10-31T00:00:00.001Z"))).toBe(false);
  });
});
