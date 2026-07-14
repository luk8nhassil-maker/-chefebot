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

  test("page.tsx delega o card Pix ao componente extraído, passando os mesmos dados de origem (incluindo número e total do pedido)", () => {
    expect(fonte).toContain('import PixPagamentoCard from "./PixPagamentoCard"');
    expect(blocoPixFinal).toContain("<PixPagamentoCard");
    expect(blocoPixFinal).toContain("statusPix={statusPixCliente}");
    expect(blocoPixFinal).toContain("statusLabel={PIX_STATUS_LABEL[statusPixCliente]}");
    expect(blocoPixFinal).toContain("pedidoNumero={pedidoConfirmado.numero}");
    expect(blocoPixFinal).toContain("pedidoTotal={pedidoConfirmado.total}");
    expect(blocoPixFinal).toContain("pixPedido={pixPedido}");
    expect(blocoPixFinal).toContain("pixCodigoCopiaECola={pixCodigoCopiaECola}");
    expect(blocoPixFinal).toContain("temPixCopiaECola={temPixCopiaECola}");
    expect(blocoPixFinal).toContain("isHibrido={isHibrido}");
    expect(blocoPixFinal).toContain("hibridoAtual={hibridoAtual}");
    expect(blocoPixFinal).toContain("trocoConfirmadoTexto={trocoConfirmadoTexto}");
  });

  test("remove instrucao de WhatsApp e nao duplica pedido/total no bloco Pix (número/total do Pix vêm só via props do PixPagamentoCard)", () => {
    expect(blocoPixFinal).not.toContain("<strong>Pedido:</strong>");
    expect(blocoPixFinal).not.toContain("<strong>Total:</strong>");
    expect(blocoPixFinal).not.toContain("Pedido #{pedidoConfirmado.numero}");
    // O texto solto "Pedido #..." continua existindo só no ramo não-Pix (dinheiro/cartão).
    expect(fonte).toContain("Pedido #{pedidoConfirmado.numero}");
  });

  test("reduz o protagonismo do cabeçalho genérico ('Pedido recebido!') quando o pagamento é Pix", () => {
    expect(fonte).toContain('className={`check ${isPagamentoPix ? "check-compact" : ""}`}');
    expect(fonte).toContain('className={isPagamentoPix ? "success-h2-compact" : ""}');
    expect(fonte).toContain(".check.check-compact{");
    expect(fonte).toContain(".success-h2-compact{");
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

  test("headline principal grita 'FALTA PAGAR O PIX', com bloco de aviso e ação em destaque máximo", () => {
    expect(fontePixCard).toContain("FALTA PAGAR");
    expect(fontePixCard).toContain('<span className="destaque">O PIX</span>');
    expect(fontePixCard).toContain("Seu pedido ainda não foi confirmado.");
    expect(fontePixCard).toContain("A confirmação acontece somente após o pagamento do Pix.");
    expect(fontePixCard).toContain("Escaneie o QR Code ou copie o código Pix abaixo");
    expect(fontePixCard).toContain("Assim que o pagamento for identificado, seu pedido será confirmado automaticamente.");
  });

  test("bloco de alerta domina a tela com tipografia grande e contraste forte (não é mais um card discreto)", () => {
    expect(fonte).toContain(".pix-alerta-headline{margin:0;font-size:clamp(24px,7vw,32px);font-weight:800");
    expect(fonte).toContain(".pix-alerta{position:relative;text-align:center;background:linear-gradient");
    expect(fonte).toContain("border:2px solid var(--brand)");
  });

  test("card de status 'Aguardando pagamento' é exibido com texto (não depende só de cor) e nunca fica escondido em um chip pequeno", () => {
    expect(fontePixCard).toContain('"Aguardando pagamento"');
    expect(fontePixCard).toContain("role=\"status\"");
    expect(fontePixCard).toContain('aria-live="polite"');
    expect(fontePixCard).toContain("pix-alerta-eyebrow");
  });

  test("estado confirmado (pago) substitui todo o bloco de alerta, usa verde e para a mensagem de aguardando", () => {
    expect(fontePixCard).toContain('const pago = statusPix === "pago"');
    expect(fontePixCard).toContain('"Pagamento confirmado"');
    expect(fontePixCard).toContain("Pagamento confirmado! ✅");
    expect(fontePixCard).toMatch(/pix-alerta \$\{pago \? "pago" : ""\}/);
    expect(fonte).toContain(".pix-alerta.pago{background:linear-gradient(180deg, var(--green-soft)");
  });

  test("animações ficam perceptíveis: glow pulsante no alerta, glow no QR, seta animada e feedback de cópia", () => {
    expect(fonte).toContain("@keyframes pixGlow{");
    expect(fonte).toContain("@keyframes pixQrGlow{");
    expect(fonte).toContain("@keyframes pixBounce{");
    expect(fonte).toContain("@keyframes pixPop{");
    expect(fontePixCard).toContain('className="pix-alerta-seta"');
    expect(fontePixCard).toContain('className={`pix-copiar-btn ${copiado ? "copiado" : ""}`}');
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
