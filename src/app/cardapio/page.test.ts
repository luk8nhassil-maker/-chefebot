import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nextFlavorSelection } from "./page";

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

describe("nextFlavorSelection — regra de sabor compartilhada por pizza, mini-pizza e calzone", () => {
  test("pizza normal (singleFlavor=false) aceita até 2 sabores (meio a meio)", () => {
    let sel = nextFlavorSelection({ f1: null, f2: null }, "Calabresa", false);
    expect(sel).toEqual({ f1: "Calabresa", f2: null });
    sel = nextFlavorSelection(sel, "Portuguesa", false);
    expect(sel).toEqual({ f1: "Calabresa", f2: "Portuguesa" });
  });

  test("pizza normal: tocar num 3º sabor substitui o 2º, nunca ultrapassa 2", () => {
    const sel = nextFlavorSelection({ f1: "Calabresa", f2: "Portuguesa" }, "Baiana", false);
    expect(sel).toEqual({ f1: "Calabresa", f2: "Baiana" });
  });

  test("calzone/mini-pizza (singleFlavor=true) aceita só 1 sabor, mesmo tentando escolher um 2º em seguida", () => {
    let sel = nextFlavorSelection({ f1: null, f2: null }, "Calabresa", true);
    expect(sel).toEqual({ f1: "Calabresa", f2: null });
    // Tentativa de "manipular o estado" escolhendo um segundo sabor diferente:
    // f2 nunca é preenchido quando singleFlavor é true.
    sel = nextFlavorSelection(sel, "Portuguesa", true);
    expect(sel).toEqual({ f1: "Portuguesa", f2: null });
    expect(sel.f2).toBeNull();
  });

  test("calzone/mini-pizza: tocar no mesmo sabor selecionado desmarca (sem deixar f2 residual)", () => {
    const sel = nextFlavorSelection({ f1: "Calabresa", f2: null }, "Calabresa", true);
    expect(sel).toEqual({ f1: null, f2: null });
  });
});

describe("/cardapio (PublicCardapio) — Calzone entra no mesmo fluxo de sabores das pizzas", () => {
  test("addSimple desvia o Calzone para pickCalzone antes de qualquer outra regra de lanche", () => {
    expect(fonte).toMatch(/function addSimple\([^)]*\)\s*\{\s*if \(isCalzoneName\(it\.name\)\) \{ pickCalzone\(\); return; \}/);
  });

  test("pickCalzone abre o mesmo modal de sabores (flavorModalOpen) e zera qualquer sabor anterior", () => {
    expect(fonte).toContain("function pickCalzone() {");
    const bloco = fonte.slice(fonte.indexOf("function pickCalzone() {"), fonte.indexOf("function pickCalzone() {") + 400);
    expect(bloco).toContain("setCalzoneMode(true)");
    expect(bloco).toContain("setF1(null)");
    expect(bloco).toContain("setF2(null)");
    expect(bloco).toContain("setFlavorModalOpen(true)");
  });

  test("o modal de sabores (mesmo componente da pizza) também renderiza fora da sc-build quando é o calzone", () => {
    expect(fonte).toContain('{(screen === "sc-build" || (screen === "sc-list" && calzoneMode)) && flavorModalOpen && size && (');
  });

  test("pickFlavor usa nextFlavorSelection travando calzone/mini-pizza em 1 sabor (sem duplicar a lógica da pizza)", () => {
    expect(fonte).toContain("const next = nextFlavorSelection({ f1, f2 }, f, miniPizzaMode || calzoneMode);");
  });

  test("calzone consome a mesma lista efetiva de sabores da pizza (pizzaFlavorSections), sem lista própria", () => {
    expect(fonte).toContain('const pizzaFlavorSections = [{ title: "Salgadas", flavors: menu.saltyFlavors || [] }, { title: "Doces", flavors: menu.sweetFlavors || [] }];');
    expect(fonte).toContain("const flavorSections = miniPizzaMode\n    ? [{ title: \"Sabores da mini-pizza\", flavors: miniPizzaFlavors }]\n    : pizzaFlavorSections;");
    // Não existe mais lista própria de sabores do calzone no código do cardápio público.
    expect(fonte).not.toContain("calzoneFlavors");
    expect(fonte).not.toContain("calzoneFlavorsList");
  });

  test("buildOk bloqueia confirmar quando o calzone escolhido está esgotado", () => {
    expect(fonte).toContain("const buildOk = !!size && flavorOk && !(miniPizzaMode && miniPizzaEsgotada) && !(calzoneMode && calzoneEsgotada);");
  });

  test("addCalzone cria item 'simple' no carrinho com o nome do Calzone e o sabor escolhido, preservando o preço-base do cardápio", () => {
    expect(fonte).toContain("function addCalzone() {");
    const bloco = fonte.slice(fonte.indexOf("function addCalzone() {"), fonte.indexOf("function continueBuild()"));
    expect(bloco).toContain("if (!calzoneItem || !f1) return;");
    expect(bloco).toContain("const detail = `Sabor: ${f1}`;");
    expect(bloco).toContain("name: calzoneItem.name, detail, price: calzoneItem.price, qty: 1, keys: [calzoneItem.name, f1]");
  });

  test("continueBuild roteia calzoneMode para addCalzone sem tocar no fluxo de borda/plan das pizzas", () => {
    expect(fonte).toContain('function continueBuild() { if (!buildOk) return; if (miniPizzaMode) addMiniPizza(); else if (calzoneMode) addCalzone(); else go("sc-border"); }');
  });

  test("calzone não conta como pizza no contador 'Pizza N' (pizzasNoCarrinho continua só pizza/mini-pizza)", () => {
    expect(fonte).toContain('function pizzasNoCarrinho() { return cart.filter((c) => c.kind === "pizza" || (c.kind === "simple" && isMiniPizzaName(c.name))).length; }');
  });

  test("adicionar o mesmo calzone+sabor de novo soma quantidade (dedup por nome+detalhe) em vez de duplicar a linha", () => {
    expect(fonte).toContain('const ex = cart.find((c) => c.kind === "simple" && isCalzoneName(c.name) && c.detail === detail);');
  });

  // Não existe, em nenhum produto do carrinho (pizza, mini-pizza, calzone,
  // lanche simples), um fluxo de "editar item" que reabra a escolha de sabor
  // a partir da sacola — só qty +/- (chQty) e remover (rmItem). Por isso não
  // há teste de "editar calzone no carrinho": a funcionalidade não existe.
  test("sacola (sc-cart) não tem ação de editar item — só qty +/- e remover, para todo tipo de item", () => {
    expect(fonte).toContain("function chQty(idx: number, d: number)");
    expect(fonte).toContain("function rmItem(idx: number)");
    expect(fonte).not.toMatch(/ci-edit|onEditItem|editarItemCarrinho/);
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
