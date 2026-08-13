// @vitest-environment jsdom
//
// Testes de INTERAÇÃO do hook compartilhado de acessibilidade de diálogo —
// ESC, Tab preso, foco inicial/de volta, trava de scroll. Todo modal do
// ChefeBot que usa role="dialog" depende deste hook (cardápio, painel,
// conversas, pedido manual, Salão); um bug aqui se espalha para todos eles
// de uma vez — foi assim que o filtro por `offsetParent` (não funciona
// dentro de `position: fixed`) quebrou a armadilha de foco em produção antes
// de ser pego por um teste.
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useDialogA11y } from "./useDialogA11y";

afterEach(cleanup);

function Dialogo({
  aberto,
  onFechar,
  focoNoContainer,
  travarScroll,
}: {
  aberto: boolean;
  onFechar: () => void;
  focoNoContainer?: boolean;
  travarScroll?: boolean;
}) {
  const ref = useDialogA11y(aberto, onFechar, { focoNoContainer, travarScroll });
  if (!aberto) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Diálogo de teste" tabIndex={-1}>
      <button>Primeiro</button>
      <input placeholder="meio" />
      <button>Último</button>
    </div>
  );
}

describe("useDialogA11y — comportamento padrão (sem focoNoContainer)", () => {
  test("ao abrir, o foco vai para o 1º controle focável do diálogo", () => {
    render(<Dialogo aberto onFechar={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
  });

  test("ESC chama onFechar", async () => {
    const user = userEvent.setup();
    const onFechar = vi.fn();
    render(<Dialogo aberto onFechar={onFechar} />);
    await user.keyboard("{Escape}");
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  test("Tab circula dentro do diálogo (não escapa para fora)", async () => {
    const user = userEvent.setup();
    render(<Dialogo aberto onFechar={vi.fn()} />);
    const primeiro = screen.getByRole("button", { name: "Primeiro" });
    const meio = screen.getByPlaceholderText("meio");
    const ultimo = screen.getByRole("button", { name: "Último" });
    expect(primeiro).toHaveFocus();
    await user.tab();
    expect(meio).toHaveFocus();
    await user.tab();
    expect(ultimo).toHaveFocus();
    await user.tab();
    expect(primeiro).toHaveFocus();
    await user.tab({ shift: true });
    expect(ultimo).toHaveFocus();
  });

  test("ao fechar, o foco volta para quem abriu o diálogo", () => {
    const abridor = document.createElement("button");
    document.body.appendChild(abridor);
    abridor.focus();
    expect(abridor).toHaveFocus();
    const { unmount } = render(<Dialogo aberto onFechar={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
    unmount();
    expect(abridor).toHaveFocus();
    abridor.remove();
  });

  test("aberto=false não mexe no foco nem registra listener (ESC não faz nada)", async () => {
    const user = userEvent.setup();
    const onFechar = vi.fn();
    const externo = document.createElement("input");
    document.body.appendChild(externo);
    externo.focus();
    render(<Dialogo aberto={false} onFechar={onFechar} />);
    expect(externo).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onFechar).not.toHaveBeenCalled();
    externo.remove();
  });
});

describe("useDialogA11y — focoNoContainer (conteúdo de leitura antes de agir)", () => {
  test("com focoNoContainer, o foco inicial fica no diálogo, nunca no 1º botão", () => {
    render(<Dialogo aberto onFechar={vi.fn()} focoNoContainer />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Primeiro" })).not.toHaveFocus();
  });

  test("Tab a partir do container segue para o 1º controle normalmente", async () => {
    const user = userEvent.setup();
    render(<Dialogo aberto onFechar={vi.fn()} focoNoContainer />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
  });
});

describe("useDialogA11y — dois diálogos empilhados (o de cima assume sozinho)", () => {
  // Mesmo padrão usado em NovoPedidoManual e no construtor guiado do Salão:
  // o de baixo fica ativo só quando o de cima está fechado.
  function DoisNiveis({ topoAberto, onFecharTopo, onFecharBase }: { topoAberto: boolean; onFecharTopo: () => void; onFecharBase: () => void }) {
    const baseRef = useDialogA11y(!topoAberto, onFecharBase, { travarScroll: false });
    const topoRef = useDialogA11y(topoAberto, onFecharTopo, { travarScroll: false });
    return (
      <div ref={baseRef} role="dialog" aria-modal="true" aria-label="Base" tabIndex={-1}>
        <button>Ação da base</button>
        {topoAberto && (
          <div ref={topoRef} role="dialog" aria-modal="true" aria-label="Topo" tabIndex={-1}>
            <button>Ação do topo</button>
          </div>
        )}
      </div>
    );
  }

  test("com o de cima aberto, ESC chama SÓ o onFechar do de cima", async () => {
    const user = userEvent.setup();
    const onFecharTopo = vi.fn();
    const onFecharBase = vi.fn();
    render(<DoisNiveis topoAberto onFecharTopo={onFecharTopo} onFecharBase={onFecharBase} />);
    await user.keyboard("{Escape}");
    expect(onFecharTopo).toHaveBeenCalledTimes(1);
    expect(onFecharBase).not.toHaveBeenCalled();
  });

  test("com o de cima fechado, ESC chama SÓ o onFechar da base", async () => {
    const user = userEvent.setup();
    const onFecharTopo = vi.fn();
    const onFecharBase = vi.fn();
    render(<DoisNiveis topoAberto={false} onFecharTopo={onFecharTopo} onFecharBase={onFecharBase} />);
    await user.keyboard("{Escape}");
    expect(onFecharBase).toHaveBeenCalledTimes(1);
    expect(onFecharTopo).not.toHaveBeenCalled();
  });
});

describe("useDialogA11y — trava de scroll", () => {
  test("travarScroll (padrão) trava e destrava o body", () => {
    document.body.style.overflow = "";
    const { unmount } = render(<Dialogo aberto onFechar={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  test("travarScroll:false nunca mexe no overflow do body", () => {
    document.body.style.overflow = "";
    render(<Dialogo aberto onFechar={vi.fn()} travarScroll={false} />);
    expect(document.body.style.overflow).toBe("");
  });
});
