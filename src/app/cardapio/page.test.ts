import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const blocoPixFinal = fonte.slice(
  fonte.indexOf("{isPagamentoPix && ("),
  fonte.indexOf("{!isPagamentoPix && isDinheiroPuro")
);

describe("/cardapio (PublicCardapio) — menu inferior unificado com /cliente e /rastrear", () => {
  test("usa o componente compartilhado em vez de markup próprio duplicado", () => {
    expect(fonte).toContain('import ClientBottomNav from "@/components/ClientBottomNav"');
    expect(fonte).toMatch(/<ClientBottomNav\b/);
    // CSS antiga do nav inline não deve sobrar duplicada nesta página.
    expect(fonte).not.toContain(".bottom-nav{");
    expect(fonte).not.toContain(".bnav-item{");
  });

  test("nunca mais rotula a quarta aba como 'Perfil'", () => {
    expect(fonte).not.toContain("Perfil");
  });

  test("Início/Sacola continuam navegação interna (go), sem sair da página", () => {
    expect(fonte).toMatch(/onInicioClick=\{\(\) => go\("sc-start"\)\}/);
    expect(fonte).toMatch(/onSacolaClick=\{\(\) => go\("sc-cart"\)\}/);
  });

  test("não passa mais pedidoHref — aba Pedido é sempre o link estático /cliente/pedidos do componente", () => {
    expect(fonte).not.toContain("pedidoHref");
  });

  test("pedidoRecente (banner 'Acompanhar pedido') continua funcionando fora do menu inferior", () => {
    expect(fonte).toContain("pedidoRecente");
    expect(fonte).toMatch(/href=\{`\/rastrear\/\$\{pedidoRecente\.id\}`\}/);
  });

  test("consome a flag de 'abrir sacola' vinda de /cliente ou /rastrear na hidratação", () => {
    expect(fonte).toContain("consumirFlagAbrirSacola(sessionStorage)");
  });

  test("isAdmin ainda decide entre AdminCardapio e PublicCardapio em /cardapio (lógica intocada)", () => {
    expect(fonte).toMatch(/if \(isAdmin\) return <AdminCardapio menu=\{menu\} onSair=\{[^}]*\} \/>;/);
    expect(fonte).toContain("return <PublicCardapio menu={menu} />;");
  });
});

describe("/cardapio (PublicCardapio) - Pix final simplificado", () => {
  test("remove os controles antigos do card Pix final", () => {
    expect(fonte).not.toContain("Copiar chave Pix");
    expect(fonte).not.toContain("Enviar comprovante no WhatsApp");
    expect(fonte).not.toContain("Abrir pagamento");
  });

  test("renderiza QR Code a partir do payload Pix copia e cola existente", () => {
    expect(fonte).toContain('import { QRCodeSVG } from "qrcode.react"');
    expect(fonte).toContain('const pixCodigoCopiaECola = (pixPedido?.copiaECola || pixPedido?.qrCode || "").trim();');
    expect(fonte).toContain("value={pixCodigoCopiaECola}");
    expect(fonte).toContain('aria-label="QR Code Pix"');
  });

  test("mantem o QR Code e o botao condicionados a um payload valido", () => {
    expect(fonte).toContain("const temPixCopiaECola = pixCodigoCopiaECola.length > 0;");
    expect(fonte).toMatch(/\{temPixCopiaECola && \(\s*<div className="pix-qrcode-wrap">/);
    expect(fonte).toMatch(/\{temPixCopiaECola && \(\s*<button className="btn btn-sm btn-ghost pix-copy-btn"/);
  });

  test("botao Copiar codigo Pix copia o payload completo e mostra feedback curto", () => {
    expect(fonte).toContain('import { Pizza, Sandwich, Soup, CupSoda, GlassWater, Zap, Banknote, CreditCard, Shuffle, Wallet, Bike, Store, UtensilsCrossed, Sun, Moon, Copy } from "lucide-react"');
    expect(fonte).toContain('<Copy size={17} aria-hidden="true" />');
    expect(fonte).toContain("<span>Copiar código Pix</span>");
    expect(fonte).toContain('className="btn btn-sm btn-ghost pix-copy-btn"');
    expect(fonte).toContain("copiarTexto(pixCodigoCopiaECola)");
    expect(fonte).toContain('"Pix copiado"');
  });

  test("remove instrucao de WhatsApp e duplicidade de pedido e total no card Pix", () => {
    expect(fonte).not.toContain("envie o comprovante pelo WhatsApp");
    expect(blocoPixFinal).not.toContain("<strong>Pedido:</strong>");
    expect(blocoPixFinal).not.toContain("<strong>Total:</strong>");
    expect(fonte).toContain("Pedido #{pedidoConfirmado.numero}");
    expect(fonte).toContain("Total: {money(pedidoConfirmado.total)}");
  });

  test("preserva status, dados Pix e CTA principal de acompanhamento", () => {
    expect(fonte).toContain("PIX_STATUS_LABEL[statusPixCliente]");
    expect(fonte).toContain("pixPedido?.chavePix");
    expect(fonte).toContain("pixPedido?.beneficiario");
    expect(fonte).toContain('statusPixCliente === "pago"');
    expect(fonte).toContain("em_revisao");
    expect(fonte).toContain("conferencia_manual");
    expect(fonte).toContain('className="btn"');
    expect(fonte).toContain(">Acompanhar pedido</a>");
  });
});
