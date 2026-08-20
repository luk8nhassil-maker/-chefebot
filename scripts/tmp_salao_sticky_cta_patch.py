from __future__ import annotations

import sys
from pathlib import Path

PAGE = Path("src/app/salao/page.tsx")
TEST = Path("src/app/salao/page.test.tsx")
PLACEHOLDER = Path("scripts/tmp_placeholder.txt")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: esperado 1 trecho, encontrado {count}")
    return text.replace(old, new, 1)


def patch_tests() -> None:
    text = TEST.read_text()
    anchor = '''  it("mostra emojis no fluxo e mantém sabor obrigatório", async () => {'''
    regression = '''  it("mantém o CTA principal visível no rodapé mobile e com contraste escuro suave", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);

    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
    await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));

    const revisar = await screen.findByRole("button", { name: "Revisar pedido" });
    expect(revisar.closest(".sal-action-footer")).not.toBeNull();
    expect(revisar).toHaveStyle({ color: "#374151" });

    const estilos = Array.from(document.querySelectorAll("style")).map((el) => el.textContent || "").join("\\n");
    expect(estilos).toContain(".sal-action-footer");
    expect(estilos).toContain("position:sticky");
    expect(estilos).toContain("bottom:0");
    expect(estilos).toContain("env(safe-area-inset-bottom)");

    await user.click(revisar);
    const enviar = await screen.findByRole("button", { name: "Enviar para cozinha" });
    expect(enviar.closest(".sal-action-footer")).not.toBeNull();
    expect(enviar).toHaveStyle({ color: "#374151" });
  });

'''
    if anchor not in text:
        raise SystemExit("anchor do teste de UX não encontrado")
    text = text.replace(anchor, regression + anchor, 1)
    TEST.write_text(text)


def patch_page() -> None:
    text = PAGE.read_text()

    text = replace_once(
        text,
        'const FONT = "\'Archivo\', sans-serif"\n',
        'const FONT = "\'Archivo\', sans-serif"\nconst COR_TEXTO_CTA = "#374151"\n',
        "token de contraste do CTA",
    )

    text = replace_once(
        text,
        'const btnPrimario: React.CSSProperties = { height: 48, borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: FONT, border: "none", background: "var(--primary)", color: "var(--background)" }',
        'const btnPrimario: React.CSSProperties = { height: 48, borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: FONT, border: "none", background: "var(--primary)", color: COR_TEXTO_CTA }',
        "contraste do botão primário",
    )

    text = replace_once(
        text,
        '      .sal-bottomnav-spacer{height:84px}\\n',
        '      .sal-bottomnav-spacer{height:84px}\\n      .sal-action-footer{background:var(--background);border-top:1px solid var(--surface);padding:12px 16px calc(12px + env(safe-area-inset-bottom));flex-shrink:0;display:grid;gap:8px}\\n',
        "estilo base do rodapé de ação",
    )

    text = replace_once(
        text,
        '      @media (min-width: 768px){\\n        .sal-content{max-width:900px;margin:0 auto;padding:24px}\\n      }\\n',
        '      @media (max-width: 767px){\\n        .sal-action-footer{position:sticky;bottom:0;z-index:70;padding-left:max(16px, env(safe-area-inset-left));padding-right:max(16px, env(safe-area-inset-right));box-shadow:0 -10px 28px color-mix(in srgb, var(--foreground) 8%, transparent)}\\n      }\\n      @media (min-width: 768px){\\n        .sal-content{max-width:900px;margin:0 auto;padding:24px}\\n      }\\n',
        "responsividade do rodapé de ação",
    )

    old_footer = '<div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>'
    count = text.count(old_footer)
    if count != 4:
        raise SystemExit(f"rodapés de ação: esperado 4, encontrado {count}")
    text = text.replace(old_footer, '<div className="sal-action-footer">')

    PAGE.write_text(text)
    if PLACEHOLDER.exists():
        PLACEHOLDER.unlink()


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"tests", "page"}:
        raise SystemExit("uso: script tests|page")
    if sys.argv[1] == "tests":
        patch_tests()
    else:
        patch_page()


if __name__ == "__main__":
    main()
