import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nextFlavorSelection, resolverPizzaSelectionIds } from "./page";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { MENU } from "@/lib/menu";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const fontePixCard = readFileSync(fileURLToPath(new URL("./PixPagamentoCard.tsx", import.meta.url)), "utf-8");
const fonteCombinada = `${fonte}\n${fontePixCard}`;
const blocoPixFinal = fonte.slice(
  fonte.indexOf("{isPagamentoPix && ("),
  fonte.indexOf("{!isPagamentoPix && isDinheiroPuro")
);

describe("/cardapio (PublicCardapio) — menu inferior unificado com /cliente e /rastrear", () => {
  test("usa o componente compartilhado em vez de markup próprio duplicado", () => {
    expect(fonte).toContain('import ClientBottomNav, { CLIENT_BOTTOM_NAV_HEIGHT_PX } from "@/components/ClientBottomNav"');
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

  test("home (sc-start) não tem mais o card/banner 'Acompanhar pedido' (Etapa 2: card operacional removido)", () => {
    expect(fonte).not.toContain("pedidoRecente");
    expect(fonte).not.toContain("dispensarPedidoRecente");
    expect(fonte).not.toContain("Seu último pedido está em andamento");
  });

  test("edição de pedido (main) não depende do banner removido — usa pedidoConfirmado.statusToken na tela sc-done", () => {
    expect(fonte).toMatch(/href=\{`\/pedido\/editar\/\$\{pedidoConfirmado\.id\}\?token=\$\{encodeURIComponent\(pedidoConfirmado\.statusToken\)\}`\}/);
    expect(fonte).toContain("Editar pedido");
  });

  test("consome a flag de 'abrir sacola' vinda de /cliente ou /rastrear na hidratação", () => {
    expect(fonte).toContain("consumirFlagAbrirSacola(sessionStorage)");
  });

  test("isAdmin ainda decide entre AdminCardapio e PublicCardapio em /cardapio (lógica intocada)", () => {
    expect(fonte).toMatch(/if \(isAdmin\) return <AdminCardapio menu=\{menu\} onSair=\{[^}]*\} \/>;/);
    expect(fonte).toContain("return <PublicCardapio menu={menu} />;");
  });
});

// Etapa 2 do fluxo de "Pix pendente": home (tela sc-start) só pode mostrar
// promoção ativa — nenhum card de notificação/estado operacional de pedido.
describe("/cardapio (PublicCardapio) — Etapa 2: home limpa + barra global de Pix pendente", () => {
  const blocoHome = fonte.slice(fonte.indexOf('screen === "sc-start" && ('), fonte.indexOf("promos.length > 0"));

  test("[caso 10] home não renderiza nenhum card de pedido em andamento/acompanhamento/pagamento", () => {
    expect(blocoHome).not.toContain("pedidoRecente");
    expect(blocoHome).not.toContain("Acompanhar pedido");
    expect(blocoHome).not.toContain("em andamento");
    expect(fonte).not.toContain("dispensarPedidoRecente");
  });

  test("[caso 11] promoção ativa continua aparecendo na home", () => {
    expect(fonte).toContain('{promos.length > 0 && (');
    expect(fonte).toContain('className="promo-scroll"');
  });

  test("convite não-operacional de fidelidade (não é estado de pedido) continua permitido na home", () => {
    expect(fonte).toContain("Entre com seu WhatsApp e acompanhe suas pizzas");
  });

  test("usa o hook central usePixPendente (uma única fonte, evita fetch duplicado com o badge do menu)", () => {
    expect(fonte).toContain('import PixPendenteBar, { usePixPendente, PIX_PENDENTE_BAR_HEIGHT_PX } from "@/components/PixPendenteBar"');
    expect(fonte).toContain("usePixPendente()");
  });

  test("barra de Pix pendente nunca aparece na tela sc-done (a própria tela de pagamento)", () => {
    expect(fonte).toMatch(/const pixBarVisivel = showBottomNav && screen !== "sc-done" && !!pixPendente;/);
    expect(fonte).toContain("{pixBarVisivel && <PixPendenteBar pendente={pixPendente} />}");
  });

  test("indicador da aba Pedido recebe o mesmo estado resolvido pelo hook", () => {
    expect(fonte).toMatch(/<ClientBottomNav[\s\S]{0,220}pixPendente=\{!!pixPendente\}/);
  });

  test("salva a referência mínima local só quando o pagamento é Pix, nunca QR/copia-e-cola/chave", () => {
    expect(fonte).toContain("salvarReferenciaPixPendente(localStorage, { pedidoId: String(data.pedidoId), statusToken: data.statusToken, numero:");
    expect(fonte).toMatch(/if \(payment\?\.toLowerCase\(\)\.includes\("pix"\) && typeof data\.statusToken === "string"\)/);
  });
});

// Correção isolada: a barra fixa "Pix pendente" não pode sobrepor os
// painéis de ação fixos das etapas do fluxo /pedido (ex.: Sacola). Regra
// única, sem número mágico duplicado por tela: uma variável CSS
// compartilhada (--pix-pendente-fixed-offset) que os painéis fixos somam
// ao próprio `bottom`.
describe("/cardapio (PublicCardapio) — correção: barra Pix pendente não cobre ações fixas do fluxo", () => {
  test("[caso 9] a variável compartilhada é derivada de PIX_PENDENTE_BAR_HEIGHT_PX (import da própria constante já usada pelo espaçador da barra), nunca de um valor novo", () => {
    expect(fonte).toContain('import PixPendenteBar, { usePixPendente, PIX_PENDENTE_BAR_HEIGHT_PX } from "@/components/PixPendenteBar"');
    expect(fonte).toContain("`:root{--pix-pendente-fixed-offset:${pixBarVisivel ? PIX_PENDENTE_BAR_HEIGHT_PX : 0}px}`");
  });

  test("[caso 3] sem Pix pendente (pixBarVisivel=false), o offset cai para 0px — painel volta à posição original, sem espaço sobrando", () => {
    expect(fonte).toMatch(/\$\{pixBarVisivel \? PIX_PENDENTE_BAR_HEIGHT_PX : 0\}px/);
  });

  test("[caso 10] nenhum outro lugar do arquivo declara um novo número mágico de altura da barra Pix (só reaproveita a constante importada)", () => {
    const declaraNovaAltura = /--pix-pendente-fixed-offset:\s*\d/;
    expect(fonte).not.toMatch(declaraNovaAltura);
  });

  test("[caso 8] offset não mexe em padding/safe-area do painel fixo — só desloca o `bottom`, safe-area continua isolada no próprio padding do painel", () => {
    expect(fonte).toContain(".delivery-cta-bar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:55;background:linear-gradient(to top,var(--bg) 78%,transparent);padding:18px 20px calc(env(safe-area-inset-bottom) + 14px);pointer-events:none}");
  });

  test("[caso 11] telas sem painel .stacked (entrega/pagamento) não recebem o offset — showBottomNav (e portanto a barra) não aparece nessas etapas, então não há sobreposição a corrigir ali", () => {
    expect(fonte).toContain('.delivery-cta-bar{position:fixed;bottom:0;');
    expect(fonte).not.toMatch(/screen === "sc-delivery"[\s\S]{0,80}"delivery-cta-bar stacked"/);
  });
});

// Correção: o CTA da Sacola (.delivery-cta-bar.stacked) usava um número
// mágico (58px) desatualizado desde que o ClientBottomNav virou a "pill"
// flutuante atual (105px de altura real) — a barra branca do CTA invadia a
// pill do menu inferior. Corrigido reaproveitando CLIENT_BOTTOM_NAV_HEIGHT_PX
// (já exportada por ClientBottomNav.tsx especificamente para isto, mesmo
// padrão já usado por PixPendenteBar.tsx) em vez de duplicar a altura como
// um número novo em page.tsx. Medido via harness real de layout (Playwright)
// em 390×844 e 1440×900: sem sobreposição, sem espaço exagerado, e o último
// item rolável da sacola não fica escondido atrás do CTA — .cart-screen/
// .list-screen mantiveram o padding-bottom original porque a medição não
// comprovou necessidade de ajuste.
describe("/cardapio (PublicCardapio) — correção: CTA da sacola (.delivery-cta-bar.stacked) não sobrepõe o menu inferior", () => {
  test("[1] page.tsx importa e reutiliza CLIENT_BOTTOM_NAV_HEIGHT_PX de ClientBottomNav.tsx, sem trocar o import padrão do componente", () => {
    expect(fonte).toContain('import ClientBottomNav, { CLIENT_BOTTOM_NAV_HEIGHT_PX } from "@/components/ClientBottomNav"');
  });

  test("[2] .delivery-cta-bar.stacked não contém mais o número mágico 58px", () => {
    expect(fonte).not.toMatch(/\.delivery-cta-bar\.stacked\{bottom:calc\(58px/);
  });

  test("[3] o bottom do painel empilhado é derivado da altura oficial do ClientBottomNav (interpolação da constante importada, nunca um número novo) somada ao offset do Pix pendente", () => {
    expect(fonte).toContain(".delivery-cta-bar.stacked{bottom:calc(${CLIENT_BOTTOM_NAV_HEIGHT_PX}px + var(--pix-pendente-fixed-offset, 0px));transition:bottom .2s ease}");
  });

  test("[4] o offset compartilhado --pix-pendente-fixed-offset continua sendo somado ao bottom do CTA (não foi substituído, só a base 58px→CLIENT_BOTTOM_NAV_HEIGHT_PX mudou)", () => {
    expect(fonte).toMatch(/\.delivery-cta-bar\.stacked\{bottom:calc\(\$\{CLIENT_BOTTOM_NAV_HEIGHT_PX\}px \+ var\(--pix-pendente-fixed-offset, 0px\)\)/);
  });

  test("[5 e 6] sem Pix pendente o offset é 0 (CTA fica exatamente CLIENT_BOTTOM_NAV_HEIGHT_PX acima do menu); com Pix pendente o offset soma PIX_PENDENTE_BAR_HEIGHT_PX, empurrando o CTA para cima da PixPendenteBar — mesma variável e mesma regra, sem duplicar lógica por caso", () => {
    // Já provado pelos testes [caso 3]/[caso 9] acima que a variável assume
    // 0 sem pendência e PIX_PENDENTE_BAR_HEIGHT_PX com pendência; aqui só
    // confirmamos que é ESSA MESMA variável que o CTA soma ao seu bottom.
    const reglaStacked = fonte.match(/\.delivery-cta-bar\.stacked\{bottom:calc\([^)]*\)/)?.[0] ?? "";
    expect(reglaStacked).toContain("var(--pix-pendente-fixed-offset, 0px)");
  });

  test("[7] sc-cart continua usando delivery-cta-bar stacked (o painel com Subtotal/Adicionar/Ir para entrega)", () => {
    expect(fonte).toMatch(/screen === "sc-cart" && \(\s*<div className=\{`delivery-cta-bar \$\{showBottomNav \? "stacked" : ""\}`\}>/);
  });

  test("[8] sc-delivery e sc-pay continuam sem bottom nav (fora de showBottomNav) e sem a classe stacked — não recebem nenhum deslocamento novo", () => {
    expect(fonte).not.toContain('["sc-start", "sc-list", "sc-cart", "sc-done"].includes(screen) === false');
    const showBottomNavDecl = fonte.match(/const showBottomNav = \[[^\]]*\]\.includes\(screen\);/)?.[0] ?? "";
    expect(showBottomNavDecl).not.toContain('"sc-delivery"');
    expect(showBottomNavDecl).not.toContain('"sc-pay"');
    expect(fonte).toMatch(/screen === "sc-delivery" && \(\s*<div className="delivery-cta-bar">/);
    expect(fonte).toMatch(/screen === "sc-pay" && \(\s*<div className="delivery-cta-bar">/);
  });

  test("[9] nenhum texto/ação funcional do CTA da sacola mudou (Subtotal, Adicionar, Ir para entrega, preço via money(cartTotal))", () => {
    const blocoCtaSacola = fonte.slice(
      fonte.indexOf('cartCount > 0 && screen === "sc-cart" && ('),
      fonte.indexOf('cartCount > 0 && screen === "sc-delivery" && (')
    );
    expect(blocoCtaSacola).toContain('<div className="delivery-cta-label">Subtotal</div>');
    expect(blocoCtaSacola).toContain('<div className="delivery-cta-total">{money(cartTotal)}</div>');
    expect(blocoCtaSacola).toContain('<button className="delivery-cta-cart" onClick={() => go("sc-start")}>Adicionar</button>');
    expect(blocoCtaSacola).toContain('onClick={() => !cartEsgotado && go("sc-delivery")}>Ir para entrega</button>');
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
    expect(fonte).toContain('className="btn btn-icon"');
    expect(fonte).toMatch(/Acompanhar pedido\s*<\/a>/);
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

describe("resolverPizzaSelectionIds — resolução de IDs do catálogo oficial (Fase 2C)", () => {
  const catalog = buildPizzaCatalog(MENU);

  test("pizza de 1 sabor sem borda: resolve sizeId + 1 flavorId, sem borderId", () => {
    const sel = resolverPizzaSelectionIds(catalog, "G", "Calabresa", null, null);
    const sizeG = catalog.sizes.find((s) => s.code === "G")!;
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa")!;
    expect(sel).toEqual({ sizeId: sizeG.id, flavorIds: [calabresa.id] });
  });

  test("meio a meio: resolve os 2 flavorIds na mesma ordem do clique (servidor trata ordem como irrelevante)", () => {
    const sel = resolverPizzaSelectionIds(catalog, "G", "Calabresa", "Baiana", null);
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa")!;
    const baiana = catalog.flavors.find((f) => f.name === "Baiana")!;
    expect(sel?.flavorIds).toEqual([calabresa.id, baiana.id]);
  });

  test("com borda: inclui borderId resolvido pelo label", () => {
    const sel = resolverPizzaSelectionIds(catalog, "F", "Calabresa", null, "Catupiry");
    const border = catalog.borders.find((b) => b.label === "Catupiry")!;
    expect(sel?.borderId).toBe(border.id);
  });

  test("catálogo ausente (ainda não carregado): undefined, nunca lança exceção", () => {
    expect(resolverPizzaSelectionIds(undefined, "G", "Calabresa", null, null)).toBeUndefined();
  });

  test("tamanho que não existe no catálogo: undefined", () => {
    expect(resolverPizzaSelectionIds(catalog, "XG-INEXISTENTE", "Calabresa", null, null)).toBeUndefined();
  });

  test("sabor que não existe no catálogo: undefined", () => {
    expect(resolverPizzaSelectionIds(catalog, "G", "Sabor Inventado", null, null)).toBeUndefined();
  });

  test("borda que não existe no catálogo: undefined", () => {
    expect(resolverPizzaSelectionIds(catalog, "G", "Calabresa", null, "Borda Inventada")).toBeUndefined();
  });

  test("resolve normalmente mesmo com sabor esgotado (disponibilidade é responsabilidade do servidor/motor nativo, não deste resolver)", () => {
    const catalogComEsgotado = buildPizzaCatalog(MENU, ["Calabresa"]);
    const sel = resolverPizzaSelectionIds(catalogComEsgotado, "G", "Calabresa", null, null);
    expect(sel).toBeDefined();
  });
});

describe("/cardapio (PublicCardapio) — wiring de pizzaSelection (Fase 2C)", () => {
  test("addPizzaWithBorder monta pizzaSelection a partir do catálogo oficial e só o inclui no item quando resolvido", () => {
    expect(fonte).toMatch(
      /const pizzaSelection = resolverPizzaSelectionIds\(menu\.pizzaCatalog, size!, f1!, mam \? f2 : null, chosenBorder\);/
    );
    expect(fonte).toMatch(/\.\.\.\(pizzaSelection \? \{ pizzaSelection \} : \{\}\)/);
  });

  test("payload de POST /api/pedido-app envia pizzaSelection quando o item do carrinho tem (sem substituir name/detail/price)", () => {
    expect(fonte).toMatch(
      /kind: c\.kind, name: c\.name, detail: c\.detail, price: c\.price, qty: c\.qty, \.\.\.\(c\.promoId[^)]*\), \.\.\.\(c\.pizzaSelection \? \{ pizzaSelection: c\.pizzaSelection \} : \{\}\)/
    );
  });

  test("mini-pizza e calzone continuam sem pizzaSelection (só a pizza normal usa o catálogo por ID)", () => {
    const addMiniPizzaSrc = fonte.slice(fonte.indexOf("function addMiniPizza("), fonte.indexOf("function addCalzone("));
    const addCalzoneSrc = fonte.slice(fonte.indexOf("function addCalzone("), fonte.indexOf("function continueBuild("));
    expect(addMiniPizzaSrc).not.toContain("pizzaSelection");
    expect(addCalzoneSrc).not.toContain("pizzaSelection");
  });
});

describe("/cardapio (PublicCardapio) — carrinho preserva pizzaSelection (Fase 3)", () => {
  test("chQty (mudar quantidade) faz spread do item inteiro por índice — nunca reconstrói o item, então pizzaSelection sobrevive", () => {
    expect(fonte).toMatch(
      /function chQty\(idx: number, d: number\) \{ setCart\(cart\.map\(\(c, i\) => \(i === idx \? \{ \.\.\.c, qty: Math\.max\(1, c\.qty \+ d\) \} : c\)\)\); \}/
    );
  });

  test("rmItem remove por índice (nunca por nome/detail) — nunca remove o item errado quando há pizzas com o mesmo sabor no carrinho", () => {
    const bloco = fonte.slice(fonte.indexOf("function rmItem(idx: number) {"), fonte.indexOf("function rmItem(idx: number) {") + 200);
    expect(bloco).toContain("cart[idx]");
  });

  test("addPizzaWithBorder nunca funde/deduplica pizzas iguais por texto — cada confirmação é uma nova entrada no carrinho, preservando pizzaSelection de cada uma", () => {
    const bloco = fonte.slice(fonte.indexOf("function addPizzaWithBorder("), fonte.indexOf("function addMiniPizza("));
    // Ao contrário de addSimple/addSucoLeite/addMacarronadaSize/addMiniPizza/addCalzone
    // (que fazem cart.find(...) para mesclar em qty+1), addPizzaWithBorder não procura
    // um item existente — sempre `[...cart, newItem]`.
    expect(bloco).not.toContain("cart.find(");
    expect(bloco).toContain("const newCart = [...cart, newItem];");
  });

  test("o draft salvo em sessionStorage serializa o carrinho inteiro (JSON.stringify de `cart`), então pizzaSelection de cada item sobrevive à restauração de sessão", () => {
    expect(fonte).toMatch(/sessionStorage\.setItem\("cf_draft", JSON\.stringify\(\{ cart, screen,/);
    // A restauração usa JSON.parse(raw) e setCart(d.cart) diretamente, sem
    // reconstruir os itens campo a campo — qualquer campo extra do item
    // (incluindo pizzaSelection) volta intacto.
    expect(fonte).toMatch(/const d = JSON\.parse\(raw\);/);
    expect(fonte).toMatch(/setCart\(d\.cart\);/);
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

describe("/cardapio — materialização do presente da Jornada do Chef na sacola", () => {
  const blocoInjecao = fonte.slice(
    fonte.indexOf("migrarReferenciaLegada(sessionStorage, localStorage)"),
    fonte.indexOf("const [size, setSize]")
  );

  test("item grátis só entra na sacola DEPOIS de a API autenticada confirmar a reserva no servidor", () => {
    expect(blocoInjecao).toContain('fetchCliente("/api/cliente/jornada-chef"');
    // setCart do presente acontece só depois do find em recompensasReservadas.
    const posConfirmacao = blocoInjecao.indexOf("recompensasReservadas");
    const posInjecao = blocoInjecao.indexOf("recompensaJornadaId: recompensaId");
    expect(posConfirmacao).toBeGreaterThan(-1);
    expect(posInjecao).toBeGreaterThan(posConfirmacao);
    // Reserva já vinculada a pedido real nunca reinjeta item.
    expect(blocoInjecao).toContain("!r.reservaPedidoId");
  });

  test("injeção é idempotente por recompensaJornadaId (vários carregamentos nunca duplicam)", () => {
    expect(blocoInjecao).toContain("atual.some((it) => it.recompensaJornadaId === recompensaId)");
  });

  test("referência persistente: lida do localStorage, nunca consumida one-shot no mount", () => {
    expect(blocoInjecao).toContain("lerReferenciaRecompensa(localStorage)");
    // A remoção imediata da era sessionStorage (causa raiz da sacola vazia)
    // não pode voltar.
    expect(blocoInjecao).not.toContain('sessionStorage.removeItem("cf_recompensa_jornada")');
    expect(blocoInjecao).toContain("migrarReferenciaLegada(sessionStorage, localStorage)");
  });

  test("servidor sem a reserva (resgatada/cancelada/expirada) limpa a referência e não injeta nada", () => {
    expect(blocoInjecao).toContain("limparReferenciaRecompensa(localStorage)");
  });

  test("remover o presente da sacola limpa a referência E cancela só a reserva (nunca perde o prêmio)", () => {
    const fnRm = fonte.match(/function rmItem\(idx: number\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(fnRm).toContain("limparReferenciaRecompensa(localStorage)");
    expect(fnRm).toContain("/api/cliente/jornada-chef/cancelar-reserva");
  });

  test("pedido enviado com o presente limpa a referência (nunca reinjeta depois do pedido)", () => {
    expect(fonte).toContain("if (itemRecompensaJornada) limparReferenciaRecompensa(localStorage)");
  });

  test("presente segue como campo dedicado no POST (recompensaJornada), nunca item comum precificado no cliente", () => {
    expect(fonte).toContain("const itemRecompensaJornada = cart.find((c) => c.recompensaJornadaId)");
    expect(fonte).toContain("recompensaJornada: { recompensaId: itemRecompensaJornada.recompensaJornadaId");
  });
});

describe("/cardapio (PublicCardapio) — acessibilidade por teclado dos cartões de opção", () => {
  const contagemOpt = (fonte.match(/className=\{?`?opt /g) || []).length + (fonte.match(/className="opt"/g) || []).length;

  test("todo cartão .opt tem tabIndex/role via optA11yAttrs — nenhum ficou só com onClick", () => {
    expect(fonte).toContain('function optA11yAttrs(disabled?: boolean) {\n  return {\n    role: "button" as const,');
    expect((fonte.match(/optA11yAttrs\(/g) || []).length).toBe(contagemOpt + 1); // +1 é a própria definição
  });

  test("Enter e Espaço ativam o cartão — nunca outra tecla, e nunca durante estado desabilitado", () => {
    expect(fonte).toContain('const isActivateKey = (e: React.KeyboardEvent) => e.key === "Enter" || e.key === " ";');
    // amostra: seletor de tamanho de pizza e sabor (com guarda de esgotado)
    expect(fonte).toContain('onKeyDown={(e) => { if (isActivateKey(e)) { e.preventDefault(); pickSize(s.code); } }}');
    expect(fonte).toContain('onKeyDown={(e) => { if (!esg && isActivateKey(e)) { e.preventDefault(); pickFlavor(f); } }}');
  });

  test("item esgotado sai do fluxo de tab (tabIndex -1) e nunca ativa por teclado", () => {
    expect(fonte).toContain("tabIndex: disabled ? -1 : 0");
  });

  test("cartões de entrega (delivery/retirada/consumo local) ganham Enter/Espaço sem duplicar a lógica de seleção", () => {
    expect(fonte).toContain('onKeyDown={(e) => { if (isActivateKey(e)) { e.preventDefault(); setDelType("delivery"); if (erroEntrega) setErroEntrega(""); } }}');
    expect(fonte).toContain('onKeyDown={(e) => { if (isActivateKey(e)) { e.preventDefault(); setDelType("retirada"); setBairroIdx(""); setErroEntrega(""); } }}');
    expect(fonte).toContain('onKeyDown={(e) => { if (isActivateKey(e)) { e.preventDefault(); setDelType("dine_in"); setBairroIdx(""); setErroEntrega(""); } }}');
  });

  test("foco visível nos cartões usa token de marca já existente — nenhuma cor nova", () => {
    expect(fonte).toContain(".opt:focus-visible{outline:2px solid var(--brand);outline-offset:2px}");
  });

  test("nenhum cartão passa onActivate por closure para uma função helper — evita falso positivo de react-hooks/refs", () => {
    expect(fonte).not.toContain("optA11yProps(");
  });
});
