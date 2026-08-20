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
    pattern = r'''  it\("Sim revela somente as opções reais de borda/adicionais e exige escolha", async \(\) => \{.*?\n  \}\);\n\n  it\("adicional opcional único também usa Sim/Não antes de mostrar opções",'''
    replacement = '''  it("Sim revela opções com emojis e permite mudar de ideia sem ficar preso", async () => {
    const user = userEvent.setup();
    await abrirPizzaComSabor(user);

    await user.click(await screen.findByRole("button", { name: "Sim" }));
    expect(await screen.findByRole("button", { name: /🧀 Catupiry/ })).toBeInTheDocument();
    const semBorda = screen.getByRole("button", { name: "Sem borda" });
    expect(semBorda).toBeEnabled();
    await user.click(semBorda);

    expect(await screen.findByText("Vai querer adicionais?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sim" }));
    expect(await screen.findByRole("button", { name: /➕ Bacon/ })).toBeInTheDocument();
    const semAdicionais = screen.getByRole("button", { name: "Sem adicionais" });
    expect(semAdicionais).toBeEnabled();
    await user.click(semAdicionais);

    expect(await screen.findByText("1 item(ns)")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 33,00").length).toBeGreaterThan(0);
  });

  it("adicional opcional único também usa Sim/Não antes de mostrar opções",'''
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"teste de regressão principal: esperado 1, encontrado {count}")

    old_optional = '''    await user.click(screen.getByRole("button", { name: /Ovo/ }));
    await user.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText("1 item(ns)")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 35,00").length).toBeGreaterThan(0);'''
    new_optional = '''    await user.click(screen.getByRole("button", { name: /Ovo/ }));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("1 item(ns)")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 35,00").length).toBeGreaterThan(0);'''
    text = replace_once(text, old_optional, new_optional, "teste do adicional opcional")
    TEST.write_text(text)


