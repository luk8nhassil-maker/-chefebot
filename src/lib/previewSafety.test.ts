import { afterEach, describe, expect, test, vi } from "vitest";
import {
  bloquearClienteRealEmPreview,
  bloquearOperacaoRealEmPreview,
  MOTIVO_PREVIEW_OPERACAO_REAL_BLOQUEADA,
} from "./previewSafety";

afterEach(() => vi.unstubAllEnvs());

describe("proteções de Preview", () => {
  test("não executa comandos de cliente real mesmo quando uma credencial é espelhada", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const comando = vi.fn();
    const cliente = bloquearClienteRealEmPreview({ comando }, "Redis");

    expect(() => cliente.comando()).toThrow(`${MOTIVO_PREVIEW_OPERACAO_REAL_BLOQUEADA}:Redis`);
    expect(comando).not.toHaveBeenCalled();
  });

  test("mantém o cliente utilizável fora do Preview", () => {
    const comando = vi.fn(() => "ok");
    const cliente = bloquearClienteRealEmPreview({ comando }, "Redis");

    expect(cliente.comando()).toBe("ok");
    expect(comando).toHaveBeenCalledTimes(1);
  });

  test("bloqueia chamadas externas diretas", () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    expect(() => bloquearOperacaoRealEmPreview("MercadoPago")).toThrow(
      `${MOTIVO_PREVIEW_OPERACAO_REAL_BLOQUEADA}:MercadoPago`,
    );
  });
});
