import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const fontePixCard = readFileSync(fileURLToPath(new URL("./PixPagamentoCard.tsx", import.meta.url)), "utf-8");
const fonteCombinada = `${fonte}\n${fontePixCard}`;
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

// Nível "UI premium do Pix aguardando" — o card Pix da tela sc-done foi
// extraído para PixPagamentoCard.tsx (reorganização visual apenas). Estes
// testes garantem que nenhuma regra funcional foi perdida na extração:
// os mesmos dados (origem: pedidoConfirmado.pix / statusPixCliente) chegam
// ao componente e os controles antigos (removidos em versões anteriores)
// continuam fora do fluxo.
describe("/cardapio (PublicCardapio) - card Pix premium (aguardando pagamento)", () => {
  test("remove os controles antigos do card Pix final (em page.tsx e no card extraído)", () => {
    expect(fonteCombinada).not.toContain("Copiar chave Pix");
    expect(fonteCombinada).not.toContain("Enviar comprovante no WhatsApp");
    expect(fonteCombinada).not.toContain("Abrir pagamento");
    expect(fonteCombinada).not.toContain("envie o comprovante pelo WhatsApp");
  });

  test("page.tsx delega o card Pix ao componente extraído, passando os mesmos dados de origem", () => {
    expect(fonte).toContain('import PixPagamentoCard from "./PixPagamentoCard"');
    expect(blocoPixFinal).toContain("<PixPagamentoCard");
    expect(blocoPixFinal).toContain("statusPix={statusPixCliente}");
    expect(blocoPixFinal).toContain("statusLabel={PIX_STATUS_LABEL[statusPixCliente]}");
    expect(blocoPixFinal).toContain("pixPedido={pixPedido}");
    expect(blocoPixFinal).toContain("pixCodigoCopiaECola={pixCodigoCopiaECola}");
    expect(blocoPixFinal).toContain("temPixCopiaECola={temPixCopiaECola}");
    expect(blocoPixFinal).toContain("isHibrido={isHibrido}");
    expect(blocoPixFinal).toContain("hibridoAtual={hibridoAtual}");
    expect(blocoPixFinal).toContain("trocoConfirmadoTexto={trocoConfirmadoTexto}");
  });

  test("remove instrucao de WhatsApp e duplicidade de pedido e total no card Pix", () => {
    expect(blocoPixFinal).not.toContain("<strong>Pedido:</strong>");
    expect(blocoPixFinal).not.toContain("<strong>Total:</strong>");
    expect(fonte).toContain("Pedido #{pedidoConfirmado.numero}");
    expect(fonte).toContain("Total: {money(pedidoConfirmado.total)}");
  });

  test("mantem o CTA principal de acompanhamento do pedido", () => {
    expect(fonte).toContain('className="btn"');
    expect(fonte).toContain(">Acompanhar pedido</a>");
  });
});

describe("PixPagamentoCard — card premium do Pix dinâmico (QR, copia-e-cola, status)", () => {
  test("renderiza QR Code a partir do payload Pix copia e cola existente, sem alterar a origem do dado", () => {
    expect(fontePixCard).toContain('import { QRCodeSVG } from "qrcode.react"');
    expect(fontePixCard).toContain("value={pixCodigoCopiaECola}");
    expect(fontePixCard).toContain('aria-label="QR Code Pix"');
  });

  test("QR Code e botão de copiar continuam condicionados a um payload Pix válido", () => {
    expect(fontePixCard).toMatch(/!pago && temPixCopiaECola && \(/);
  });

  test("botão Copiar código Pix copia o payload completo (mesma função copiarTexto) e mostra feedback curto reversível", () => {
    expect(fontePixCard).toContain('import { copiarTexto } from "@/lib/clipboard"');
    expect(fontePixCard).toContain("copiarTexto(pixCodigoCopiaECola)");
    expect(fontePixCard).toContain('"Pix copiado"');
    expect(fontePixCard).toContain('"Código copiado"');
    expect(fontePixCard).toContain("setTimeout(() => setCopiado(false)");
  });

  test("mensagem principal deixa claro que a confirmação só ocorre após o pagamento do Pix", () => {
    expect(fontePixCard).toContain("Seu pedido será confirmado somente");
    expect(fontePixCard).toContain("após o pagamento do Pix");
    expect(fontePixCard).toContain("Assim que o pagamento for identificado, a confirmação acontece automaticamente.");
  });

  test("card de status 'Aguardando pagamento' é exibido com texto (não depende só de cor)", () => {
    expect(fontePixCard).toContain('"Aguardando pagamento"');
    expect(fontePixCard).toContain("role=\"status\"");
    expect(fontePixCard).toContain('aria-live="polite"');
  });

  test("estado confirmado (pago) substitui a espera, usa verde e para a mensagem de aguardando", () => {
    expect(fontePixCard).toContain('const pago = statusPix === "pago"');
    expect(fontePixCard).toContain('"Pagamento confirmado"');
    expect(fontePixCard).toMatch(/pix-status-card \$\{pago \? "pago" : "aguardando"\}/);
    expect(fonte).toContain(".pix-status-card.pago");
    expect(fonte).toContain(".pix-status-card.aguardando .pix-status-icon{animation:pixPulse");
  });

  test("preserva o valor, o pedido híbrido (Pix + Dinheiro) e o troco já validados", () => {
    expect(fontePixCard).toContain("hibridoAtual.pix");
    expect(fontePixCard).toContain("hibridoAtual.dinheiro");
    expect(fontePixCard).toContain("trocoConfirmadoTexto");
  });

  test("chave Pix manual (fallback já existente) continua disponível, sem novo botão de copiar chave", () => {
    expect(fontePixCard).toContain("pixPedido?.chavePix");
    expect(fontePixCard).toContain("pixPedido?.beneficiario");
    expect(fontePixCard).not.toContain("Copiar chave Pix");
  });

  test("respeita prefers-reduced-motion nas animações novas", () => {
    expect(fonte).toContain("@media(prefers-reduced-motion:reduce)");
  });
});
