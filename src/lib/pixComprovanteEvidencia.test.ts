import { describe, expect, test } from "vitest";

import {
  chaveDedupIdentificadorComprovantePix,
  extrairIdentificadorComprovantePix,
  normalizarE2EIdPix,
} from "./pixComprovanteEvidencia";

describe("E2E/codigo de autenticacao do comprovante Pix", () => {
  test("extrai E2E em formato comum", () => {
    const texto = "E2E ID Pix: E1234567890ABCDEF1234567890ABCD";

    expect(extrairIdentificadorComprovantePix(texto)).toEqual({
      e2eId: "E1234567890ABCDEF1234567890ABCD",
    });
  });

  test("extrai E2E com espacos e hifens", () => {
    const texto = "E2E: E 12345-67890 abcde-f12345 67890-abcd";

    expect(extrairIdentificadorComprovantePix(texto)).toEqual({
      e2eId: "E1234567890ABCDEF1234567890ABCD",
    });
  });

  test("extrai codigo de autenticacao quando nao houver E2E", () => {
    const texto = "Codigo de autenticacao: ab12-cd34-ef56";

    expect(extrairIdentificadorComprovantePix(texto)).toEqual({
      codigoAutenticacao: "AB12CD34EF56",
    });
  });

  test("normaliza letras maiusculas e minusculas", () => {
    expect(normalizarE2EIdPix("e1234567890abcdef1234567890abcd")).toBe("E1234567890ABCDEF1234567890ABCD");
  });

  test("nao extrai valor curto ou invalido", () => {
    expect(extrairIdentificadorComprovantePix("E2E: E12345")).toEqual({});
    expect(extrairIdentificadorComprovantePix("Autenticacao: ABC123")).toEqual({});
  });

  test("texto sem identificador retorna vazio", () => {
    expect(extrairIdentificadorComprovantePix("Comprovante Pix aprovado no valor de R$ 50,00")).toEqual({});
  });

  test("dois textos com o mesmo E2E em formatos diferentes geram a mesma chave", () => {
    const um = extrairIdentificadorComprovantePix("E2E: E1234567890ABCDEF1234567890ABCD");
    const dois = extrairIdentificadorComprovantePix("E2E ID: e 12345-67890 abcde-f12345 67890-abcd");

    expect(chaveDedupIdentificadorComprovantePix(um)).toBe(chaveDedupIdentificadorComprovantePix(dois));
  });

  test("E2E diferente gera chave diferente", () => {
    const um = { e2eId: "E1234567890ABCDEF1234567890ABCD" };
    const dois = { e2eId: "E1234567890ABCDEF1234567890ABCE" };

    expect(chaveDedupIdentificadorComprovantePix(um)).not.toBe(chaveDedupIdentificadorComprovantePix(dois));
  });
});
