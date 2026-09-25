import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const client = readFileSync(fileURLToPath(new URL("./RankingProspeccaoPreview.tsx", import.meta.url)), "utf-8");

describe("Preview seguro da prospeccao de ranking", () => {
  test("fica bloqueado em producao", () => {
    expect(page).toContain('process.env.VERCEL_ENV === "production"');
    expect(page).toContain("notFound()");
  });

  test("nao chama APIs nem executa efeitos externos", () => {
    expect(client).not.toContain("fetch(");
    expect(client).not.toContain("window.location");
    expect(client).not.toContain("localStorage");
    expect(client).not.toContain("sessionStorage");
    expect(client).toContain("Dados fictícios e ações locais");
  });
});