def patch_page() -> None:
    text = PAGE.read_text()

    text = replace_once(
        text,
        'const FONT = "\'Archivo\', sans-serif"\n',
        '''const FONT = "'Archivo', sans-serif"
const EMOJI_CATEGORIA_PEDIDO: Record<CategoriaManual, string> = {
  pizza: "🍕",
  calzone: "🥟",
  pastelForno: "🥟",
  lanches: "🍔",
  hamburgueres: "🍔",
  macarronada: "🍝",
  bebidas: "🥤",
  sucos: "🧃",
  vitaminas: "🥛",
}

function emojiOpcaoMontagem(tipo: string | undefined, categoria: CategoriaManual): string {
  if (tipo === "borda") return "🧀"
  if (tipo === "adicionais" || tipo === "adicional_opcional") return "➕"
  if (tipo === "leite") return "🥛"
  return EMOJI_CATEGORIA_PEDIDO[categoria]
}
''',
        "tokens de emoji",
    )

    pattern = r'''  const bloqueioOpcional = mostrarPerguntaOpcional.*?  const perguntaOpcional = etapaAtual\?\.tipo === "borda"'''
    replacement = '''  // Opcionais continuam reversíveis mesmo depois do “Sim”: se nada for
  // escolhido, o CTA permite seguir explicitamente sem aquele opcional.
  const opcionalTemSelecao = etapaAtual?.tipo === "borda"
    ? !!selecao.borda
    : etapaAtual?.tipo === "adicionais"
      ? (selecao.adicionais?.length ?? 0) > 0
      : etapaAtual?.tipo === "adicional_opcional"
        ? !!selecao.adicionalOpcional
        : false
  const bloqueio = mostrarPerguntaOpcional || etapaOpcional ? null : motivoBloqueio(etapaAtual, selecao)
  const rotuloCtaOpcional = etapaAtual?.tipo === "borda"
    ? (opcionalTemSelecao ? "Continuar" : "Sem borda")
    : etapaAtual?.tipo === "adicionais"
      ? (opcionalTemSelecao ? "Continuar" : "Sem adicionais")
      : etapaAtual?.tipo === "adicional_opcional"
        ? (opcionalTemSelecao ? "Continuar" : "Sem adicional")
        : "Continuar"
  const perguntaOpcional = etapaAtual?.tipo === "borda"'''
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"bloqueio opcional: esperado 1, encontrado {count}")

    text = replace_once(
        text,
        '''    : etapaAtual?.tipo === "borda"
      ? "Escolha a borda."
      : etapaAtual?.tipo === "adicionais"
        ? "Escolha um ou mais adicionais."
        : etapaAtual?.tipo === "adicional_opcional"
          ? "Escolha 1 adicional."
          : etapaAtual?.ajuda''',
        '''    : etapaAtual?.tipo === "borda"
      ? "Escolha uma borda ou continue sem borda."
      : etapaAtual?.tipo === "adicionais"
        ? "Escolha os adicionais ou continue sem adicionais."
        : etapaAtual?.tipo === "adicional_opcional"
          ? "Escolha 1 adicional ou continue sem adicional."
          : etapaAtual?.ajuda''',
        "ajuda dos opcionais",
    )

    text = replace_once(
        text,
        '''  function avancarEtapa() {
    if (!etapaAtual || mostrarPerguntaOpcional || bloqueio || salvandoItemRef.current) return
    if (!etapaOpcional && !etapaSatisfeita(etapaAtual, selecao)) return
    if (etapaVisivel < etapas.length - 1) {
      setEtapaVisivel(etapaVisivel + 1)
      return
    }
    finalizarMontagem(selecao)
  }
''',
        '''  function normalizarOpcionalSemEscolha(atual: SelecaoMontagem): SelecaoMontagem {
    if (!etapaAtual || !etapaOpcional) return atual
    if (etapaAtual.tipo === "borda" && !atual.borda) return { ...atual, borda: null }
    if (etapaAtual.tipo === "adicionais" && (atual.adicionais?.length ?? 0) === 0) return { ...atual, adicionais: [] }
    if (etapaAtual.tipo === "adicional_opcional" && !atual.adicionalOpcional) return { ...atual, adicionalOpcional: null }
    return atual
  }

  function avancarEtapa() {
    if (!etapaAtual || mostrarPerguntaOpcional || bloqueio || salvandoItemRef.current) return
    if (!etapaOpcional && !etapaSatisfeita(etapaAtual, selecao)) return
    const selecaoFinal = etapaOpcional ? normalizarOpcionalSemEscolha(selecao) : selecao
    if (selecaoFinal !== selecao) setSelecao(selecaoFinal)
    if (etapaVisivel < etapas.length - 1) {
      setEtapaVisivel(etapaVisivel + 1)
      return
    }
    finalizarMontagem(selecaoFinal)
  }
''',
        "avanço reversível",
    )

    text = replace_once(
        text,
        '              {c.label}\n            </button>',
        '              {EMOJI_CATEGORIA_PEDIDO[c.id]} {c.label}\n            </button>',
        "emoji nas categorias",
    )
    text = replace_once(
        text,
        '<span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{p.nome}{p.esgotado ? " · esgotado" : ""}</span>',
        '<span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{EMOJI_CATEGORIA_PEDIDO[p.categoria]} {p.nome}{p.esgotado ? " · esgotado" : ""}</span>',
        "emoji nos produtos",
    )
    text = replace_once(
        text,
        '<span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{o.label}{o.esgotado ? " · esgotado" : ""}</span>',
        '<span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{emojiOpcaoMontagem(etapaAtual.tipo, produtoAberto.categoria)} {o.label}{o.esgotado ? " · esgotado" : ""}</span>',
        "emoji nas opções",
    )
    text = replace_once(
        text,
        '{salvandoItem ? "Salvando…" : etapaVisivel < etapas.length - 1 ? `Continuar para ${etapas[etapaVisivel + 1].titulo.toLowerCase()}` : "Adicionar"}',
        '{salvandoItem ? "Salvando…" : etapaOpcional ? rotuloCtaOpcional : etapaVisivel < etapas.length - 1 ? `Continuar para ${etapas[etapaVisivel + 1].titulo.toLowerCase()}` : "Adicionar"}',
        "CTA dos opcionais",
    )

    PAGE.write_text(text)


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"tests", "page"}:
        raise SystemExit("uso: tmp_salao_opcionais_patch.py tests|page")
    if sys.argv[1] == "tests":
        patch_tests()
    else:
        patch_page()


if __name__ == "__main__":
    main()
