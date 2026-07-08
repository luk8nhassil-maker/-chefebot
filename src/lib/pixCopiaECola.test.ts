import { describe, expect, test } from "vitest";

import { gerarPixCopiaEColaEstatico, validarCrcPixPayload } from "./pixCopiaECola";

describe("Pix copia e cola estatico", () => {
  test("gera payload EMV com chave, valor, txid e CRC valido", () => {
    const payload = gerarPixCopiaEColaEstatico({
      chavePix: "99974000691",
      valor: 42.5,
      nomeRecebedor: "Kellyne Pizzaria",
      cidade: "Alto Alegre",
      txid: "chefebot_123",
    });

    expect(payload).toContain("br.gov.bcb.pix");
    expect(payload).toContain("99974000691");
    expect(payload).toContain("540542.50");
    expect(payload).toContain("KELLYNE PIZZARIA");
    expect(payload).toContain("CHEFEBOT123");
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
    expect(validarCrcPixPayload(payload!)).toBe(true);
  });

  test("nao gera copia e cola sem beneficiario completo", () => {
    expect(gerarPixCopiaEColaEstatico({
      chavePix: "99974000691",
      valor: 42.5,
      nomeRecebedor: "",
    })).toBeUndefined();
  });
});
