import { afterEach, describe, expect, test, vi } from "vitest";
import { criarFetchComReloadPixManual } from "./PixManualReloadGuard";

function resposta(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("/pedidos — regressão da lista após confirmação manual de Pix", () => {
  test("recarrega o painel depois que a confirmação manual bem-sucedida termina de ler a resposta", async () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    const originalFetch = vi.fn(async () => resposta(200, { confirmadoPor: "manual" })) as unknown as typeof window.fetch;

    const wrappedFetch = criarFetchComReloadPixManual(originalFetch, recarregar);
    const response = await wrappedFetch("/api/orders/confirmar-pix-manual", { method: "POST" });

    expect(recarregar).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ confirmadoPor: "manual" });
    expect(recarregar).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  test("erro de senha ou falha financeira não recarregam a página", async () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    const originalFetch = vi.fn(async () => resposta(401, { error: "Senha incorreta" })) as unknown as typeof window.fetch;

    const wrappedFetch = criarFetchComReloadPixManual(originalFetch, recarregar);
    const response = await wrappedFetch("/api/orders/confirmar-pix-manual", { method: "POST" });
    await response.json();
    await vi.runAllTimersAsync();

    expect(recarregar).not.toHaveBeenCalled();
  });

  test("nenhuma outra chamada do painel é alterada", async () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    const originalFetch = vi.fn(async () => resposta(200, [{ id: "pedido-1" }])) as unknown as typeof window.fetch;

    const wrappedFetch = criarFetchComReloadPixManual(originalFetch, recarregar);
    const response = await wrappedFetch("/api/orders", { method: "GET" });
    await response.json();
    await vi.runAllTimersAsync();

    expect(recarregar).not.toHaveBeenCalled();
  });
});
