"use client";

import { useEffect } from "react";

const PIX_MANUAL_PATH = "/api/orders/confirmar-pix-manual";

function pathnameDaEntrada(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  try {
    return new URL(raw, "https://chefebot.local").pathname;
  } catch {
    return "";
  }
}

function metodoDaEntrada(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && input !== null && "method" in input) {
    return String(input.method || "GET").toUpperCase();
  }
  return "GET";
}

export function criarFetchComReloadPixManual(
  originalFetch: typeof window.fetch,
  recarregar: () => void,
): typeof window.fetch {
  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);

    const deveRecarregar =
      response.ok &&
      metodoDaEntrada(input, init) === "POST" &&
      pathnameDaEntrada(input) === PIX_MANUAL_PATH;

    if (!deveRecarregar) return response;

    // O handler de /pedidos ainda precisa ler o JSON, fechar o modal e concluir
    // o fluxo normal. Por isso o reload é agendado somente DEPOIS que essa
    // leitura termina, reproduzindo o F5 que restaura a lista sem interromper
    // a confirmação financeira já concluída no servidor.
    const jsonOriginal = response.json.bind(response);
    let reloadAgendado = false;
    Object.defineProperty(response, "json", {
      configurable: true,
      value: async () => {
        try {
          return await jsonOriginal();
        } finally {
          if (!reloadAgendado) {
            reloadAgendado = true;
            setTimeout(recarregar, 0);
          }
        }
      },
    });

    return response;
  };

  return wrappedFetch as typeof window.fetch;
}

export default function PixManualReloadGuard() {
  useEffect(() => {
    const originalFetch = window.fetch;
    const wrappedFetch = criarFetchComReloadPixManual(originalFetch, () => window.location.reload());

    window.fetch = wrappedFetch;
    return () => {
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
