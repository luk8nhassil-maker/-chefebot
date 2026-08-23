import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nextFlavorSelection, resolverPizzaSelectionIds, resolverSimpleSelectionIds, precoPizzaLocalCents, precoMinimoPorTamanho, ingredientesDoItem, itemBateBusca, catalogParaListagem, filtrarBairros } from "./page";
import { precificarPizzaPorId } from "@/lib/pricing/pizzaEngine";
import type { SelecaoSabores } from "@/lib/pizzaSabores";
import { resolverItemComSelecaoEstruturada } from "@/lib/pedidoAppSelecaoEstruturada";
import { construirSnapshotItem, type SelecaoSnapshotPizza } from "@/lib/pedidoSnapshot";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { buildSimpleCatalog } from "@/lib/catalog/simpleProducts";
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

  test("card de convite de login por WhatsApp (/cliente) foi removido da home — rota e login continuam intocados em outro lugar", () => {
    expect(fonte).not.toContain("Entre com seu WhatsApp e acompanhe suas pizzas");
    expect(blocoHome).not.toContain('<a href="/cliente"');
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
    expect(fonte).toMatch(/screen === "sc-pay" && \(\s*<div className="delivery-cta-bar">/);
  });

  test("[9] CTA da sacola: Subtotal e Ir para entrega intactos; botão Adicionar removido do dock (redundante com + Adicionar mais)", () => {
    const blocoCtaSacola = fonte.slice(
      fonte.indexOf('cartCount > 0 && screen === "sc-cart" && ('),
      fonte.indexOf('cartCount > 0 && screen === "sc-delivery" && (')
    );
    expect(blocoCtaSacola).toContain('<div className="delivery-cta-label">Subtotal</div>');
    expect(blocoCtaSacola).toContain('<div className="delivery-cta-total">{money(cartTotal)}</div>');
    expect(blocoCtaSacola).not.toContain('<button className="delivery-cta-cart" onClick={() => go("sc-start")}>Adicionar</button>');
    expect(blocoCtaSacola).toContain('onClick={() => !cartEsgotado && go("sc-delivery")}>Ir para entrega</button>');
    // "+ Adicionar mais" continua existindo na área principal da Sacola (fora do dock):
    expect(fonte).toContain('onClick={() => go("sc-start")}>+ Adicionar mais</button>');
  });

  test("[10] dock flutuante da Entrega só renderiza quando a busca de bairro não está ativa no mobile (some por completo, não só opacity)", () => {
    expect(fonte).toMatch(/cartCount > 0 && screen === "sc-delivery" && !bairroSearchActive && \(\s*<div className="delivery-cta-bar">/);
  });
});

