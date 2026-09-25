import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./RankingInviteModal.tsx", import.meta.url)), "utf-8");

describe("RankingInviteModal — convite transparente", () => {
  test("usa a mensagem de produto aprovada sem prometer gratuidade", () => {
    expect(fonte).toContain("Suas estrelas podem valer prêmios");
    expect(fonte).toContain("Você já está juntando estrelas.");
    expect(fonte).toContain("Quero participar");
    expect(fonte).not.toContain("GRÁTIS");
  });

  test("explica a exposicao concreta e mantem saida sem pressao", () => {
    expect(fonte).toContain("Primeiro nome + telefone mascarado");
    expect(fonte).toContain("você escolhe o que autorizar.");
    expect(fonte).toContain("Talvez depois");
    expect(fonte).toContain("Você pode mudar essa escolha depois.");
  });
});
