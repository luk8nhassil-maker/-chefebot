// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "comanda_1" }),
  useRouter: () => ({ replace: replaceMock }),
}));

import ReceberContaSalaoPage from "./page";

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

let fechamentoBody: Record<string, unknown> | null = null;

async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = (init?.method || "GET").toUpperCase();

  if (url === "/api/salao/operacao" && method === "GET") {
    return jsonRes(200, {
      ok: true,
      comandas: [{
        id: "comanda_1",
        numero: 1,
        cliente: "TESTE SALÃO",
        conta: { status: "conta_solicitada" },
        totalAtivoCentavos: 6600,
      }],
    });
  }

  if (url === "/api/cardapio" && method === "GET") {
    return jsonRes(200, { payments: ["Pix", "Dinheiro", "Cartão"] });
  }

  if (url === "/api/salao/comandas/comanda_1/pagamento" && method === "POST") {
    fechamentoBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonRes(200, { ok: true, estado: { status: "fechada" }, deduplicado: false });
  }

  return jsonRes(404, { ok: false });
}

beforeEach(() => {
  fechamentoBody = null;
  replaceMock.mockReset();
  vi.stubGlobal("fetch", vi.fn(mockFetch));
  vi.stubGlobal("crypto", { randomUUID: () => "terminal_salao_1234567890" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Salão — receber pagamento no terminal", () => {
  it("mostra somente as formas oficiais, confirma no mesmo celular e fecha a mesa", async () => {
    const user = userEvent.setup();
    render(<ReceberContaSalaoPage />);

    expect(await screen.findByText("TESTE SALÃO")).toBeTruthy();
    expect(screen.getAllByText(/R\$\s*66,00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("radio", { name: "Pix" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Dinheiro" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Cartão" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Vale inventado" })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Cartão" }));
    await user.click(screen.getByRole("button", { name: /Receber.*66,00.*fechar mesa/i }));

    await waitFor(() => expect(screen.getByText("Pagamento confirmado")).toBeTruthy());
    expect(fechamentoBody).toMatchObject({
      requestId: "terminal_salao_1234567890",
      totalEsperadoCentavos: 6600,
      pagamento: "Cartão",
    });
  });

  it("não oferece fechamento quando a conta ainda não foi solicitada", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url === "/api/salao/operacao" && method === "GET") {
        return jsonRes(200, {
          ok: true,
          comandas: [{ id: "comanda_1", numero: 1, cliente: "TESTE SALÃO", conta: { status: "aberta" }, totalAtivoCentavos: 6600 }],
        });
      }
      if (url === "/api/cardapio" && method === "GET") return jsonRes(200, { payments: ["Cartão"] });
      return jsonRes(404, { ok: false });
    }));

    render(<ReceberContaSalaoPage />);
    expect(await screen.findByText("Peça a conta antes de receber o pagamento.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Cartão" })).toBeDisabled();
  });
});