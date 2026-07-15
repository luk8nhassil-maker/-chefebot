import { describe, test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PixPendenteBar, { PIX_PENDENTE_BAR_HEIGHT_PX } from "./PixPendenteBar";
import { CLIENT_BOTTOM_NAV_HEIGHT_PX } from "./ClientBottomNav";

// Mesma convenção de ClientBottomNav.test.tsx: sem jsdom/testing-library
// neste repo, renderiza a árvore real com react-dom/server. A lógica de
// busca/estado (usePixPendente) é testada separadamente e sem React em
// src/lib/pixPendenteLocal.test.ts — aqui cobrimos só o componente puro,
// que recebe `pendente` já resolvido como prop.

describe("PixPendenteBar — sem pendência", () => {
  test("pendente=null não renderiza nada", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={null} />);
    expect(html).toBe("");
  });
});

describe("PixPendenteBar — com pendência", () => {
  const pendente = { pedidoId: "p1", statusToken: "tok-123", numero: 4821, valorPix: 89.9 };

  test("mostra número do pedido e valor formatado, com selo de status 'Pagamento pendente'", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toContain("Pedido #4821");
    expect(html).toContain("R$ 89,90");
    expect(html).toContain("Pagamento pendente");
  });

  test("hierarquia de leitura: selo de status → contexto do pedido → valor → CTA, nessa ordem no HTML", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    const idxBadge = html.indexOf("Pagamento pendente");
    const idxPedido = html.indexOf("Pedido #4821");
    const idxValor = html.indexOf("R$ 89,90");
    const idxCta = html.indexOf("Pagar agora");
    expect(idxBadge).toBeGreaterThan(-1);
    expect(idxPedido).toBeGreaterThan(idxBadge);
    expect(idxValor).toBeGreaterThan(idxPedido);
    expect(idxCta).toBeGreaterThan(idxValor);
  });

  test("CTA 'Pagar agora' presente", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toContain("Pagar agora");
  });

  test("link leva à tela de retomada pelo token público", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toContain('href="/pedido/pagamento/tok-123"');
  });

  test("role=status e aria-live=polite (nunca só cor para comunicar estado)", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  test("sem número do pedido, ainda mostra valor", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={{ ...pendente, numero: undefined }} />);
    expect(html).toContain("R$ 89,90");
    expect(html).not.toContain("Pedido #");
  });

  test("[caso 5] pedido misto mostra só o valorPix da parcela, nunca o total do pedido", () => {
    // Ex. obrigatório do bloqueio: total R$ 100, Pix R$ 40 — a barra mostra
    // R$ 40, não R$ 100 (valorPix já vem calculado do backend).
    const html = renderToStaticMarkup(<PixPendenteBar pendente={{ pedidoId: "p1", statusToken: "tok-123", numero: 4821, valorPix: 40 }} />);
    expect(html).toContain("R$ 40,00");
    expect(html).not.toContain("R$ 100,00");
  });
});

describe("PixPendenteBar — [bloqueio 1] posicionamento fixo acima do ClientBottomNav", () => {
  const pendente = { pedidoId: "p1", statusToken: "tok-123", numero: 4821, valorPix: 89.9 };

  test("[caso 1] barra usa position:fixed (não só renderizada antes do nav no fluxo)", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/\.pix-pendente-bar\{[^}]*position:fixed/);
  });

  test("usa left:50% + transform:translateX(-50%) + width:100% + max-width:540px, mesmo padrão do ClientBottomNav", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/\.pix-pendente-bar\{[^}]*left:50%/);
    expect(html).toMatch(/\.pix-pendente-bar\{[^}]*transform:translateX\(-50%\)/);
    expect(html).toMatch(/\.pix-pendente-bar\{[^}]*width:100%/);
    expect(html).toMatch(/\.pix-pendente-bar\{[^}]*max-width:540px/);
  });

  test("[caso 2] fica imediatamente acima do bottom nav: bottom = altura real do nav + safe-area", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toContain(`bottom:calc(${CLIENT_BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom))`);
  });

  test("z-index maior que o do ClientBottomNav (54) — nunca fica coberta por ele", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    const match = html.match(/\.pix-pendente-bar\{[^}]*z-index:(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(54);
  });

  test("[caso 3] espaçador no fluxo normal com a mesma altura da barra, para não esconder o conteúdo final", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toContain('class="pix-pendente-bar-spacer"');
    expect(html).toContain(`.pix-pendente-bar-spacer{flex-shrink:0;height:${PIX_PENDENTE_BAR_HEIGHT_PX}px}`);
  });

  test("sem pendência, nem a barra nem o espaçador aparecem (nada ocupa espaço à toa)", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={null} />);
    expect(html).toBe("");
  });
});

