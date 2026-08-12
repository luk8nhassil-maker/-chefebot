// @vitest-environment jsdom
//
// Testes de INTERAÇÃO do diálogo de confirmação — o que o usuário faz de
// verdade (ESC, Tab, clique fora, confirmar/cancelar), não leitura de
// código-fonte. Substituiu cinco bottom sheets feitos à mão que não tinham
// nenhum desses comportamentos.
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDialog from "./ConfirmDialog";

afterEach(cleanup);

function montar(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirmar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <ConfirmDialog
      aberto
      titulo="Arquivar todos os pedidos entregues?"
      descricao="Pedidos em aberto não são afetados."
      confirmarLabel="Sim, arquivar"
      tom="perigo"
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
      {...props}
    />
  );
  return { onConfirmar, onCancelar };
}

describe("ConfirmDialog — a decisão em si", () => {
  test("fechado não renderiza nada", () => {
    const onConfirmar = vi.fn();
    const onCancelar = vi.fn();
    const { container } = render(
      <ConfirmDialog aberto={false} titulo="X" confirmarLabel="Ok" onConfirmar={onConfirmar} onCancelar={onCancelar} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("mostra pergunta e consequência, e cada botão dispara só a sua ação", async () => {
    const user = userEvent.setup();
    const { onConfirmar, onCancelar } = montar();
    expect(screen.getByText("Arquivar todos os pedidos entregues?")).toBeInTheDocument();
    expect(screen.getByText("Pedidos em aberto não são afetados.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sim, arquivar" }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onCancelar).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  test("ocupado desabilita as duas ações e troca o rótulo (sem duplo disparo)", async () => {
    const user = userEvent.setup();
    const { onConfirmar, onCancelar } = montar({ ocupado: true, ocupadoLabel: "Arquivando..." });
    const confirmar = screen.getByRole("button", { name: "Arquivando..." });
    expect(confirmar).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await user.click(confirmar);
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(onCancelar).not.toHaveBeenCalled();
  });

  test("aviso extra (ex.: Pix pendente) aparece sem esconder a decisão", () => {
    montar({ aviso: <span>Pix pendente</span> });
    expect(screen.getByText("Pix pendente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sim, arquivar" })).toBeInTheDocument();
  });
});

describe("ConfirmDialog — acessibilidade que os overlays da mão não tinham", () => {
  test("é um dialog modal rotulado pela própria pergunta", () => {
    montar();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Arquivar todos os pedidos entregues?");
  });

  test("ESC cancela", async () => {
    const user = userEvent.setup();
    const { onCancelar, onConfirmar } = montar();
    await user.keyboard("{Escape}");
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  test("ESC não cancela enquanto a ação está em andamento", async () => {
    const user = userEvent.setup();
    const { onCancelar } = montar({ ocupado: true });
    await user.keyboard("{Escape}");
    expect(onCancelar).not.toHaveBeenCalled();
  });

  test("clique no fundo cancela; clique dentro do diálogo não", async () => {
    const user = userEvent.setup();
    const { onCancelar } = montar();
    await user.click(screen.getByText("Arquivar todos os pedidos entregues?"));
    expect(onCancelar).not.toHaveBeenCalled();
    await user.click(document.querySelector(".cd-backdrop") as HTMLElement);
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  test("o foco começa na ação principal — Enter resolve sem tocar na tela", async () => {
    const user = userEvent.setup();
    const { onConfirmar } = montar();
    expect(screen.getByRole("button", { name: "Sim, arquivar" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  test("Tab circula dentro do diálogo, nunca escapa para a página atrás", async () => {
    const user = userEvent.setup();
    montar();
    const confirmar = screen.getByRole("button", { name: "Sim, arquivar" });
    const cancelar = screen.getByRole("button", { name: "Cancelar" });
    expect(confirmar).toHaveFocus();
    await user.tab();
    expect(cancelar).toHaveFocus();
    await user.tab();
    expect(confirmar).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancelar).toHaveFocus();
  });

  test("ao fechar, o foco volta para quem abriu o diálogo", async () => {
    const abridor = document.createElement("button");
    abridor.textContent = "Arquivar";
    document.body.appendChild(abridor);
    abridor.focus();
    expect(abridor).toHaveFocus();

    const { unmount } = render(
      <ConfirmDialog aberto titulo="X" confirmarLabel="Ok" onConfirmar={vi.fn()} onCancelar={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Ok" })).toHaveFocus();
    unmount();
    expect(abridor).toHaveFocus();
    abridor.remove();
  });
});
