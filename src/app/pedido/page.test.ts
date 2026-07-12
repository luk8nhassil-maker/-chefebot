import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/pedido — sempre cardápio público, mesmo com sessão admin", () => {
  test("renderiza PublicCardapio diretamente, sem checar isAdmin/auth-user", () => {
    expect(fonte).toContain("import { PublicCardapio } from \"@/app/cardapio/page\"");
    expect(fonte).toMatch(/return <PublicCardapio menu=\{menu\} \/>;/);
    expect(fonte).not.toContain("isAdmin");
    expect(fonte).not.toContain("auth-user");
  });
});
