import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./RankingInviteModal.tsx", import.meta.url)), "utf-8");

describe("RankingInviteModal — convite transparente", () => {
  test("explica a disputa sem prometer prêmio não configurado", () => {
    expect(fonte).toContain("Entre no Ranking do Chefe");
    expect(fonte).toContain("Quer disputar posições");
    expect(fonte).toContain("Quero participar");
    expect(fonte).not.toContain("GRÁTIS");
    expect(fonte).not.toContain("Suas estrelas podem valer prêmios");
  });

  test("explica a exposicao concreta e mantem saida sem pressao", () => {
    expect(fonte).toContain("Você começa anônimo");
    expect(fonte).toContain("nome e telefone só se autorizar.");
    expect(fonte).toContain("Talvez depois");
    expect(fonte).toContain("Você pode mudar essa escolha depois.");
  });
});
