import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const confirmar = fonte.slice(
  fonte.indexOf("const confirmarPixManual = async"),
  fonte.indexOf("const inputStyle:")
);

describe("/pedidos — regressão da lista após confirmação manual de Pix", () => {
  test("confirmação manual bem-sucedida recarrega o painel como um F5", () => {
    const sucesso = confirmar.slice(
      confirmar.indexOf("if (r.ok)"),
      confirmar.indexOf("if (r.status === 409)")
    );

    expect(sucesso).toContain("resetarVerificacaoPix()");
    expect(sucesso).toContain("window.location.reload()");
    expect(sucesso.indexOf("window.location.reload()"))
      .toBeGreaterThan(sucesso.indexOf("resetarVerificacaoPix()"));
  });

  test("senha incorreta ou erro não recarregam a página", () => {
    const falhas = confirmar.slice(confirmar.indexOf("if (r.status === 401)"));
    expect(falhas).not.toContain("window.location.reload()");
  });
});
