import { afterEach, describe, expect, test, vi } from "vitest";
import { criarFetchComReloadPixManual } from "./PixManualReloadGuard";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("/pedidos — regressão da lista após confirmação manual de Pix", () => {
  test("recarrega o painel depois que a confirmação manual bem-sucedida termina de ler a resposta", async () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    const originalFetch = vi.fn(async () => new Response(
      JSON.stringify({ confirmadoPor: "manual" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof window.fetch;

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
    const originalFetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "Senha incorreta" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof window.fetch;

    const wrappedFetch = criarFetchComReloadPixManual(originalFetch, recarregar);
    const response = await wrappedFetch("/api/orders/confirmar-pix-manual", { method: "POST" });
    await response.json();
    await vi.runAllTimersAsync();

    expect(recarregar).not.toHaveBeenCalled();
  });

  test("nenhuma outra chamada do painel é alterada", async () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    const originalFetch = vi.fn(async () => new Response(
      JSON.stringify([{ id: "pedido-1" }]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof window.fetch;

    const wrappedFetch = criarFetchComReloadPixManual(originalFetch, recarregar);
    const response = await wrappedFetch("/api/orders", { method: "GET" });
    await response.json();
    await vi.runAllTimersAsync();

    expect(recarregar).not.toHaveBeenCalled();
  });
});
