from __future__ import annotations

import re
import sys
from pathlib import Path

PAGE = Path("src/app/salao/page.tsx")
TEST = Path("src/app/salao/page.test.tsx")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: esperado 1 trecho, encontrado {count}")
    return text.replace(old, new, 1)


def patch_tests() -> None:
    text = TEST.read_text()
    anchor = '''  it("abrir a comanda mostra o Pedido inicial no histórico e 'Adicionar itens' cria um Complemento 2 no catálogo", async () => {'''
    regression = '''  it("organiza uma comanda em um único card com número forte, cliente e pedidos/status individuais", async () => {
    const agora = new Date().toISOString();
    comandas.push({
      id: "c-ux", numero: 31, cliente: "Teste B", itens: [], status: "enviada", abertaEm: agora, totalParcial: 77,
      rodadas: [
        { id: "r-ux-1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Pizza P", price: 68, qty: 1 }], subtotal: 68, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoId: "ped-ux-1", pedidoNumero: 101, pedidoStatus: "em_preparo" },
        { id: "r-ux-2", numero: 2, status: "enviada", itens: [{ kind: "simple", name: "Guaraná 1L", price: 9, qty: 1 }], subtotal: 9, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoId: "ped-ux-2", pedidoNumero: 102, pedidoStatus: "novo" },
      ],
    });

    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Comanda #31")).toBeInTheDocument();
    expect(screen.getAllByText("Teste B")).toHaveLength(1);
    expect(screen.getByText("Pedido inicial")).toBeInTheDocument();
    expect(screen.getByText("Complemento 2")).toBeInTheDocument();
    expect(screen.getByText("Em preparo")).toBeInTheDocument();
    expect(screen.getByText("Aguardando cozinha")).toBeInTheDocument();
    expect(screen.getByText("R$ 68,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 9,00")).toBeInTheDocument();
    expect(screen.getByText("Total da comanda")).toBeInTheDocument();
    expect(screen.getByText("R$ 77,00")).toBeInTheDocument();
  });

  it("não junta clientes iguais quando o número da comanda é diferente", async () => {
    const agora = new Date().toISOString();
    comandas.push(
      { id: "c-ux-a", numero: 41, cliente: "Teste B", itens: [], status: "enviada", abertaEm: agora, totalParcial: 10, rodadas: [{ id: "r-a", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Item A", price: 10, qty: 1 }], subtotal: 10, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoStatus: "novo" }] },
      { id: "c-ux-b", numero: 42, cliente: "Teste B", itens: [], status: "enviada", abertaEm: agora, totalParcial: 12, rodadas: [{ id: "r-b", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Item B", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoStatus: "novo" }] },
    );

    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Comanda #41")).toBeInTheDocument();
    expect(screen.getByText("Comanda #42")).toBeInTheDocument();
    expect(screen.getAllByText("Teste B")).toHaveLength(2);
  });

'''
    text = replace_once(text, anchor, regression + anchor, "inserção dos testes de UX")
    TEST.write_text(text)


def patch_page() -> None:
    text = PAGE.read_text()
    pattern = r'''function ComandaCard\(\{ comanda, onAbrir \}: \{ comanda: Comanda; onAbrir: \(\) => void \}\) \{.*?\n\}\n\n// ---------------------------------------------------------------------------\n// Fluxo 7 — Visão da comanda'''
    replacement = '''function resumoVisualRodada(r: Rodada): { rotulo: string; orientacao: string | null; cor: string } {
  if (r.status === "falha_envio") return { rotulo: "Falha ao enviar", orientacao: null, cor: "var(--danger)" }
  if (r.status === "enviando") return { rotulo: "Enviando para cozinha", orientacao: null, cor: "var(--foreground-secondary)" }
  if (r.status === "rascunho") return { rotulo: "Montando novo pedido", orientacao: null, cor: "var(--foreground-secondary)" }

  const estado = descreverStatusPedidoSalao(r.pedidoStatus)
  const cor = estado.tom === "perigo"
    ? "var(--danger)"
    : estado.tom === "sucesso"
      ? "var(--success)"
      : estado.tom === "atencao"
        ? "var(--attention-text)"
        : "var(--foreground-secondary)"
  return { rotulo: estado.rotulo, orientacao: estado.orientacao, cor }
}

function ComandaCard({ comanda, onAbrir }: { comanda: Comanda; onAbrir: () => void }) {
  const rodadas = (comanda.rodadas ?? [])
    .filter((r) => r.status !== "rascunho" || r.itens.length > 0)
    .slice()
    .sort((a, b) => a.numero - b.numero)
  const estadoFallback = estadoHumano(comanda)
  const orientacaoFallback = orientacaoHumana(comanda)
  const quantidadePedidos = rodadas.length

  return (
    <button onClick={onAbrir} style={{ ...card, minHeight: 48, display: "grid", gap: 10, textAlign: "left", cursor: "pointer", padding: 12 }}>
      <div style={{ display: "grid", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 950, color: "var(--foreground)", letterSpacing: "-.2px" }}>Comanda #{comanda.numero}</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--foreground-muted)", whiteSpace: "nowrap" }}>{tempoDecorrido(comanda.abertaEm)}</span>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 850, color: "var(--foreground)" }}>{identificacaoCliente(comanda)}</span>
        <span style={{ fontSize: 12.5, color: "var(--foreground-secondary)" }}>{identificacaoMesa(comanda)}</span>
      </div>

      {rodadas.length > 0 ? (
        <div aria-label={`Pedidos da comanda ${comanda.numero}`} style={{ display: "grid", gap: 7 }}>
          {rodadas.map((r) => {
            const visual = resumoVisualRodada(r)
            const horario = r.enviadaEm ? new Date(r.enviadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null
            return (
              <div key={r.id} style={{ display: "grid", gap: 5, padding: "9px 10px", borderRadius: 10, background: "var(--background)", border: "1px solid var(--surface-secondary)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 900, color: "var(--foreground)" }}>{rotuloRodada(r)}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 900, color: visual.cor, textTransform: "uppercase", letterSpacing: ".25px", textAlign: "right" }}>{visual.rotulo}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: "var(--foreground-muted)" }}>
                    {r.itens.length} item(ns){horario ? ` · ${horario}` : ""}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: "var(--brand-text)", whiteSpace: "nowrap" }}>{money(r.subtotal)}</span>
                </div>
                {visual.orientacao && (
                  <span style={{ fontSize: 11.5, lineHeight: 1.35, color: "var(--foreground-secondary)" }}>{visual.orientacao}</span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ padding: "8px 10px", borderRadius: 9, background: "var(--background)", display: "grid", gap: 2 }}>
          <strong style={{ fontSize: 11.5, color: "var(--foreground-secondary)" }}>{estadoFallback}</strong>
          {orientacaoFallback && <span style={{ fontSize: 12, lineHeight: 1.4, color: "var(--foreground-secondary)" }}>{orientacaoFallback}</span>}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingTop: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--foreground-secondary)" }}>
          {quantidadePedidos} {quantidadePedidos === 1 ? "pedido" : "pedidos"}
        </span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 750, color: "var(--foreground-muted)" }}>Total da comanda</span>
          <strong style={{ fontSize: 14, color: "var(--brand-text)" }}>{money(comanda.totalParcial ?? 0)}</strong>
        </span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Fluxo 7 — Visão da comanda'''
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"ComandaCard: esperado 1 bloco, encontrado {count}")
    PAGE.write_text(text)


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"tests", "page"}:
        raise SystemExit("uso: script tests|page")
    if sys.argv[1] == "tests":
        patch_tests()
    else:
        patch_page()


if __name__ == "__main__":
    main()
