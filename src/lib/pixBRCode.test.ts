import { describe, expect, test } from "vitest";

import { crc16CcittFalse, gerarPixCopiaEColaEstatico } from "./pixBRCode";

describe("crc16CcittFalse", () => {
  test("vetor de verificacao padrao do CRC16/CCITT-FALSE", () => {
    // Check value canonico do algoritmo: CRC("123456789") = 0x29B1
    expect(crc16CcittFalse("123456789")).toBe("29B1");
  });

  test("payload vazio retorna FFFF (init do algoritmo)", () => {
    expect(crc16CcittFalse("")).toBe("FFFF");
  });
});

describe("gerarPixCopiaEColaEstatico", () => {
  const base = { chave: "99974000691", valor: 52.5, nome: "Chefe da Pizza", cidade: "Alto Alegre", txid: "CHEFE123" };

  test("gera payload EMV com os campos obrigatorios", () => {
    const payload = gerarPixCopiaEColaEstatico(base);

    expect(payload).toBeDefined();
    expect(payload!.startsWith("000201")).toBe(true); // payload format indicator
    expect(payload).toContain("br.gov.bcb.pix");
    expect(payload).toContain("99974000691");
    expect(payload).toContain("5303986"); // moeda BRL
    expect(payload).toContain("540552.50"); // valor com 2 casas
    expect(payload).toContain("5802BR");
    expect(payload).toContain("CHEFE DA PIZZA"); // nome sem acento, maiusculas
    expect(payload).toContain("ALTO ALEGRE");
    expect(payload).toContain("CHEFE123");
  });

  test("CRC final e consistente: recalcular sobre o corpo reproduz os 4 digitos finais", () => {
    const payload = gerarPixCopiaEColaEstatico(base)!;
    const corpo = payload.slice(0, -4);
    const crc = payload.slice(-4);

    expect(corpo.endsWith("6304")).toBe(true);
    expect(crc16CcittFalse(corpo)).toBe(crc);
    expect(crc).toMatch(/^[0-9A-F]{4}$/);
  });

  test("nome com acento e sanitizado e truncado em 25 chars", () => {
    const payload = gerarPixCopiaEColaEstatico({ ...base, nome: "José Açaí & Pizzaria do Chefão Ltda" })!;
    const nomeCampo = payload.match(/59(\d{2})([A-Z0-9 ]+)60/);

    expect(nomeCampo).toBeTruthy();
    expect(Number(nomeCampo![1])).toBeLessThanOrEqual(25);
    expect(nomeCampo![2]).not.toMatch(/[ÁÃÇÉ&]/i);
  });

  test("sem nome/cidade usa fallbacks validos", () => {
    const payload = gerarPixCopiaEColaEstatico({ chave: "99974000691", valor: 1 })!;

    expect(payload).toContain("RECEBEDOR PIX");
    expect(payload).toContain("BRASIL");
  });

  test("txid invalido vira *** e caracteres especiais sao removidos", () => {
    const comTxidVazio = gerarPixCopiaEColaEstatico({ ...base, txid: undefined })!;
    expect(comTxidVazio).toContain("6207050324***".slice(-8)); // campo 62 com 05 03 ***

    const comTxidSujo = gerarPixCopiaEColaEstatico({ ...base, txid: "CH-EFE 12.3" })!;
    expect(comTxidSujo).toContain("CHEFE123");
  });

  test("valor invalido ou chave vazia retornam undefined", () => {
    expect(gerarPixCopiaEColaEstatico({ chave: "", valor: 10 })).toBeUndefined();
    expect(gerarPixCopiaEColaEstatico({ chave: "99974000691", valor: 0 })).toBeUndefined();
    expect(gerarPixCopiaEColaEstatico({ chave: "99974000691", valor: NaN })).toBeUndefined();
    expect(gerarPixCopiaEColaEstatico({ chave: "99974000691", valor: -5 })).toBeUndefined();
  });

  test("chave email e chave aleatoria passam sem alteracao no campo 26", () => {
    const email = gerarPixCopiaEColaEstatico({ chave: "pizza@chefe.com", valor: 10 })!;
    expect(email).toContain("pizza@chefe.com");

    const evp = gerarPixCopiaEColaEstatico({ chave: "123e4567-e89b-12d3-a456-426614174000", valor: 10 })!;
    expect(evp).toContain("123e4567-e89b-12d3-a456-426614174000");
  });
});
