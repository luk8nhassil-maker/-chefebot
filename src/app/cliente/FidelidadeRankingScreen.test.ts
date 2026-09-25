import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./FidelidadeRankingScreen.tsx", import.meta.url)), "utf-8");

describe("FidelidadeRankingScreen", () => {
  test("pódio e aba Participando usam a posição própria entre participantes, nunca a do ranking geral", () => {
    const blocoTela = fonte.slice(fonte.indexOf("function FidelidadeRankingScreen"), fonte.indexOf("return (", fonte.indexOf("function FidelidadeRankingScreen")));
    expect(blocoTela).toContain("ranking.participantes.lista");
    // Regressão: a versão antiga filtrava ranking.lista por participaCampanha
    // e reaproveitava a posição geral — não pode voltar.
    expect(blocoTela).not.toContain("lista.filter((entrada) => entrada.participaCampanha)");
  });
});
