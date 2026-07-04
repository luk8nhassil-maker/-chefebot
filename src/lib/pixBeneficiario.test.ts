import { describe, expect, test } from "vitest";

import {
  avaliarBeneficiarioPix,
  chavesPixEquivalentes,
  normalizarChavePixParaComparacao,
} from "./pixBeneficiario";

const CHAVE_TELEFONE = "99974000691";

describe("normalizarChavePixParaComparacao", () => {
  test("telefone com mascara vira digitos", () => {
    expect(normalizarChavePixParaComparacao("(99) 97400-0691")).toEqual({ tipo: "digitos", valor: "99974000691" });
  });

  test("telefone com +55 perde o codigo do pais", () => {
    expect(normalizarChavePixParaComparacao("+55 99 97400-0691")).toEqual({ tipo: "digitos", valor: "99974000691" });
  });

  test("email normaliza para minusculas", () => {
    expect(normalizarChavePixParaComparacao("PIZZA@Chefe.COM")).toEqual({ tipo: "email", valor: "pizza@chefe.com" });
  });

  test("chave aleatoria normaliza hifens e caixa", () => {
    expect(normalizarChavePixParaComparacao("123E4567-E89B-12D3-A456-426614174000")).toEqual({
      tipo: "aleatoria",
      valor: "123e4567e89b12d3a456426614174000",
    });
  });

  test("campo mascarado pelo banco e inconclusivo", () => {
    expect(normalizarChavePixParaComparacao("***.974.000-**")).toBeUndefined();
  });

  test("numero curto nao e chave", () => {
    expect(normalizarChavePixParaComparacao("0691")).toBeUndefined();
  });

  test("nome de pessoa nao e chave", () => {
    expect(normalizarChavePixParaComparacao("Kellyne F dos Santos")).toBeUndefined();
  });
});

describe("chavesPixEquivalentes — telefone brasileiro", () => {
  test.each([
    "99974000691",
    "(99) 97400-0691",
    "99 97400-0691",
    "+55 99 97400-0691",
    "55 99 97400-0691",
    "+55 (99) 97400-0691",
  ])("chave esperada 99974000691 bate com %s", (lida) => {
    expect(chavesPixEquivalentes(CHAVE_TELEFONE, lida)).toBe(true);
  });

  test("tolera nono digito ausente somente com mesmo DDD e mesmo final", () => {
    expect(chavesPixEquivalentes(CHAVE_TELEFONE, "99 7400-0691")).toBe(true);
  });

  test.each([
    ["telefone de outro DDD", "(11) 97400-0691"],
    ["telefone com final diferente", "(99) 97400-0692"],
    ["numero curto", "0691"],
    ["so ultimos 4 digitos", "final 0691"],
    ["texto generico sem chave", "pagamento pix realizado com sucesso"],
  ])("nao bate com %s", (_nome, lida) => {
    expect(chavesPixEquivalentes(CHAVE_TELEFONE, lida)).toBe(false);
  });

  test("nono digito ausente com DDD diferente nao bate", () => {
    expect(chavesPixEquivalentes(CHAVE_TELEFONE, "11 7400-0691")).toBe(false);
  });
});

describe("chavesPixEquivalentes — CPF/CNPJ e email", () => {
  test("CPF com mascara bate com so numeros", () => {
    expect(chavesPixEquivalentes("529.982.247-25", "52998224725")).toBe(true);
  });

  test("CNPJ com mascara bate com so numeros", () => {
    expect(chavesPixEquivalentes("12.345.678/0001-95", "12345678000195")).toBe(true);
  });

  test("documento diferente nao bate", () => {
    expect(chavesPixEquivalentes("529.982.247-25", "52998224726")).toBe(false);
  });

  test("email bate ignorando caixa", () => {
    expect(chavesPixEquivalentes("Pizza@Chefe.com", "pizza@chefe.com")).toBe(true);
  });

  test("email diferente nao bate", () => {
    expect(chavesPixEquivalentes("pizza@chefe.com", "outro@chefe.com")).toBe(false);
  });
});

describe("avaliarBeneficiarioPix", () => {
  test("chave lida em formato diferente da esperada e ok (caso real do falso negativo)", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        beneficiarioEsperado: "Kellyne F dos Santos",
        chaveLida: "+55 99 97400-0691",
      })
    ).toBe("ok");
  });

  test("chave esperada embutida em campo com nome e instituicao e ok", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        chaveLida: "Kellyne F dos Santos - Banco Inter - (99) 97400-0691",
      })
    ).toBe("ok");
  });

  test("nome do recebedor compativel e ok mesmo sem chave lida", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        beneficiarioEsperado: "Kellyne F dos Santos",
        beneficiarioLido: "KELLYNE FERREIRA DOS SANTOS",
      })
    ).toBe("ok");
  });

  test("nome com acento e caixa diferente e ok", () => {
    expect(
      avaliarBeneficiarioPix({
        beneficiarioEsperado: "José da Pizzaria",
        beneficiarioLido: "JOSE DA PIZZARIA LTDA",
      })
    ).toBe("ok");
  });

  test("sem chave nem beneficiario legiveis e ausente", () => {
    expect(avaliarBeneficiarioPix({ chaveEsperada: CHAVE_TELEFONE, beneficiarioEsperado: "Kellyne" })).toBe("ausente");
  });

  test("chave mascarada pelo banco e ausente, nao divergente", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        beneficiarioEsperado: "Kellyne F dos Santos",
        chaveLida: "(**) *****-0691",
      })
    ).toBe("ausente");
  });

  test("documento parcial mascarado e ausente, nao ok", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: "52998224725",
        chaveLida: "***.982.247-**",
      })
    ).toBe("ausente");
  });

  test("nome no comprovante sem nome esperado configurado e ausente, nao divergente", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        beneficiarioLido: "Fulano de Tal",
      })
    ).toBe("ausente");
  });

  test("chave completa claramente diferente e divergente", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        beneficiarioEsperado: "Kellyne F dos Santos",
        chaveLida: "(11) 98888-7777",
      })
    ).toBe("divergente");
  });

  test("nome claramente diferente do esperado e divergente", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        beneficiarioEsperado: "Kellyne F dos Santos",
        beneficiarioLido: "Empresa Desconhecida Ltda",
      })
    ).toBe("divergente");
  });

  test("chave divergente mas nome compativel e ok (nome prevalece como prova positiva)", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        beneficiarioEsperado: "Kellyne F dos Santos",
        chaveLida: "(11) 98888-7777",
        beneficiarioLido: "Kellyne F dos Santos",
      })
    ).toBe("ok");
  });

  test("so ultimos 4 digitos nunca e prova de correspondencia", () => {
    expect(
      avaliarBeneficiarioPix({
        chaveEsperada: CHAVE_TELEFONE,
        chaveLida: "final 0691",
      })
    ).toBe("ausente");
  });
});
