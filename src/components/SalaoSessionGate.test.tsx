// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/salao";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

import SalaoSessionGate from "./SalaoSessionGate";

beforeEach(() => {
  pathname = "/salao";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SalaoSessionGate", () => {
  it("obtém a sessão própria do Salão antes de liberar a interface", async () => {
    render(<SalaoSessionGate><div>Terminal liberado</div></SalaoSessionGate>);

    expect(screen.queryByText("Terminal liberado")).not.toBeInTheDocument();
    expect(screen.getByText("Iniciando terminal do salão…")).toBeInTheDocument();

    expect(await screen.findByText("Terminal liberado")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/salao/login", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("não interfere na própria tela de login", () => {
    pathname = "/salao/login";
    render(<SalaoSessionGate><div>Tela de login</div></SalaoSessionGate>);

    expect(screen.getByText("Tela de login")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mantém o terminal bloqueado quando a sessão não pode ser criada e permite tentar novamente", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<SalaoSessionGate><div>Terminal liberado</div></SalaoSessionGate>);

    expect(await screen.findByText("Não foi possível iniciar o terminal agora.")).toBeInTheDocument();
    expect(screen.queryByText("Terminal liberado")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByText("Terminal liberado")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