// Busca de bairro no mobile (correção do dock cobrindo os resultados em
// produção/iPhone real). Causa raiz da versão anterior: o dock só sumia
// depois que o teclado de fato encolhia o visualViewport — animação/resize
// do Safari atrasava (ou nunca disparava) o desaparecimento, escondendo os
// resultados. A correção usa a ativação da própria busca (bairroDropdownOpen,
// aberto ao focar) como fonte de verdade, nunca detecção de teclado.
describe("/cardapio (PublicCardapio) — busca de bairro ativa esconde o dock da Entrega (bairroSearchActive)", () => {
  test("bairroSearchActive cruza mobile de toque (pointer:coarse) + busca de bairro aberta — nunca detecção de teclado/visualViewport", () => {
    expect(fonte).toContain("const bairroSearchActive = isCoarsePointer && bairroDropdownOpen;");
  });

  test("detecção de mobile usa matchMedia(pointer:coarse) — nunca largura de janela (desktop redimensionado não deve contar)", () => {
    expect(fonte).toContain('window.matchMedia("(pointer: coarse)").matches');
    expect(fonte).not.toMatch(/isCoarsePointer[\s\S]{0,80}innerWidth/);
  });

  test("dock da Entrega renderiza (ou não) só com base em bairroSearchActive — nunca mais mobileKeyboardActive/visualViewport como fonte de verdade pra escondê-lo", () => {
    expect(fonte).not.toContain("mobileKeyboardActive");
    expect(fonte).not.toContain("enderecoCampoFocado");
    expect(fonte).not.toContain("viewportEncolhida");
  });

  test("visualViewport, quando disponível, só alimenta a altura visível (viewportAlturaVisivel) — nunca decide se o dock aparece", () => {
    expect(fonte).toMatch(/if \(typeof window === "undefined" \|\| !window\.visualViewport\) return;/);
    expect(fonte).toContain("const onVVResize = () => setViewportAlturaVisivel(vv.height);");
  });

  test("focar 'Buscar bairro' abre a lista (fonte de bairroSearchActive) e sobe o campo pro topo útil (scrollIntoView)", () => {
    expect(fonte).toContain("function handleBairroFocus() {");
    expect(fonte).toContain("setBairroDropdownOpen(true);");
    expect(fonte).toContain('bairroInputRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });');
    expect(fonte).toContain("onFocus={handleBairroFocus}");
  });

  test("selecionar um bairro fecha a busca (setBairroDropdownOpen(false)) — bairroSearchActive volta a false e o dock reaparece", () => {
    expect(fonte).toMatch(/setBairroIdx\(String\(b\.i\)\); setBairroQuery\(""\); setBairroDropdownOpen\(false\);/);
  });

  test("blur seguro: perder foco pra fora do combo fecha a busca, mas o mousedown da opção previne o blur antes do clique ser registrado (sem onBlur cru fechando tudo)", () => {
    expect(fonte).toContain('onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setBairroDropdownOpen(false); }}');
    expect(fonte).toMatch(/onMouseDown=\{\(e\) => \{ e\.preventDefault\(\); setBairroIdx/);
  });

  test("buscador de bairro fica sticky (não fixed/100vh) assim que a busca está ativa no mobile — não espera o teclado abrir", () => {
    expect(fonte).toContain('`combo has-icon ${bairroSearchActive ? "combo-sticky" : ""}`');
    expect(fonte).not.toMatch(/\.combo-sticky\{[^}]*position:fixed/);
    expect(fonte).not.toMatch(/\.combo-sticky\{[^}]*100vh/);
  });

  test("offset do buscador sticky usa a altura REAL do stepper medida via ResizeObserver (--steps-h) + respiro — nunca top:8px cego que ficava atrás do stepper fixo", () => {
    expect(fonte).toContain("const [stepsHeight, setStepsHeight] = useState(46);");
    expect(fonte).toContain("new ResizeObserver(medir);");
    expect(fonte).toContain(".combo-sticky{position:sticky;top:calc(var(--steps-h, 46px) + 10px);");
  });

  test("lista de resultados nunca fica escondida pelo teclado: altura máxima calculada pela viewport visível real, descontando o stepper, quando a busca está ativa", () => {
    expect(fonte).toContain("maxHeight: Math.max(160, viewportAlturaVisivel - stepsHeight - 140)");
  });

  test("dock da Sacola e do Pagamento não são afetados pela busca de bairro — regra é exclusiva da tela de Entrega", () => {
    expect(fonte).not.toMatch(/screen === "sc-cart" && !bairroSearchActive/);
    expect(fonte).not.toMatch(/screen === "sc-pay" && !bairroSearchActive/);
  });

  test("dock flutuante da Entrega some por completo (deixa de renderizar) enquanto bairroSearchActive — nunca só opacity", () => {
    expect(fonte).toMatch(/cartCount > 0 && screen === "sc-delivery" && !bairroSearchActive && \(\s*<div className="delivery-cta-bar">/);
  });
});

// Divisória sutil entre os bairros da lista (objetivo 9): 10% de respiro em
// cada lado, nunca 100% da largura; nunca depois do último item.
describe("/cardapio (PublicCardapio) — divisória entre bairros da busca (combo-opt)", () => {
  test("pseudo-elemento :not(:last-child)::after com 10% de respiro em cada lado — sem markup extra, sem linha após o último item nem com resultado único", () => {
    expect(fonte).toContain(".combo-opt:not(:last-child)::after{content:\"\";position:absolute;left:10%;right:10%;bottom:0;height:1px;background:var(--line-strong);opacity:.7}");
  });

  test(".combo-opt é position:relative (ancora o pseudo-elemento da divisória) sem alterar o clique/seleção da opção", () => {
    expect(fonte).toContain(".combo-opt{position:relative;padding:13px 14px;");
  });
});

// Refino visual (ajuste fino de UI, CSS puro): buscador branco em primeiro
// plano vs. área de resultados em cinza muito leve (token neutro existente,
// --surface2 — nunca hex novo), e divisor alinhado exatamente ao inset do
// texto/valor (nunca width/porcentagem fixa) — escopado só ao dropdown de
// bairro via classes extras, sem tocar no dropdown de rua nem em lógica.
describe("/cardapio (PublicCardapio) — contraste buscador x resultados e grid do divisor (bairro)", () => {
  test("dropdown de bairro tem classe extra combo-dropdown-bairro e cada opção tem combo-opt-bairro (rua não é afetada)", () => {
    expect(fonte).toContain('className="combo-dropdown combo-dropdown-bairro"');
    expect(fonte).toContain('className="combo-opt combo-opt-bairro"');
    expect(fonte).toContain('<div className="combo-dropdown" id="rua-combo-list"');
    expect(fonte).toContain('<div key={r} className="combo-opt" role="option" aria-selected={r === rua}');
  });

  test("fundo da lista de bairros usa token neutro do design system (--surface2), nunca hex novo", () => {
    expect(fonte).toContain(".combo-dropdown-bairro{background:var(--surface2)}");
  });

  test("buscador continua branco (var(--surface)) — não escurecido pelo refino", () => {
    expect(fonte).toContain(".combo-sticky{position:sticky;top:calc(var(--steps-h, 46px) + 10px);z-index:22;background:var(--surface);border-radius:12px}");
    expect(fonte).toContain(".combo .flavor-search-input{padding:12px 14px;border-radius:12px;border:1px solid var(--line-strong);background:var(--surface);font-size:15px}");
  });

  test("padding horizontal do item de bairro e inset do divisor compartilham a MESMA variável (--bairro-x) — nunca width/porcentagem fixa", () => {
    expect(fonte).toContain(".combo-opt-bairro{--bairro-x:22px;padding-inline:var(--bairro-x);padding-block:14px}");
    expect(fonte).toContain(".combo-opt-bairro:not(:last-child)::after{left:var(--bairro-x);right:var(--bairro-x);opacity:1}");
    expect(fonte).not.toMatch(/\.combo-opt-bairro[^}]*width:\s*80%/);
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

  test("pizza normal: com 2 sabores escolhidos, o 3º é RECUSADO e a seleção fica intacta (nunca substitui em silêncio)", () => {
    const sel = nextFlavorSelection({ f1: "Calabresa", f2: "Portuguesa" }, "Baiana", false);
    expect(sel).toEqual({ f1: "Calabresa", f2: "Portuguesa" });
    expect([sel.f1, sel.f2]).not.toContain("Baiana");
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

describe("REGRESSÃO — pizza de 2 sabores de ponta a ponta (montagem → carrinho → payload → pedido), inclusive entre categorias diferentes", () => {
  const catalog = buildPizzaCatalog(MENU);
  const nomePorCategoria = (categoria: "tradicional" | "especial" | "doce", sizeCode: string) =>
    catalog.flavors.filter((f) => f.available && f.category === categoria && f.pricesBySizeCode[sizeCode as "P" | "M" | "G" | "F" | "MINI"] !== undefined).map((f) => f.name);
  const tradicionais = nomePorCategoria("tradicional", "G");
  const especiais = nomePorCategoria("especial", "G");
  const idPorNome = (nome: string) => catalog.flavors.find((f) => f.name === nome)!.id;
  const sizeIdG = catalog.sizes.find((s) => s.code === "G")!.id;

  test("Caso A — 1 sabor só continua válido do início ao fim (não passou a exigir 2)", () => {
    const sel = nextFlavorSelection({ f1: null, f2: null }, tradicionais[0], false);
    expect(sel).toEqual({ f1: tradicionais[0], f2: null });
    const selecao = resolverPizzaSelectionIds(catalog, "G", sel.f1!, sel.f2, null);
    expect(selecao!.flavorIds).toEqual([idPorNome(tradicionais[0])]);
    const pedido = resolverItemComSelecaoEstruturada({ kind: "pizza", name: "", detail: "", price: 0, qty: 1, pizzaSelection: selecao }, catalog);
    expect(pedido.ok).toBe(true);
    if (pedido.ok) expect(pedido.item.name).toBe("Pizza G");
  });

  test("Caso B — o 2º sabor é somado ao 1º (nunca substitui), inclusive vindo de outra aba de categoria", () => {
    // 1º clique na aba Tradicionais.
    let sel = nextFlavorSelection({ f1: null, f2: null }, tradicionais[0], false);
    // Cliente troca para a aba Especiais: a aba é só filtro de exibição, o
    // estado da montagem NÃO é tocado (era exatamente aqui que o 1º sabor
    // sumia — causa raiz do bug). Trocar de aba não chama nada além de
    // setPizzaCategoryFilter, então a seleção segue intacta.
    expect(sel).toEqual({ f1: tradicionais[0], f2: null });
    // 2º clique, agora num Especial.
    sel = nextFlavorSelection(sel, especiais[0], false);
    expect(sel).toEqual({ f1: tradicionais[0], f2: especiais[0] });
  });

  test("Caso C — com 2 sabores escolhidos, o 3º é recusado SEM trocar nenhum dos dois (e o preço não muda)", () => {
    const antes = { f1: tradicionais[0], f2: especiais[0] };
    const precoAntes = precoPizzaLocalCents(catalog, "G", antes.f1, antes.f2, null);
    const sel = nextFlavorSelection(antes, tradicionais[1], false);
    // Identidade exata: [A, B] continua [A, B] — não basta ter 2 sabores,
    // porque [A, C] também teria 2.
    expect(sel).toEqual({ f1: tradicionais[0], f2: especiais[0] });
    expect([sel.f1, sel.f2]).not.toContain(tradicionais[1]);
    // O toque recusado não pode mexer no preço nem na resolução para IDs.
    expect(precoPizzaLocalCents(catalog, "G", sel.f1!, sel.f2, null)).toBe(precoAntes);
    expect(resolverPizzaSelectionIds(catalog, "G", sel.f1!, sel.f2, null)!.flavorIds).toEqual([idPorNome(tradicionais[0]), idPorNome(especiais[0])]);
    // E o motor de preço recusa 3 sabores mesmo se um payload adulterado tentar.
    const tres = precificarPizzaPorId(
      { sizeId: sizeIdG, flavorIds: [idPorNome(tradicionais[0]), idPorNome(tradicionais[1]), idPorNome(especiais[0])], quantity: 1 },
      catalog
    );
    expect(tres.ok).toBe(false);
  });

  test("Caso C2 — trocar o 2º sabor pelo caminho oficial (desmarca B, escolhe C) atualiza sabores e preço", () => {
    let sel: SelecaoSabores = { f1: tradicionais[0], f2: especiais[0] };
    const precoComEspecial = precoPizzaLocalCents(catalog, "G", sel.f1!, sel.f2, null)!;
    sel = nextFlavorSelection(sel, especiais[0], false);
    expect(sel).toEqual({ f1: tradicionais[0], f2: null });
    sel = nextFlavorSelection(sel, tradicionais[1], false);
    expect(sel).toEqual({ f1: tradicionais[0], f2: tradicionais[1] });
    const precoSoTradicionais = precoPizzaLocalCents(catalog, "G", sel.f1!, sel.f2, null)!;
    expect(precoSoTradicionais).toBe(Math.max(
      catalog.flavors.find((f) => f.name === tradicionais[0])!.pricesBySizeCode.G!,
      catalog.flavors.find((f) => f.name === tradicionais[1])!.pricesBySizeCode.G!,
    ));
    // Mistura de categorias: 50% do preço real da Tradicional + 50% da Especial.
    const precoTrad = catalog.flavors.find((f) => f.name === tradicionais[0])!.pricesBySizeCode.G!;
    const precoEsp = catalog.flavors.find((f) => f.name === especiais[0])!.pricesBySizeCode.G!;
    expect(precoComEspecial).toBe(Math.round((precoTrad + precoEsp) / 2));
  });

  test("Caso C3 — o 3º sabor recusado também não muda nada quando a seleção veio de abas diferentes", () => {
    // A na aba Tradicionais, B na aba Especiais (a correção anterior), e o
    // 3º toque vindo de uma terceira aba não pode desfazer o meio a meio.
    let sel: SelecaoSabores = nextFlavorSelection({ f1: null, f2: null }, tradicionais[0], false);
    sel = nextFlavorSelection(sel, especiais[0], false);
    const doces = nomePorCategoria("doce", "G");
    const depois = nextFlavorSelection(sel, doces[0], false);
    expect(depois).toEqual({ f1: tradicionais[0], f2: especiais[0] });
    // Os dois continuam visíveis para o cliente mesmo com a aba Doces
    // aberta: os chips são montados de [f1, f2], não da aba (ver abaixo).
    expect([depois.f1, depois.f2].filter(Boolean)).toEqual([tradicionais[0], especiais[0]]);
  });

  test("Caso D — desmarcar um dos dois mantém o outro selecionado", () => {
    const semOSegundo = nextFlavorSelection({ f1: tradicionais[0], f2: especiais[0] }, especiais[0], false);
    expect(semOSegundo).toEqual({ f1: tradicionais[0], f2: null });
    const semOPrimeiro = nextFlavorSelection({ f1: tradicionais[0], f2: especiais[0] }, tradicionais[0], false);
    expect(semOPrimeiro).toEqual({ f1: especiais[0], f2: null });
  });

  test("Caso E — os dois sabores chegam ao item do carrinho (nome, detalhe e pizzaSelection)", () => {
    const f1 = tradicionais[0];
    const f2 = especiais[0];
    const selecao = resolverPizzaSelectionIds(catalog, "G", f1, f2, null);
    expect(selecao!.flavorIds).toEqual([idPorNome(f1), idPorNome(f2)]);
    // Mesmos campos que finalizarPizza monta para o CartItem.
    expect(`Pizza G${f2 ? " (meio a meio)" : ""}`).toBe("Pizza G (meio a meio)");
    expect(`${f1} / ${f2}`).toContain(f2);
  });

  test("Caso F — a pizza de 2 sabores é reconstruída com os dois sabores a partir do que foi persistido", () => {
    const selecao = resolverPizzaSelectionIds(catalog, "G", tradicionais[0], especiais[0], null)!;
    const snapshot = construirSnapshotItem({ kind: "pizza", nome: "Pizza G (meio a meio)", detalhe: `${tradicionais[0]} / ${especiais[0]}`, quantidade: 1, precoUnitarioReais: 0, selecao });
    const selecaoPersistida = snapshot.selecao as SelecaoSnapshotPizza;
    expect(selecaoPersistida.flavorIds).toEqual([idPorNome(tradicionais[0]), idPorNome(especiais[0])]);
    const refeito = resolverItemComSelecaoEstruturada({ kind: "pizza", name: "", detail: "", price: 0, qty: 1, pizzaSelection: selecaoPersistida }, catalog);
    expect(refeito.ok).toBe(true);
    if (refeito.ok) expect(refeito.item.detail).toBe(`${tradicionais[0]} / ${especiais[0]}`);
  });

  test("Caso G — o servidor mantém os dois sabores ao criar o pedido (nome '(meio a meio)' e os dois no detalhe)", () => {
    const selecao = resolverPizzaSelectionIds(catalog, "G", tradicionais[0], especiais[0], null);
    const pedido = resolverItemComSelecaoEstruturada({ kind: "pizza", name: "", detail: "", price: 0, qty: 1, pizzaSelection: selecao }, catalog);
    expect(pedido.ok).toBe(true);
    if (pedido.ok) {
      expect(pedido.item.name).toBe("Pizza G (meio a meio)");
      expect(pedido.item.detail).toBe(`${tradicionais[0]} / ${especiais[0]}`);
    }
  });

  test("Caso H — Tradicional + Especial cobra metade real de cada categoria, e a prévia bate com o servidor", () => {
    const f1 = tradicionais[0];
    const f2 = especiais[0];
    const preco1 = catalog.flavors.find((f) => f.name === f1)!.pricesBySizeCode.G!;
    const preco2 = catalog.flavors.find((f) => f.name === f2)!.pricesBySizeCode.G!;
    const esperado = Math.round((preco1 + preco2) / 2);
    expect(precoPizzaLocalCents(catalog, "G", f1, f2, null)).toBe(esperado);
    const servidor = precificarPizzaPorId({ sizeId: sizeIdG, flavorIds: [idPorNome(f1), idPorNome(f2)], quantity: 1 }, catalog);
    expect(servidor.ok).toBe(true);
    if (servidor.ok) expect(servidor.unitPriceCents).toBe(esperado);
    // Tradicional + Tradicional e Especial + Especial seguem a mesma regra.
    for (const [a, b] of [[tradicionais[0], tradicionais[1]], [especiais[0], especiais[1]]] as const) {
      const maior = Math.max(catalog.flavors.find((f) => f.name === a)!.pricesBySizeCode.G!, catalog.flavors.find((f) => f.name === b)!.pricesBySizeCode.G!);
      expect(precoPizzaLocalCents(catalog, "G", a, b, null)).toBe(maior);
    }
  });

  test("Caso I — pizza de 1 sabor tem o preço do próprio sabor (sem regressão de preço)", () => {
    const preco = catalog.flavors.find((f) => f.name === tradicionais[0])!.pricesBySizeCode.G!;
    expect(precoPizzaLocalCents(catalog, "G", tradicionais[0], null, null)).toBe(preco);
  });

  test("MINI continua travada em 1 sabor (a correção não afrouxou o limite por tamanho)", () => {
    const sel = nextFlavorSelection({ f1: "Calabresa", f2: null }, "Portuguesa", true);
    expect(sel.f2).toBeNull();
  });
});

describe("chips de sabor escolhido — compactos e independentes da aba visível", () => {
  const fonteChips = fonte.slice(fonte.indexOf("const saboresEscolhidos ="), fonte.indexOf("// Fecha a pizza (com borda e adicionais"));

  test("os chips saem de [f1, f2], nunca da aba de categoria em exibição", () => {
    expect(fonteChips).toContain("const saboresEscolhidos = [f1, f2].filter((s): s is string => !!s);");
    expect(fonteChips).toContain("saboresEscolhidos.map((sabor) => (");
  });

  test("o chip inteiro é o botão de remover (desmarca pelo mesmo pickFlavor da lista)", () => {
    expect(fonteChips).toContain("onClick={() => pickFlavor(sabor)}");
    expect(fonteChips).toContain("aria-label={`Remover ${sabor}`}");
  });

  test("a seção 'Escolhidos' de cards grandes não existe mais (o chip diz o mesmo em uma linha)", () => {
    expect(fonte).not.toContain('title: "Escolhidos"');
    expect(fonte).not.toContain("saboresEscolhidosForaDasSecoes");
  });

  test("com 1 sabor e limite 2, o slot livre é anunciado como opcional (nunca obriga o 2º)", () => {
    expect(fonteChips).toContain("limiteSabores === 2 && saboresEscolhidos.length === 1");
    expect(fonteChips).toContain("+ 2º sabor (opcional)");
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
    const sel = resolverPizzaSelectionIds(catalog, "F", "Calabresa", null, "Catupiry Original");
    const border = catalog.borders.find((b) => b.label === "Catupiry Original")!;
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
  test("finalizarPizza monta pizzaSelection a partir do catálogo oficial (incluindo adicionais) e só o inclui no item quando resolvido", () => {
    expect(fonte).toMatch(
      /const pizzaSelection = resolverPizzaSelectionIds\(menu\.pizzaCatalog, size!, f1!, mam \? f2 : null, chosenBorder, addOnLabels\);/
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

describe("resolverSimpleSelectionIds — resolução de IDs do catálogo oficial 2026 (Fase 6)", () => {
  const catalog = buildSimpleCatalog(MENU);

  test("calzone: resolve productId + flavorId contra a lista OFICIAL e fixa de sabores do Calzone (catalog.calzone, nunca catalog.lanches)", () => {
    const sel = resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: "Calabresa" });
    const produto = catalog.calzone.find((l) => l.name === "Calzone")!;
    const sabor = produto.flavors!.find((f) => f.name === "Calabresa")!;
    expect(sel).toEqual({ productId: produto.id, flavorId: sabor.id });
  });

  test("calzone: preço vem do SABOR escolhido (produto.flavors[].priceCents), nunca fixo por produto — decisão comercial aprovada", () => {
    const carneSeca = catalog.calzone[0].flavors!.find((f) => f.name === "Carne Seca")!;
    const frango = catalog.calzone[0].flavors!.find((f) => f.name === "Frango")!;
    expect(carneSeca.priceCents).not.toBe(frango.priceCents);
  });

  test("REGRESSÃO — 'Mini-Pizza' não existe mais como produto simples (virou tamanho de pizza, decisão comercial aprovada): não resolve por nenhum produto do catálogo", () => {
    expect(resolverSimpleSelectionIds(catalog, "Mini-Pizza", { flavorName: "Calabresa" })).toBeUndefined();
  });

  test("um sabor de pizza que NÃO está na lista oficial do Calzone (ex.: 4 Queijos) nunca resolve para o Calzone, mesmo sendo um flavorId válido em outro produto", () => {
    const pizzaCatalog = buildPizzaCatalog(MENU);
    const flavorForaDoCalzone = pizzaCatalog.flavors.find((f) => !catalog.calzone[0].flavors!.some((cf) => cf.name === f.name));
    expect(flavorForaDoCalzone).toBeDefined();
    expect(resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: flavorForaDoCalzone!.name })).toBeUndefined();
  });

  test("macarronada: resolve productId + sizeId pelo código do tamanho (catalog.macarronadas, nunca catalog.lanches)", () => {
    const macarronada = catalog.macarronadas[0];
    const size = macarronada.sizes![0];
    const sel = resolverSimpleSelectionIds(catalog, macarronada.name, { sizeCode: size.code });
    expect(sel).toEqual({ productId: macarronada.id, sizeId: size.id });
  });

  test("suco: resolve productId + milk (catalog.sucos)", () => {
    const suco = catalog.sucos[0];
    const sel = resolverSimpleSelectionIds(catalog, suco.name, { milk: "com" });
    expect(sel).toEqual({ productId: suco.id, milk: "com" });
  });

  test("produto plano (sem opts): resolve só productId (catalog.bebidas)", () => {
    const bebida = catalog.bebidas[0];
    const sel = resolverSimpleSelectionIds(catalog, bebida.name, {});
    expect(sel).toEqual({ productId: bebida.id });
  });

  test("hambúrguer (categoria própria, decisão comercial aprovada): resolve só productId", () => {
    const hamburguer = catalog.hamburgueres[0];
    const sel = resolverSimpleSelectionIds(catalog, hamburguer.name, {});
    expect(sel).toEqual({ productId: hamburguer.id });
  });

  test("pastel de forno (categoria própria, decisão comercial aprovada): resolve productId + flavorId", () => {
    const pastel = catalog.pastelForno[0];
    const sabor = pastel.flavors![0];
    const sel = resolverSimpleSelectionIds(catalog, pastel.name, { flavorName: sabor.name });
    expect(sel).toEqual({ productId: pastel.id, flavorId: sabor.id });
  });

  test("vitamina (categoria própria, decisão comercial aprovada — nunca herda o acréscimo de leite do suco): resolve só productId", () => {
    const vitamina = catalog.vitaminas[0];
    const sel = resolverSimpleSelectionIds(catalog, vitamina.name, {});
    expect(sel).toEqual({ productId: vitamina.id });
  });

  test("catálogo ausente (ainda não carregado): undefined, nunca lança exceção", () => {
    expect(resolverSimpleSelectionIds(undefined, "Calzone", { flavorName: "Calabresa" })).toBeUndefined();
  });

  test("nome de produto que não existe no catálogo: undefined", () => {
    expect(resolverSimpleSelectionIds(catalog, "Produto Inventado", {})).toBeUndefined();
  });

  test("sabor que não existe no catálogo: undefined", () => {
    expect(resolverSimpleSelectionIds(catalog, "Calzone", { flavorName: "Sabor Inventado" })).toBeUndefined();
  });

  test("tamanho que não existe no catálogo para o produto: undefined", () => {
    const macarronada = catalog.macarronadas[0];
    expect(resolverSimpleSelectionIds(catalog, macarronada.name, { sizeCode: "TAMANHO-INEXISTENTE" })).toBeUndefined();
  });

  test("macarronada com addOnLabel (Bacon OU Ovos): resolve productId + sizeId + addOnId", () => {
    const macarronada = catalog.macarronadas[0];
    const size = macarronada.sizes![0];
    const opcao = macarronada.addOnGroup!.options[0];
    const sel = resolverSimpleSelectionIds(catalog, macarronada.name, { sizeCode: size.code, addOnLabel: opcao.label });
    expect(sel).toEqual({ productId: macarronada.id, sizeId: size.id, addOnId: opcao.id });
  });

  test("macarronada sem addOnLabel (Bacon/Ovos são sempre opcionais — 'Nenhum' é uma escolha válida): resolve sem addOnId", () => {
    const macarronada = catalog.macarronadas[0];
    const size = macarronada.sizes![0];
    const sel = resolverSimpleSelectionIds(catalog, macarronada.name, { sizeCode: size.code });
    expect(sel).toEqual({ productId: macarronada.id, sizeId: size.id });
    expect(sel).not.toHaveProperty("addOnId");
  });

  test("macarronada com addOnLabel inexistente: undefined (fail-closed, mesmo com tamanho válido)", () => {
    const macarronada = catalog.macarronadas[0];
    const size = macarronada.sizes![0];
    expect(resolverSimpleSelectionIds(catalog, macarronada.name, { sizeCode: size.code, addOnLabel: "Camarão" })).toBeUndefined();
  });

  test("Bacon e Ovo nunca resolvem juntos (addOnGroup.max é 1 — a UI só oferece um seletor de escolha única, nunca multi-seleção aqui)", () => {
    const macarronada = catalog.macarronadas[0];
    expect(macarronada.addOnGroup!.max).toBe(1);
    expect(macarronada.addOnGroup!.options.map((o) => o.label).sort()).toEqual(["Bacon", "Ovo"]);
  });
});

describe("precoPizzaLocalCents / precoMinimoPorTamanho — preço local para exibição (nunca autoridade de preço, o servidor sempre recalcula)", () => {
  const catalog = buildPizzaCatalog(MENU);

  test("1 sabor, sem borda/adicional: preço = pricesBySizeCode do sabor no tamanho", () => {
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa")!;
    expect(precoPizzaLocalCents(catalog, "G", "Calabresa", null, null)).toBe(calabresa.pricesBySizeCode.G);
  });

  test("meio a meio da mesma categoria: usa o MAIOR preço entre os 2 sabores e não depende da ordem", () => {
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa")!;
    const baiana = catalog.flavors.find((f) => f.name === "Baiana")!;
    const esperado = Math.max(calabresa.pricesBySizeCode.G!, baiana.pricesBySizeCode.G!);
    expect(precoPizzaLocalCents(catalog, "G", "Calabresa", "Baiana", null)).toBe(esperado);
    expect(precoPizzaLocalCents(catalog, "G", "Baiana", "Calabresa", null)).toBe(esperado);
  });

  test("soma borda e adicionais ao preço-base", () => {
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa")!;
    const border = catalog.borders.find((b) => b.label === "Catupiry Original")!;
    const addOn = catalog.addOns.find((a) => a.label === "Bacon")!;
    const esperado = calabresa.pricesBySizeCode.G! + border.pricesBySizeCode.G + addOn.pricesBySizeCode.G;
    expect(precoPizzaLocalCents(catalog, "G", "Calabresa", null, "Catupiry Original", ["Bacon"])).toBe(esperado);
  });

  test("Especial + MINI nunca resolve preço (nenhum sabor Especial tem chave MINI) — undefined, nunca 0 nem um preço de outro tamanho", () => {
    const especial = catalog.flavors.find((f) => f.category === "especial")!;
    expect(especial.pricesBySizeCode.MINI).toBeUndefined();
    expect(precoPizzaLocalCents(catalog, "MINI", especial.name, null, null)).toBeUndefined();
  });

  test("catálogo ausente: undefined, nunca lança exceção", () => {
    expect(precoPizzaLocalCents(undefined, "G", "Calabresa", null, null)).toBeUndefined();
  });

  test("sabor/borda/adicional inexistentes: undefined (fail-closed, nunca um preço parcial)", () => {
    expect(precoPizzaLocalCents(catalog, "G", "Sabor Inventado", null, null)).toBeUndefined();
    expect(precoPizzaLocalCents(catalog, "G", "Calabresa", null, "Borda Inventada")).toBeUndefined();
    expect(precoPizzaLocalCents(catalog, "G", "Calabresa", null, null, ["Adicional Inventado"])).toBeUndefined();
  });

  test("precoMinimoPorTamanho: o menor preço entre os sabores DISPONÍVEIS naquele tamanho — usado pra exibir 'A partir de' antes do sabor ser escolhido", () => {
    const min = precoMinimoPorTamanho(catalog, "G");
    const menor = Math.min(...catalog.flavors.filter((f) => f.available && f.pricesBySizeCode.G !== undefined).map((f) => f.pricesBySizeCode.G!));
    expect(min).toBe(menor);
  });

  test("precoMinimoPorTamanho: sabor esgotado nunca entra no cálculo do mínimo", () => {
    const nomesComMini = catalog.flavors.filter((f) => f.pricesBySizeCode.MINI !== undefined).map((f) => f.name);
    const catalogTodoMiniEsgotado = buildPizzaCatalog(MENU, nomesComMini);
    expect(precoMinimoPorTamanho(catalogTodoMiniEsgotado, "MINI")).toBeUndefined();
  });

  test("catálogo ausente: undefined", () => {
    expect(precoMinimoPorTamanho(undefined, "G")).toBeUndefined();
  });
});

describe("resolverPizzaSelectionIds — adicionais (extensão da Fase 2C, cardápio oficial 2026)", () => {
  const catalog = buildPizzaCatalog(MENU);

  test("com 1 adicional: inclui addOnIds resolvido pelo label", () => {
    const sel = resolverPizzaSelectionIds(catalog, "G", "Calabresa", null, null, ["Bacon"]);
    const addOn = catalog.addOns.find((a) => a.label === "Bacon")!;
    expect(sel?.addOnIds).toEqual([addOn.id]);
  });

  test("sem adicionais: nunca inclui a chave addOnIds no resultado", () => {
    const sel = resolverPizzaSelectionIds(catalog, "G", "Calabresa", null, null);
    expect(sel).not.toHaveProperty("addOnIds");
  });

  test("adicional que não existe no catálogo: undefined (fail-closed, mesmo com sabor/tamanho válidos)", () => {
    expect(resolverPizzaSelectionIds(catalog, "G", "Calabresa", null, null, ["Adicional Inventado"])).toBeUndefined();
  });

  test("múltiplos adicionais válidos: resolve todos os IDs, na mesma ordem escolhida", () => {
    const sel = resolverPizzaSelectionIds(catalog, "G", "Calabresa", null, null, ["Bacon", "Calabresa"]);
    const bacon = catalog.addOns.find((a) => a.label === "Bacon")!;
    const calabresaAddOn = catalog.addOns.find((a) => a.label === "Calabresa")!;
    expect(sel?.addOnIds).toEqual([bacon.id, calabresaAddOn.id]);
  });
});

describe("/cardapio (PublicCardapio) — MINI como tamanho real de pizza (cardápio oficial 2026)", () => {
  test("isMiniSize distingue o novo fluxo (tamanho MINI real) do produto legado 'Mini-pizza' (miniPizzaMode)", () => {
    expect(fonte).toContain('const isMiniSize = size === "MINI" && !miniPizzaMode;');
  });

  test("pickSize: com o catálogo oficial presente, a fonte de tamanhos é sempre menu.pizzaCatalog.sizes (inclui MINI); trocar de tamanho zera sabor/borda/adicionais", () => {
    const bloco = fonte.slice(fonte.indexOf("function pickSize(code: string) {"), fonte.indexOf("function pickMiniPizza("));
    expect(bloco).toContain("menu.pizzaCatalog.sizes.find((x) => x.code === code)");
    expect(bloco).toContain("setF1(null); setF2(null); setBorder(null); setBorderPrice(0); setAddOnIds([]);");
  });

  test("continueBuild: MINI finaliza direto (sem borda nem adicionais), nunca passa pela tela sc-border", () => {
    expect(fonte).toContain("else if (isMiniSize) finalizarPizza(null, 0, []);");
  });

  test("buildActionLabel/mensagem do modal tratam MINI como 1 sabor só, sem promessa de meio a meio", () => {
    expect(fonte).toContain('const buildActionLabel = miniPizzaMode ? "Adicionar mini-pizza" : calzoneMode ? "Adicionar calzone" : pastelMode ? "Adicionar" : isMiniSize ? "Adicionar mini" : "Confirmar pizza";');
    // Uma linha só de instrução (a segunda, redundante, foi removida) e a
    // MINI nunca é convidada ao meio a meio.
    expect(fonte).toContain('? "Escolha 1 sabor — a Mini não é meio a meio."');
    expect(fonte).toContain(': "Escolha 1 ou 2 sabores — pode misturar categorias.";');
    expect(fonte).not.toContain("flavorModalHint");
  });

  test("grade de tamanho: com o catálogo presente, mostra 'A partir de' via precoMinimoPorTamanho — nunca o preço fixo antigo por tamanho", () => {
    const bloco = fonte.slice(fonte.indexOf('<div className="grid2 size-grid">'), fonte.indexOf("{miniPizzaItem && !miniPizzaIndisponivel && ("));
    expect(bloco).toContain("menu.pizzaCatalog.sizes.map((s) => {");
    expect(bloco).toContain("precoMinimoPorTamanho(menu.pizzaCatalog, s.code)");
    expect(bloco).toContain("`A partir de ${money(precoMinCents / 100)}`");
  });
});

describe("/cardapio (PublicCardapio) — Especial: identidade visual discreta lilás/roxa (cardápio oficial 2026)", () => {
  test("a seção 'Especiais' ganha uma classe própria discreta, nunca a cor de marca (amarelo/dourado) usada pelo resto do cardápio", () => {
    expect(fonte).toContain('const especial = section.title === "Especiais";');
    expect(fonte).toContain('className={`section-label ${especial ? "section-label-especial" : ""}`}');
    expect(fonte).toContain('flavor-opt-especial');
  });

  test("o CSS do lilás/roxa é discreto (contorno sutil, sem preencher o cartão inteiro) e nunca reaproveita --brand/--gold", () => {
    expect(fonte).toContain(".section-label-especial{color:#a78bfa}");
    expect(fonte).toContain(".flavor-opt-especial{border-left:3px solid color-mix(in srgb, #a78bfa 55%, transparent)}");
  });
});

describe("/cardapio (PublicCardapio) — tela de borda usa o catálogo oficial (preço real por tamanho)", () => {
  test("sc-border: com o catálogo presente, lista menu.pizzaCatalog.borders com preço real do tamanho atual, nunca priceSmall/priceLarge fixos", () => {
    const bloco = fonte.slice(fonte.indexOf('{screen === "sc-border" && ('), fonte.indexOf('{screen === "sc-addons" && ('));
    expect(bloco).toContain("menu.pizzaCatalog.borders.map((b) => {");
    expect(bloco).toContain('b.pricesBySizeCode[size as "P" | "M" | "G" | "F"]');
    expect(bloco).toContain("chooseBorder(b.label, precoReais)");
  });

  test("'Sem borda' e as demais opções chamam chooseBorder (nunca mais addPizzaWithBorder direto) — decide entre ir pra sc-addons ou finalizar", () => {
    const bloco = fonte.slice(fonte.indexOf('{screen === "sc-border" && ('), fonte.indexOf('{screen === "sc-addons" && ('));
    expect(bloco).toContain("chooseBorder(null, 0)");
    expect(bloco).not.toContain("addPizzaWithBorder(");
  });

  test("chooseBorder só abre sc-addons quando há algum adicional disponível no catálogo; senão finaliza direto (nenhuma etapa vazia)", () => {
    const bloco = fonte.slice(fonte.indexOf("function chooseBorder("), fonte.indexOf("function toggleAddOn("));
    expect(bloco).toContain("menu.pizzaCatalog.addOns.some((a) => a.available)");
    expect(bloco).toContain('go("sc-addons")');
    expect(bloco).toContain("finalizarPizza(chosenBorder, chosenBorderPrice, [])");
  });
});

describe("/cardapio (PublicCardapio) — nova etapa de adicionais de pizza (sc-addons, cardápio oficial 2026)", () => {
  test("toggleAddOn nunca duplica o mesmo ID (lista de IDs únicos por construção)", () => {
    const bloco = fonte.slice(fonte.indexOf("function toggleAddOn("), fonte.indexOf("function addMiniPizza("));
    expect(bloco).toContain("prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]");
  });

  test("sc-addons lista menu.pizzaCatalog.addOns com preço real do tamanho atual e finaliza chamando finalizarPizza com border/borderPrice/addOnIds já escolhidos", () => {
    const bloco = fonte.slice(fonte.indexOf('{screen === "sc-addons" && ('), fonte.indexOf('{screen === "sc-promo" && promoSel && ('));
    expect(bloco).toContain("(menu.pizzaCatalog?.addOns || []).map((a) => {");
    expect(bloco).toContain('a.pricesBySizeCode[size as "P" | "M" | "G" | "F"]');
    expect(bloco).toContain("toggleAddOn(a.id)");
    expect(bloco).toContain("finalizarPizza(border, borderPrice, addOnIds)");
  });

  test("sc-addons e sc-macarronada-addon estão nas listas de navegação (safeCartReturnScreens/stepMap) — nunca telas órfãs pro botão voltar/carrinho", () => {
    expect(fonte).toContain('const safeCartReturnScreens = ["sc-start", "sc-build", "sc-border", "sc-addons", "sc-list", "sc-novidades", "sc-suco-leite", "sc-macarronada-size", "sc-macarronada-addon", "sc-another", "sc-delivery", "sc-pay", "sc-promo"];');
    expect(fonte).toContain('"sc-addons": 0');
    expect(fonte).toContain('"sc-macarronada-addon": 0');
  });
});

describe("/cardapio (PublicCardapio) — Macarronada: Bacon OU Ovos, nunca os dois (etapa opcional sc-macarronada-addon)", () => {
  test("sc-macarronada-addon oferece 'Nenhum' + as opções do addOnGroup, cada uma chamando finalizarMacarronada com um addOnLabel diferente (escolha única, nunca soma)", () => {
    const bloco = fonte.slice(fonte.indexOf('{screen === "sc-macarronada-addon" && '), fonte.indexOf('{screen === "sc-cart" && ('));
    expect(bloco).toContain("finalizarMacarronada(macarronadaSizeEscolhido, undefined)");
    expect(bloco).toContain("(macarronadaPendente.addOnGroup?.options || []).map((o) => {");
    expect(bloco).toContain("finalizarMacarronada(macarronadaSizeEscolhido, o.label)");
  });

  test("finalizarMacarronada soma o preço da opção (Bacon/Ovos) ao preço do tamanho, nunca cobra os dois ao mesmo tempo (addOnGroup.max é 1)", () => {
    const bloco = fonte.slice(fonte.indexOf("function finalizarMacarronada("), fonte.indexOf("const cartTotal ="));
    expect(bloco).toContain("const price = sizeOption.price + (addOnOption?.price || 0);");
  });
});

describe("/cardapio (PublicCardapio) — wiring de simpleSelection (Fase 6)", () => {
  test("addCalzone monta simpleSelection a partir do catálogo oficial e só o inclui no item quando resolvido", () => {
    const bloco = fonte.slice(fonte.indexOf("function addCalzone() {"), fonte.indexOf("function continueBuild("));
    expect(bloco).toContain("const simpleSelection = resolverSimpleSelectionIds(menu.catalog, calzoneItem.name, { flavorName: f1 });");
    expect(bloco).toContain("...(simpleSelection ? { simpleSelection } : {})");
  });

  test("REGRESSÃO (auditoria independente pós-6ª rodada) — addCalzone é fail-closed: com menu.catalog presente, uma seleção que não resolve NUNCA cai pro legado", () => {
    const bloco = fonte.slice(fonte.indexOf("function addCalzone() {"), fonte.indexOf("function continueBuild("));
    expect(bloco).toContain("if (!simpleSelection && menu.catalog) {");
    expect(bloco).toMatch(/if \(!simpleSelection && menu\.catalog\) \{\s*showToast\([^)]*\);\s*return;\s*\}/);
  });

  test("addMiniPizza monta simpleSelection a partir do catálogo oficial e só o inclui no item quando resolvido", () => {
    const bloco = fonte.slice(fonte.indexOf("function addMiniPizza() {"), fonte.indexOf("function addCalzone("));
    expect(bloco).toContain("const simpleSelection = resolverSimpleSelectionIds(menu.catalog, miniPizzaItem.name, { flavorName: f1 });");
    expect(bloco).toContain("...(simpleSelection ? { simpleSelection } : {})");
  });

  test("REGRESSÃO — addMiniPizza é fail-closed: com menu.catalog presente, uma seleção que não resolve NUNCA cai pro legado", () => {
    const bloco = fonte.slice(fonte.indexOf("function addMiniPizza() {"), fonte.indexOf("function addCalzone("));
    expect(bloco).toContain("if (!simpleSelection && menu.catalog) {");
  });

  test("finalizarMacarronada monta simpleSelection a partir do catálogo oficial (incluindo o addOnLabel opcional de Bacon/Ovos)", () => {
    const bloco = fonte.slice(fonte.indexOf("function finalizarMacarronada("), fonte.indexOf("const cartTotal ="));
    expect(bloco).toContain("const simpleSelection = resolverSimpleSelectionIds(menu.catalog, macarronadaPendente.name, { sizeCode: sizeOption.code, ...(addOnLabel !== undefined ? { addOnLabel } : {}) });");
    expect(bloco).toContain("...(simpleSelection ? { simpleSelection } : {})");
  });

  test("REGRESSÃO — finalizarMacarronada é fail-closed: com menu.catalog presente, uma seleção que não resolve NUNCA cai pro legado", () => {
    const bloco = fonte.slice(fonte.indexOf("function finalizarMacarronada("), fonte.indexOf("const cartTotal ="));
    expect(bloco).toContain("if (!simpleSelection && menu.catalog) {");
  });

  test("addMacarronadaSize decide entre a etapa opcional de Bacon/Ovos e finalizar direto, nunca finaliza sem checar o addOnGroup", () => {
    const bloco = fonte.slice(fonte.indexOf("function addMacarronadaSize("), fonte.indexOf("function finalizarMacarronada("));
    expect(bloco).toContain("const temOpcaoDisponivel = !!macarronadaPendente.addOnGroup?.options.some((o) => o.available);");
    expect(bloco).toContain('go("sc-macarronada-addon");');
    expect(bloco).toContain("finalizarMacarronada(sizeOption, undefined);");
  });

  test("addSucoLeite monta simpleSelection a partir do catálogo oficial", () => {
    const bloco = fonte.slice(fonte.indexOf("function addSucoLeite("), fonte.indexOf("function addMacarronadaSize("));
    expect(bloco).toContain('const simpleSelection = resolverSimpleSelectionIds(menu.catalog, sucoPendente.name, { milk: comLeite ? "com" : "sem" });');
    expect(bloco).toContain("...(simpleSelection ? { simpleSelection } : {})");
  });

  test("REGRESSÃO — addSucoLeite é fail-closed: com menu.catalog presente, uma seleção que não resolve NUNCA cai pro legado", () => {
    const bloco = fonte.slice(fonte.indexOf("function addSucoLeite("), fonte.indexOf("function addMacarronadaSize("));
    expect(bloco).toContain("if (!simpleSelection && menu.catalog) {");
  });

  test("payload de POST /api/pedido-app envia simpleSelection quando o item do carrinho tem (sem substituir name/detail/price)", () => {
    expect(fonte).toMatch(
      /\.\.\.\(c\.pizzaSelection \? \{ pizzaSelection: c\.pizzaSelection \} : \{\}\), \.\.\.\(c\.simpleSelection \? \{ simpleSelection: c\.simpleSelection \} : \{\}\)/
    );
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

  test("finalizarPizza nunca funde/deduplica pizzas iguais por texto — cada confirmação é uma nova entrada no carrinho, preservando pizzaSelection de cada uma", () => {
    const bloco = fonte.slice(fonte.indexOf("function finalizarPizza("), fonte.indexOf("function chooseBorder("));
    // Ao contrário de addSimple/addSucoLeite/finalizarMacarronada/addMiniPizza/addCalzone
    // (que fazem cart.find(...) para mesclar em qty+1), finalizarPizza não procura
    // um item existente — sempre `[...cart, newItem]`.
    expect(bloco).not.toContain("cart.find(");
    expect(bloco).toContain("const newCart = [...cart, newItem];");
  });

  test("finalizarPizza monta o detail da sacola com sabor(es) + borda + adicionais, cada parte opcional (nenhuma informação importante fica só implícita)", () => {
    const bloco = fonte.slice(fonte.indexOf("function finalizarPizza("), fonte.indexOf("function chooseBorder("));
    expect(bloco).toContain(
      'const detail = `${flavor}${chosenBorder ? ` · borda ${chosenBorder}` : ""}${addOnLabels.length > 0 ? ` · adicional ${addOnLabels.join(", ")}` : ""}`;'
    );
  });

  test("a sacola (sc-cart) renderiza it.detail de todo item — sabor/borda/adicionais da pizza aparecem ali, nunca dependem de um campo separado", () => {
    expect(fonte).toContain("{it.detail && <div className=\"ci-detail\">{it.detail}</div>}");
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
    const bloco = fonte.slice(fonte.indexOf("function addSimple("), fonte.indexOf("function addSimple(") + 500);
    expect(bloco).toContain("if (it.available === false) return;");
    expect(bloco).toContain("if (isCalzoneName(it.name)) { pickCalzone(); return; }");
  });

  test("pickCalzone abre o mesmo modal de sabores (flavorModalOpen) e zera qualquer sabor anterior", () => {
    expect(fonte).toContain("function pickCalzone() {");
    const bloco = fonte.slice(fonte.indexOf("function pickCalzone() {"), fonte.indexOf("function pickCalzone() {") + 400);
    expect(bloco).toContain("setCalzoneMode(true)");
    expect(bloco).toContain("setF1(null)");
    expect(bloco).toContain("setF2(null)");
    expect(bloco).toContain("setFlavorModalOpen(true)");
  });

  test("o modal de sabores (mesmo componente da pizza) também renderiza fora da sc-build quando é o calzone ou um produto de sabor único (Pastel de Forno/Feira)", () => {
    expect(fonte).toContain('{(screen === "sc-build" || (screen === "sc-list" && (calzoneMode || pastelMode))) && flavorModalOpen && size && (');
  });

  test("pickFlavor usa nextFlavorSelection travando calzone/mini-pizza/pastel/MINI em 1 sabor (sem duplicar a lógica da pizza)", () => {
    expect(fonte).toContain("const next = nextFlavorSelection(atual, f, miniPizzaMode || calzoneMode || pastelMode || isMiniSize);");
    expect(fonte).toContain('import { nextFlavorSelection } from "@/lib/pizzaSabores";');
  });

  test("3º sabor recusado avisa o cliente em vez de virar clique morto, e não toca no estado", () => {
    const bloco = fonte.slice(fonte.indexOf("function pickFlavor"), fonte.indexOf("const mam = !!(f1 && f2);"));
    // A recusa é detectada pela identidade da seleção devolvida (contrato
    // testado em @/lib/pizzaSabores), nunca por uma segunda regra de limite
    // reimplementada aqui.
    expect(bloco).toContain("if (next === atual) {");
    expect(bloco).toContain('showToast("Máximo de 2 sabores. Toque em um sabor já escolhido para trocar.");');
    // O caminho de recusa sai antes de qualquer setF1/setF2.
    expect(bloco.indexOf("showToast")).toBeLessThan(bloco.indexOf("setF1(next.f1)"));
  });

  test("REGRESSÃO (correção da regra comercial do Calzone, cardápio oficial 2026) — calzone usa a lista OFICIAL e FIXA de sabores (menu.catalog.calzone, nunca mais menu.catalog.lanches nem uma configuração dinâmica de flavorsMode/calzoneFlavors do Menu legado, que foi removida)", () => {
    // A UI do modal de escolha (o que é MOSTRADO ao cliente) precisa refletir
    // exatamente o que resolverSimpleSelectionIds vai aceitar. `calzoneFlavorNames`
    // vem de `menu.catalog.calzone[Calzone].flavors` — a mesma fonte, calculada
    // uma única vez por buildSimpleCatalog a partir do cardápio oficial 2026
    // (CALZONE_FLAVORS). Só cai para a lista cheia da pizza quando `menu.catalog`
    // está genuinamente ausente (resposta antiga em cache) — mesma regra de sempre.
    expect(fonte).toContain(
      "const calzoneFlavorNames = menu.catalog\n" +
      "    ? menu.catalog.calzone.find((l) => l.name === calzoneItem?.name)?.flavors?.filter((f) => f.available).map((f) => f.name) ?? []\n" +
      "    : [...(menu.saltyFlavors || []), ...(menu.sweetFlavors || [])];"
    );
    expect(fonte).not.toContain("menu.catalog.lanches.find((l) => l.name === calzoneItem");
    expect(fonte).not.toContain("calzoneFlavorsList");
  });

  test("pizzaFlavorSections: separa Tradicionais/Especiais/Doces pela aba ativa e filtra por preço no tamanho atual; sem catálogo, cai pro legado", () => {
    const bloco = fonte.slice(fonte.indexOf("const pizzaFlavorSections ="), fonte.indexOf("const calzoneFlavorNames ="));
    expect(bloco).toContain('const pizzaFlavorSections = menu.pizzaCatalog && size');
    expect(bloco).toContain('([pizzaCategoryFilter] as const)');
    expect(bloco).toContain("f.pricesBySizeCode[size as \"P\" | \"M\" | \"G\" | \"F\" | \"MINI\"] !== undefined");
    expect(bloco).toContain('{ title: "Salgadas", flavors: menu.saltyFlavors || [] }, { title: "Doces", flavors: menu.sweetFlavors || [] }');
  });

  test("Pizzas Especiais é categoria própria na home e abre diretamente a aba especial", () => {
    expect(fonte).toContain('onClick={() => goPizza("tradicional")}');
    expect(fonte).toContain('className="home-cat home-cat-special" onClick={() => goPizza("especial")}');
    expect(fonte).toContain("<strong>Pizzas Especiais</strong>");
  });

  test("REGRESSÃO (meio a meio entre categorias) — a aba é só filtro de EXIBIÇÃO: trocar de categoria nunca apaga os sabores já escolhidos", () => {
    expect(fonte).toContain('role="tablist" aria-label="Categoria dos sabores"');
    expect(fonte).toContain('role="tab" aria-selected={pizzaCategoryFilter === category}');
    expect(fonte).toContain("onClick={() => setPizzaCategoryFilter(category)}");
    // A causa raiz do bug "não consigo escolher 2 sabores": o handler da aba
    // zerava f1/f2, então abrir a aba do 2º sabor descartava o 1º e o meio a
    // meio Tradicional + Especial (ou + Doce) era impossível.
    expect(fonte).not.toContain("setPizzaCategoryFilter(category); setF1(null); setF2(null);");
  });

  test("REGRESSÃO (meio a meio entre categorias) — sabor escolhido fora da aba visível continua na lista, no topo, marcado e desmarcável", () => {
    // Os chips são montados de [f1, f2] e renderizados fora do corpo
    // rolável, então um sabor escolhido em outra aba continua visível e
    // removível sem voltar para a aba de origem.
    expect(fonte).toContain("const saboresEscolhidos = [f1, f2].filter((s): s is string => !!s);");
    expect(fonte).toContain("{renderFlavorChips()}");
    // O `sel` do JSX (mesma linha usada pelas seções normais) marca o sabor
    // escolhido venha ele da aba atual ou da seção "Escolhidos".
    expect(fonte).toContain("${f === f1 || f === f2 ? \"sel\" : \"\"}");
  });

  test("selos de novidade usam IDs oficiais tanto em sabores quanto em produtos simples", () => {
    expect(fonte).toContain('noveltyActive && isNewCatalogItemId(menu.pizzaCatalog?.flavors.find((flavor) => flavor.name === f)?.id)');
    expect(fonte).toContain('noveltyActive && isNewCatalogItemId("id" in it ? it.id : undefined)');
    // Card da home: selo só aparece quando aquela categoria específica tem
    // novidade de verdade (não mistura "existe alguma novidade em qualquer
    // lugar" com "esta categoria tem novidade"), derivado de
    // NEW_CATALOG_ITEM_IDS via pizzaFlavorsNovos/catNovelty.
    expect(fonte).toContain('{pizzaEspecialNovelty && <NoveltyBadge className="home-novelty" />}');
    expect(fonte).toContain('const pizzaFlavorsNovos = noveltyActive ? (menu.pizzaCatalog?.flavors || []).filter((f) => isNewCatalogItemId(f.id)) : [];');
    expect(fonte).toContain('timer = window.setTimeout(updateAndScheduleNovelty');
  });

  test("REGRESSÃO — Mini-Pizza como produto simples está desativada no site público (nunca resolve mais contra o catálogo oficial): o botão fica oculto quando o catálogo carregou", () => {
    // MINI virou tamanho de pizza (decisão comercial aprovada) — Mini-Pizza
    // não existe mais no catálogo oficial 2026, então deixar o botão clicável
    // levaria sempre a um fail-closed silencioso (sabor nunca resolve). Em vez
    // disso, o botão é ocultado assim que `menu.catalog` está presente.
    expect(fonte).toContain("const miniPizzaIndisponivel = !!menu.catalog;");
    expect(fonte).toContain("{miniPizzaItem && !miniPizzaIndisponivel && (");
  });

  test("buildOk bloqueia confirmar quando o calzone escolhido está esgotado", () => {
    expect(fonte).toContain("const buildOk = !!size && flavorOk && !(miniPizzaMode && miniPizzaEsgotada) && !(calzoneMode && calzoneEsgotada);");
  });

  test("addCalzone cria item 'simple' no carrinho com o nome do Calzone e o sabor escolhido, preservando o preço-base do cardápio", () => {
    expect(fonte).toContain("function addCalzone() {");
    const bloco = fonte.slice(fonte.indexOf("function addCalzone() {"), fonte.indexOf("function addPastel()"));
    expect(bloco).toContain("if (!calzoneItem || !f1) return;");
    expect(bloco).toContain("const detail = `Sabor: ${f1}`;");
    expect(bloco).toContain("name: calzoneItem.name, detail, price: calzoneItem.price, qty: 1, keys: [calzoneItem.name, f1]");
  });

  test("addPastel (Pastel de Forno/Feira) segue o MESMO padrão fail-closed de addCalzone, sem tocar no fluxo de pizza/calzone", () => {
    expect(fonte).toContain("function addPastel() {");
    const bloco = fonte.slice(fonte.indexOf("function addPastel() {"), fonte.indexOf("function continueBuild()"));
    expect(bloco).toContain("if (!pastelPendente || !f1) return;");
    expect(bloco).toContain("const simpleSelection = resolverSimpleSelectionIds(menu.catalog, pastelPendente.name, { flavorName: f1 });");
    expect(bloco).toContain("if (!simpleSelection && menu.catalog) {");
  });

  test("continueBuild roteia calzoneMode/pastelMode para addCalzone/addPastel, isMiniSize direto para finalizarPizza (sem borda/adicionais), sem tocar no fluxo de borda/plan das pizzas normais", () => {
    expect(fonte).toContain('function continueBuild() { if (!buildOk) return; if (miniPizzaMode) addMiniPizza(); else if (calzoneMode) addCalzone(); else if (pastelMode) addPastel(); else if (isMiniSize) finalizarPizza(null, 0, []); else go("sc-border"); }');
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

describe("AdminCardapio (painel de esgotados) — cobre TODAS as categorias do cardápio oficial 2026, nunca só os campos legados", () => {
  test("com o catálogo oficial presente, a lista 'todos' inclui as 3 categorias reais de sabor de pizza (Tradicionais/Especiais/Doces), bordas e adicionais", () => {
    const bloco = fonte.slice(fonte.indexOf("const todos: Produto[] = (menu.pizzaCatalog"), fonte.indexOf("const CATS = ["));
    expect(bloco).toContain('categoria: f.category === "tradicional" ? "Tradicionais" : f.category === "especial" ? "Especiais" : "Doces"');
    expect(bloco).toContain('categoria: "Bordas"');
    expect(bloco).toContain('categoria: "Adicionais"');
  });

  test("inclui Calzone/Pastel de Forno/Pastel de Feira por sabor/recheio individual (nunca só o produto agregado)", () => {
    const bloco = fonte.slice(fonte.indexOf("const todos: Produto[] = (menu.pizzaCatalog"), fonte.indexOf("const CATS = ["));
    expect(bloco).toContain('categoria: "Calzone"');
    expect(bloco).toContain('categoria: "Pastel de Forno"');
    // Pastel de Feira é um item de menu.catalog.lanches com .flavors — a
    // categoria vem do próprio nome do produto (l.name), sem precisar
    // hard-codar "Pastel de Feira" separadamente.
    expect(bloco).toContain("l.flavors && l.flavors.length > 0");
    expect(bloco).toContain("l.flavors.map(f => ({ id: f.id, nome: f.name, categoria: l.name }))");
  });

  test("inclui Hambúrguer, Macarronada (+ o grupo Bacon/Ovos extraído 1x só, nunca duplicado por produto), Sucos, Vitaminas, Bebidas", () => {
    const bloco = fonte.slice(fonte.indexOf("const todos: Produto[] = (menu.pizzaCatalog"), fonte.indexOf("const CATS = ["));
    expect(bloco).toContain('categoria: "Hambúrguer"');
    expect(bloco).toContain('categoria: "Macarronada"');
    expect(bloco).toContain("menu.catalog?.macarronadas?.[0]?.addOnGroup?.options");
    expect(bloco).toContain('categoria: "Sucos"');
    expect(bloco).toContain('categoria: "Vitaminas"');
    expect(bloco).toContain('categoria: "Bebidas"');
  });

  test("sem o catálogo oficial (resposta antiga em cache), cai pra lista legada de sempre — comportamento inalterado", () => {
    const bloco = fonte.slice(fonte.indexOf("const todos: Produto[] = (menu.pizzaCatalog"), fonte.indexOf("const CATS = ["));
    expect(bloco).toContain('categoria: "Salgados"');
    expect(bloco).toContain("(menu.saltyFlavors || []).map(f => ({ nome: f, categoria: \"Salgados\" }))");
  });

  test("CATS/CAT_ICON cobrem todas as categorias novas (só aparecem no filtro quando têm produtos, via .filter)", () => {
    expect(fonte).toContain('"Tradicionais", "Especiais", "Doces", "Bordas", "Adicionais",');
    expect(fonte).toContain('"Lanches", "Calzone", "Pastel de Forno", "Pastel de Feira", "Hambúrguer",');
    expect(fonte).toContain('"Macarronada", "Sucos", "Vitaminas", "Bebidas", "Salgados",');
    expect(fonte).toContain("].filter(c => c === \"todas\" || todos.some(p => p.categoria === c))");
  });
});

describe("Ingredientes + busca no cardápio do cliente (sabores/produtos)", () => {
  test("ingredientesDoItem lê o campo quando existe, nunca inventa quando ausente", () => {
    expect(ingredientesDoItem({ name: "Calabresa", ingredients: "Molho, Mussarela, Calabresa e Orégano." })).toBe(
      "Molho, Mussarela, Calabresa e Orégano."
    );
    expect(ingredientesDoItem({ name: "Guaraná 1L" })).toBeUndefined();
    expect(ingredientesDoItem(null)).toBeUndefined();
    expect(ingredientesDoItem("string qualquer")).toBeUndefined();
  });

  test("catalogParaListagem repassa ingredients quando a fonte tem o campo, e não inventa quando não tem", () => {
    const comIngredientes = catalogParaListagem({ id: "x-tudo", available: true, name: "X-Tudo", priceCents: 2500, ingredients: "Ovo, Bacon e Catupiry." });
    expect(comIngredientes.ingredients).toBe("Ovo, Bacon e Catupiry.");
    const semIngredientes = catalogParaListagem({ id: "guarana-1l", available: true, name: "Guaraná 1L", priceCents: 900 });
    expect(semIngredientes.ingredients).toBeUndefined();
  });

  test("itemBateBusca: nome sem termo sempre bate (lista completa por padrão)", () => {
    expect(itemBateBusca({ name: "Calabresa" }, "")).toBe(true);
  });

  test("itemBateBusca: acha por nome (buscar 'calabresa' acha 'Calabresa')", () => {
    expect(itemBateBusca({ name: "Calabresa", ingredients: "Molho, Mussarela e Orégano." }, "calabresa")).toBe(true);
  });

  test("itemBateBusca: acha por ingrediente (buscar 'bacon' acha item com bacon na composição, mesmo sem bacon no nome)", () => {
    expect(itemBateBusca({ name: "À Moda da Casa", ingredients: "Molho, Calabresa, Bacon, Requeijão Cremoso, Mussarela e Orégano." }, "bacon")).toBe(true);
  });

  test("itemBateBusca: normaliza acento (buscar 'requeijao' acha 'Requeijão Cremoso')", () => {
    expect(itemBateBusca({ name: "4 Queijos", ingredients: "Molho, Mussarela, Requeijão Cremoso, Gongorzola e Parmesão." }, "requeijao")).toBe(true);
  });

  test("itemBateBusca: termo sem correspondência não bate", () => {
    expect(itemBateBusca({ name: "Mussarela", ingredients: "Molho, Mussarela, Rodelas de Tomate, e Orégano." }, "camarao")).toBe(false);
  });

  // filtrarBairros: busca de bairro do checkout — sempre sobre a mesma fonte
  // do Admin (`menu.neighborhoods`), nunca uma lista paralela.
  describe("filtrarBairros — busca de bairro sobre a fonte do Admin (nunca lista paralela)", () => {
    const bairros = [
      { name: "Centro", fee: 300 },
      { name: "Mocambo", fee: 500 },
      { name: "Santos Antônio", fee: 500 },
      { name: "Tucum", fee: 400 },
      { name: "Santa Luzia", fee: 500 },
      { name: "Macaranã", fee: 500 },
      { name: "Matinha", fee: 500 },
      { name: "São Francisco", fee: 500 },
    ];

    test("[A] campo vazio (ex.: ao focar) devolve TODOS os bairros cadastrados, na ordem do Admin", () => {
      const r = filtrarBairros(bairros, "");
      expect(r.map((b) => b.name)).toEqual(bairros.map((b) => b.name));
    });

    test("[B] primeira letra filtra a lista", () => {
      const r = filtrarBairros(bairros, "m");
      expect(r.map((b) => b.name).sort()).toEqual(["Macaranã", "Matinha", "Mocambo", "Tucum"].sort());
    });

    test("[C] cada caractere a mais deixa o resultado progressivamente mais específico", () => {
      expect(filtrarBairros(bairros, "m").map((b) => b.name).sort()).toEqual(["Macaranã", "Matinha", "Mocambo", "Tucum"].sort());
      expect(filtrarBairros(bairros, "ma").map((b) => b.name).sort()).toEqual(["Macaranã", "Matinha"].sort());
      expect(filtrarBairros(bairros, "mac").map((b) => b.name)).toEqual(["Macaranã"]);
    });

    test("[ranking] prefixo vem antes de substring (\"san\" acha \"Santos Antônio\"/\"Santa Luzia\" antes de qualquer match só por conter)", () => {
      const r = filtrarBairros(bairros, "san");
      expect(r.map((b) => b.name)).toEqual(["Santos Antônio", "Santa Luzia"]);
    });

    test("[D] busca sem acento encontra nome com acento (\"sao\" acha \"São Francisco\", \"antonio\" acha \"Santos Antônio\")", () => {
      expect(filtrarBairros(bairros, "sao").map((b) => b.name)).toEqual(["São Francisco"]);
      expect(filtrarBairros(bairros, "antonio").map((b) => b.name)).toEqual(["Santos Antônio"]);
    });

    test("normaliza caixa e espaços extras (não afeta o nome/dado real devolvido)", () => {
      const maiusculo = filtrarBairros(bairros, "SANTA LUZIA");
      const comEspacos = filtrarBairros(bairros, "  santa   luzia  ");
      expect(maiusculo.map((b) => b.name)).toEqual(["Santa Luzia"]);
      expect(comEspacos.map((b) => b.name)).toEqual(["Santa Luzia"]);
      // o nome devolvido é o oficial cadastrado, nunca o texto normalizado da busca:
      expect(maiusculo[0].name).toBe("Santa Luzia");
    });

    test("[E] apagar a pesquisa (query volta a \"\") devolve todos os bairros de novo, nunca lista vazia", () => {
      expect(filtrarBairros(bairros, "cent").map((b) => b.name)).toEqual(["Centro"]);
      expect(filtrarBairros(bairros, "").length).toBe(bairros.length);
    });

    test("sem correspondência devolve lista vazia (UI decide a mensagem \"Nenhum bairro encontrado\")", () => {
      expect(filtrarBairros(bairros, "xyz-nao-existe")).toEqual([]);
    });

    test("[F] cada resultado preserva o índice original (b.i) — é o que alimenta bairroIdx/taxa no payload, nunca o texto da busca", () => {
      const r = filtrarBairros(bairros, "tucum");
      expect(r).toEqual([{ name: "Tucum", fee: 400, i: 3 }]);
    });

    test("[G] usa diretamente a lista recebida (menu.neighborhoods) — sem fallback nem dado hardcoded paralelo", () => {
      expect(filtrarBairros([], "qualquer")).toEqual([]);
      expect(filtrarBairros([{ name: "Único Bairro", fee: 700 }], "").map((b) => b.name)).toEqual(["Único Bairro"]);
    });
  });

  test("modal de sabores: ingredientesDoSabor busca no catálogo certo por modo (pizza/calzone/pastel), nunca escreve texto fixo no JSX", () => {
    expect(fonte).toMatch(/function ingredientesDoSabor\(nome: string\): string \| undefined \{/);
    expect(fonte).not.toMatch(/opt-desc-ingredients">\s*(Molho|Chocolate|Creme)/); // sem texto de ingrediente hardcoded no JSX
  });

  test("modal de sabores tem busca por texto (nome + ingredientes), some quando a lista é curta, filtra sem duplicar itens", () => {
    expect(fonte).toContain('placeholder={calzoneMode ? "Buscar sabor do calzone..." : pastelMode ? "Buscar sabor..." : "Buscar sabor da pizza..."}');
    expect(fonte).toContain("const showFlavorSearch = flavorSectionsSemBusca.reduce((n, s) => n + s.flavors.length, 0) > 5;");
    // Limpar busca (flavorSearchNorm vazio) sempre volta pra lista original sem filtro.
    expect(fonte).toContain("const flavorSections = flavorSearchNorm");
    expect(fonte).toContain("flavorSectionsSemBusca");
  });

  test("busca do modal de sabores reseta ao fechar o modal, nunca filtra silenciosamente a próxima abertura", () => {
    expect(fonte).toContain("if (!flavorModalOpen) setFlavorSearchQuery(\"\");");
  });

  test("tela de lista (Lanches/Hambúrguer/Bebidas/...) mostra busca só quando há volume (>6 itens) e ingredientes quando existem, sem inventar para bebidas/sucos/vitaminas", () => {
    expect(fonte).toContain("const mostrarBuscaLista = cfg.data.length > 6;");
    expect(fonte).toContain('placeholder="Buscar produto..."');
  });
});