describe("PixPendenteBar — refino visual glass (só camada visual, mesmo comportamento)", () => {
  const pendente = { pedidoId: "p1", statusToken: "tok-123", numero: 4821, valorPix: 89.9 };

  test("aplica blur + saturate reais via backdrop-filter (com prefixo -webkit- para Safari/iOS)", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/backdrop-filter:blur\(\d+px\) saturate\(\d+%\)/);
    expect(html).toMatch(/-webkit-backdrop-filter:blur\(\d+px\) saturate\(\d+%\)/);
  });

  test("fundo translúcido controlado (não transparente demais, não vidro branco leitoso) — deriva de --secondary via color-mix", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/\.pix-pendente-bar\{[^}]*background:color-mix\(in srgb, var\(--secondary\) \d+%, transparent\)/);
  });

  test("borda sutil clara e sombra suave para separar do conteúdo atrás", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/border-top:1px solid color-mix\(in srgb, var\(--secondary-foreground\)/);
    expect(html).toMatch(/box-shadow:0 -\d+px \d+px -\d+px color-mix/);
  });

  test("nunca usa vermelho/perigo (--danger) — pendente é neutro/roxo (--attention), não alarmante", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).not.toContain("--danger");
  });

  test("nenhuma cor hexadecimal nova hardcoded no CSS — só tokens do design system via var()/color-mix", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  test("CTA continua com o maior contraste/destaque — cor sólida da marca, não participa do glass", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/\.pix-pendente-bar-cta\{[^}]*background:var\(--primary\)/);
    expect(html).toMatch(/\.pix-pendente-bar-cta\{[^}]*color:var\(--primary-foreground\)/);
    expect(html).not.toMatch(/\.pix-pendente-bar-cta\{[^}]*backdrop-filter/);
  });

  test("ícone à esquerda fica numa bolha discreta (círculo), sem glow exagerado (sem box-shadow de brilho)", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/\.pix-pendente-bar-icon\{[^}]*border-radius:999px/);
    expect(html).not.toMatch(/\.pix-pendente-bar-icon\{[^}]*box-shadow/);
  });

  test("selo 'Pagamento pendente' é uma pill pequena (border-radius total, padding contido), não um card grande", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toMatch(/\.pix-pendente-bar-badge\{[^}]*border-radius:999px/);
    expect(html).toMatch(/\.pix-pendente-bar-badge\{[^}]*font-size:9\.5px/);
  });

  test("valor tem peso visual mais forte que o texto de contexto (font-weight/tamanho maiores)", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    const infoMatch = html.match(/\.pix-pendente-bar-info\{([^}]*)\}/);
    const valorMatch = html.match(/\.pix-pendente-bar-valor\{([^}]*)\}/);
    expect(infoMatch).not.toBeNull();
    expect(valorMatch).not.toBeNull();
    const pesoInfo = Number(infoMatch![1].match(/font-weight:(\d+)/)?.[1]);
    const pesoValor = Number(valorMatch![1].match(/font-weight:(\d+)/)?.[1]);
    expect(pesoValor).toBeGreaterThan(pesoInfo);
  });

  test("altura real da barra (61px) continua maior/igual ao espaçador — nunca esconde conteúdo", () => {
    expect(PIX_PENDENTE_BAR_HEIGHT_PX).toBeGreaterThanOrEqual(60);
  });
});
