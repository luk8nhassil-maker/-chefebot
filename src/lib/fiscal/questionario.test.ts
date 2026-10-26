import { describe, it, expect } from "vitest";
import { CAMPOS_FISCAIS, CAMPOS_FORMULARIO_FISCAL, VAZIO, validarRespostas } from "./questionario";

describe("formulário fiscal do dono e contador", () => {
  it("mostra somente os campos do emitente unico sem pedir matriz/filial ou outro endereco", () => {
    expect(CAMPOS_FORMULARIO_FISCAL).toContain("cnpj");
    expect(CAMPOS_FORMULARIO_FISCAL).toContain("inscricaoEstadual");
    expect(CAMPOS_FORMULARIO_FISCAL).toContain("uf");
    expect(CAMPOS_FORMULARIO_FISCAL).not.toContain("tipoEstabelecimento");
    expect(CAMPOS_FORMULARIO_FISCAL).not.toContain("vendaOutroEndereco");
    expect(CAMPOS_FISCAIS).toContain("tipoEstabelecimento");
    expect(CAMPOS_FISCAIS).toContain("vendaOutroEndereco");
  });
  it("preserva dados de formularios antigos sem ativar a emissao", () => {
    const antigo = validarRespostas({ tipoEstabelecimento: "matriz", vendaOutroEndereco: "sim" });
    expect(antigo.tipoEstabelecimento).toBe("matriz");
    expect(antigo.vendaOutroEndereco).toBe("sim");
    expect(antigo).not.toHaveProperty("podeEmitir");
  });
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

  it("aceita MEI, ME, EPP e demais portes sem inferir imposto ou permissão fiscal", () => {
    for (const porteEmpresa of ["mei", "me", "epp", "demais", "nao_informado", ""]) {
      const resposta = validarRespostas({ porteEmpresa, cnpj:"00.000.000/E08G-12" });
      expect(resposta.porteEmpresa).toBe(porteEmpresa);
      expect(resposta.regimeTributario).toBe("");
      expect(resposta.cnpj).toBe("00000000E08G12");
      expect(resposta).not.toHaveProperty("podeEmitir");
      expect(resposta).not.toHaveProperty("empresaId");
    }
  });
  it("aceita regimes SIMEI, Simples, Presumido, Real e outros sem deduzir o porte", () => {
    for (const regimeTributario of ["", "nao_informado", "simei", "simples_nacional", "lucro_presumido", "lucro_real", "outro"]) {
      const resposta = validarRespostas({ regimeTributario });
      expect(resposta.regimeTributario).toBe(regimeTributario);
      expect(resposta.porteEmpresa).toBe("");
    }
  });
  it("guarda matriz/filial e endereço da venda separadamente sem aprovar vínculo fiscal", () => {
    const resposta = validarRespostas({
      porteEmpresa:"demais", tipoEstabelecimento:"matriz", vendaOutroEndereco:"sim",
      cnaePrincipal:"5611-2/01",
    });
    expect(resposta.tipoEstabelecimento).toBe("matriz");
    expect(resposta.vendaOutroEndereco).toBe("sim");
    expect(resposta.cnaePrincipal).toBe("5611201");
    expect(resposta).not.toHaveProperty("vinculoAprovado");
  });
  it("recusa classificações e CNAE inválidos informados em qualquer porte", () => {
    for (const entrada of [
      { porteEmpresa:"gigante" }, { tipoEstabelecimento:"depósito" },
      { vendaOutroEndereco:"talvez" }, { cnaePrincipal:"123" },
      { cnaePrincipal:"ABC1234" },
    ]) expect(() => validarRespostas(entrada)).toThrow();
  });
  it("preserva cadastros legados sem os campos novos", () => {
    const r = validarRespostas({ cnpj:"11.222.333/0001-81", regimeTributario:"simples_nacional" });
    expect(r.porteEmpresa).toBe("");
    expect(r.tipoEstabelecimento).toBe("");
    expect(r.vendaOutroEndereco).toBe("");
    expect(r.cnaePrincipal).toBe("");
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
    expect(() => validarRespostas({ regimeTributario:"invalido" })).toThrow();
    expect(() => validarRespostas({ codigoIBGE:"abc" })).toThrow();
    expect(() => validarRespostas({ inscricaoEstadual:"foo" })).toThrow();
    expect(() => validarRespostas({ observacoes:"x".repeat(999) })).toThrow();
  });
});
