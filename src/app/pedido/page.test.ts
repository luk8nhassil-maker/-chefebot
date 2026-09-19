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

describe("/pedido — captura de token de indicação (?ref=)", () => {
  test("captura ?ref= da URL, remove da barra de endereço e armazena em cf_ref", () => {
    expect(fonte).toContain("cf_ref");
    expect(fonte).toContain('params.get("ref")');
    expect(fonte).toContain('sessionStorage.setItem("cf_ref"');
    expect(fonte).toContain("params.delete");
    expect(fonte).toContain("window.history.replaceState");
  });

  test("ref nunca expõe telefone — apenas token opaco", () => {
    const blocoRef = fonte.slice(fonte.indexOf('params.get("ref")'), fonte.indexOf('window.history.replaceState'));
    expect(blocoRef).not.toMatch(/telefone/);
  });
});
