import { describe, expect, test } from "vitest";
import { envioControladoLiberadoNestaVersao } from "./pesquisaPreferenciaRelease";

describe("envioControladoLiberadoNestaVersao", () => {
  test("permanece fechado nesta versão", () => {
    expect(envioControladoLiberadoNestaVersao()).toBe(false);
  });
});
