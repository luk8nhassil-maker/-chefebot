// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AtualizarAcessoPage from "./page";

describe("AtualizarAcessoPage", () => {
  it("orienta a troca do endereço antigo e leva para /pedidos no mesmo host", () => {
    render(<AtualizarAcessoPage />);

    expect(screen.getByRole("heading", { name: "O endereço do ChefeBot mudou" })).toBeInTheDocument();
    expect(screen.getByText("chefedapizza.com.br/pedidos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir painel oficial" })).toHaveAttribute("href", "/pedidos");
  });
});
