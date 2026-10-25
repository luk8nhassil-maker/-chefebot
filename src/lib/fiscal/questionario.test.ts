import { describe, it, expect } from "vitest";
import { CAMPOS_FISCAIS, VAZIO, validarRespostas } from "./questionario";

describe("formulário fiscal do dono e contador", () => {
  it("permite salvar campos vazios sem inventar dados", () => {
    const r = validarRespostas({});
    expect(r).toEqual(VAZIO);
    expect(CAMPOS_FISCAIS).toContain("orientacoesProdutos");
  });
  it("aceita campo isolado e CNPJ alfanumérico correto", () => {
    expect(validarRespostas({ razaoSocial:"Pizzaria Teste" }).razaoSocial).toBe("Pizzaria Teste");
    expect(validarRespostas({ cnpj:"00.000.000/E08G-12" }).cnpj).toBe("00000000E08G12");
  });
  it("recusa CNPJ inválido mesmo sendo opcional", () => {
    expect(() => validarRespostas({ cnpj:"00000000000000" })).toThrow();
  });
  it("nunca aceita clientSecret, senha, status de emissão ou outros campos", () => {
    for (const campo of ["clientSecret", "certificadoDigital", "empresaId", "situacao", "podeEmitir", "senha"]) {
      expect(() => validarRespostas({ [campo]: "test" })).toThrow();
    }
    expect(() => validarRespostas({ observacoes:"clientSecret=abc" })).toThrow();
    expect(() => validarRespostas({ orientacoesProdutos:"-----BEGIN PRIVATE KEY-----" })).toThrow();
  });
  it("bloqueia dados fiscais inválidos e respostas gigantes", () => {
    expect(() => validarRespostas({ uf:"XX" })).toThrow();
    expect(() => validarRespostas({ regimeTributario:"outro" })).toThrow();
    expect(() => validarRespostas({ codigoIBGE:"abc" })).toThrow();
    expect(() => validarRespostas({ inscricaoEstadual:"foo" })).toThrow();
    expect(() => validarRespostas({ observacoes:"x".repeat(999) })).toThrow();
  });
});
