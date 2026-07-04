import { describe, expect, test } from "vitest";

import {
  chaveDedupComprovantePix,
  gerarHashComprovantePixMidia,
  gerarHashComprovantePixTexto,
  normalizarTextoComprovantePix,
} from "./pixComprovanteHash";

describe("hash SHA-256 de comprovante Pix", () => {
  test("mesmo base64 gera o mesmo SHA-256", () => {
    const base64 = Buffer.from("comprovante-pix-123").toString("base64");

    expect(gerarHashComprovantePixMidia(base64)).toBe(gerarHashComprovantePixMidia(base64));
  });

  test("base64 diferente gera SHA-256 diferente", () => {
    const primeiro = Buffer.from("comprovante-pix-123").toString("base64");
    const segundo = Buffer.from("comprovante-pix-456").toString("base64");

    expect(gerarHashComprovantePixMidia(primeiro)).not.toBe(gerarHashComprovantePixMidia(segundo));
  });

  test("hash de midia nao usa mais slice(0, 64)", () => {
    const conteudo = "a".repeat(96);
    const base64 = Buffer.from(conteudo).toString("base64");
    const hash = gerarHashComprovantePixMidia(base64);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(base64.slice(0, 64));
  });

  test("texto igual com maiusculas, quebras e espacos gera o mesmo hash normalizado", () => {
    const um = "COMPROVANTE PIX\n\nValor: R$ 50,00\nNome: Chefe da Pizza";
    const dois = " comprovante pix valor: r$ 50,00   nome: chefe da pizza ";

    expect(normalizarTextoComprovantePix(um)).toBe(normalizarTextoComprovantePix(dois));
    expect(gerarHashComprovantePixTexto(um)).toBe(gerarHashComprovantePixTexto(dois));
  });

  test("textos realmente diferentes geram hashes diferentes", () => {
    const primeiro = "comprovante pix valor r$ 50,00 nome chefe da pizza";
    const segundo = "comprovante pix valor r$ 51,00 nome chefe da pizza";

    expect(gerarHashComprovantePixTexto(primeiro)).not.toBe(gerarHashComprovantePixTexto(segundo));
  });

  test("comprovante texto reaproveitado usa a mesma chave de dedup", () => {
    const original = "Comprovante Pix\nValor: R$ 50,00\nNome: Chefe da Pizza";
    const reenviado = "comprovante pix valor: r$ 50,00 nome: chefe da pizza";
    const hashOriginal = gerarHashComprovantePixTexto(original);
    const hashReenviado = gerarHashComprovantePixTexto(reenviado);

    expect(chaveDedupComprovantePix(hashOriginal)).toBe(chaveDedupComprovantePix(hashReenviado));
    expect(chaveDedupComprovantePix(hashOriginal)).toBe(`pix_comprovante_hash:${hashOriginal}`);
  });
});
