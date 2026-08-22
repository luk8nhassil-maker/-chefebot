import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const confirmar = fonte.slice(
  fonte.indexOf("const confirmarPixManual = async"),
  fonte.indexOf("const inputStyle:")
);

describe("/pedidos — regressão do modal de confirmação manual de Pix", () => {
  test("sucesso fecha o overlay sem depender do state assíncrono pixConfirmando", () => {
    const inicioReset = fonte.indexOf("function resetarVerificacaoPix");
    expect(inicioReset).toBeGreaterThan(-1);
    const reset = fonte.slice(inicioReset, fonte.indexOf("function fecharVerificacaoPix", inicioReset));
    expect(reset).toContain("setConfirmPixModal(null)");
    expect(reset).not.toContain("if (pixConfirmando)");

    const sucesso = confirmar.slice(confirmar.indexOf("if (r.ok)"), confirmar.indexOf("if (r.status === 409)"));
    expect(sucesso).toContain("setPixConfirmando(false)");
    expect(sucesso).toContain("resetarVerificacaoPix()");
    expect(sucesso).not.toContain("fecharVerificacaoPix()");
  });

  test("fechamento voluntário continua bloqueado enquanto a requisição está em andamento", () => {
    const inicio = fonte.indexOf("function fecharVerificacaoPix");
    const fim = fonte.indexOf("const checklistCompleto", inicio);
    const fechar = fonte.slice(inicio, fim);
    expect(fechar).toContain("if (pixConfirmando) return");
    expect(fechar).toContain("resetarVerificacaoPix()");
  });

  test("corrida 409 fecha depois do aviso sem capturar a closure travada", () => {
    const bloco409 = confirmar.slice(confirmar.indexOf("if (r.status === 409)"), confirmar.indexOf("if (r.status === 401)"));
    expect(bloco409).toContain("setPixConfirmando(false)");
    expect(bloco409).toContain("setTimeout(resetarVerificacaoPix, 1800)");
    expect(bloco409).not.toContain("setTimeout(fecharVerificacaoPix");
  });
});
