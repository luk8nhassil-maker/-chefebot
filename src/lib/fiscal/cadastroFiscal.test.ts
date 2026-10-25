import { describe, expect, it } from "vitest";
import {
  CadastroFiscalInvalido, criarRascunhoFiscal, validarCadastroFiscal,
} from "./cadastroFiscal";

const entrada = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "Pizzaria Fictícia LTDA",
  nomeFantasia: "Pizza de Teste",
  inscricaoEstadual: "",
  municipio: "Cidade Sintética",
  uf: "MA",
  regimeTributario: "nao_informado",
  declaracaoResponsavel: true,
};

describe("cadastro fiscal declaratório — estritamente seguro", () => {
  it("normaliza CNPJ, UF e regime não informado sem inferir tributação", () => {
    expect(validarCadastroFiscal({ ...entrada, uf: "ma" })).toEqual({
      ...entrada, cnpj: "11222333000181", uf: "MA",
    });
  });
  it("aceita CNPJ alfanumérico oficial sem eliminar letras e ainda valida os dígitos", () => {
    const novo = validarCadastroFiscal({ ...entrada, cnpj: "00.000.000/E08G-12" });
    expect(novo.cnpj).toBe("00000000E08G12");
    expect(() => validarCadastroFiscal({ ...entrada, cnpj: "00.000.000/E08G-13" })).toThrow();
    expect(() => validarCadastroFiscal({ ...entrada, cnpj: "00.000.000/E08G-1X" })).toThrow();
  });
  it("rejeita CNPJ inválido, repetido e com dígito trocado", () => {
    for (const cnpj of ["00000000000000", "11222333000182", "123"]) {
      expect(() => validarCadastroFiscal({ ...entrada, cnpj })).toThrow(CadastroFiscalInvalido);
    }
  });
  it("rejeita opção de imposto arbitrária e flag de emissão", () => {
    expect(() => validarCadastroFiscal({ ...entrada, regimeTributario: "automatico" })).toThrow();
    expect(() => validarCadastroFiscal({ ...entrada, podeEmitir: true })).toThrow();
    expect(() => validarCadastroFiscal({ ...entrada, certificado: "pfx-base64" })).toThrow();
  });
  it("não permite pular declaração do responsável", () => {
    expect(() => validarCadastroFiscal({ ...entrada, declaracaoResponsavel: false })).toThrow();
  });
  it("não aceita nome gigantesco ou UF falsa", () => {
    expect(() => validarCadastroFiscal({ ...entrada, razaoSocial: "a".repeat(200) })).toThrow();
    expect(() => validarCadastroFiscal({ ...entrada, uf: "ZZ" })).toThrow();
  });
  it("o registro é sempre rascunho, mesmo após salvar", () => {
    const registro = criarRascunhoFiscal(
      "proprietario01", validarCadastroFiscal(entrada), "2026-10-24T23:00:00Z",
    );
    expect(registro.situacao).toBe("rascunho_pendente_vinculo");
    expect(registro.schemaVersion).toBe(1);
    expect(registro.titularConta).toBe("proprietario01");
    expect("empresaId" in registro).toBe(false);
    expect("clientSecret" in registro).toBe(false);
  });
  it("não confia na identidade do navegador nem em datas inválidas", () => {
    expect(() => criarRascunhoFiscal("a/b", validarCadastroFiscal(entrada), "2026-10-24T23:00:00Z")).toThrow();
    expect(() => criarRascunhoFiscal("dono", validarCadastroFiscal(entrada), "hoje")).toThrow();
  });
});
