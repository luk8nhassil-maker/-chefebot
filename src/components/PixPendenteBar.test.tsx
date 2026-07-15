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

  test("mostra número do pedido e valor formatado", () => {
    const html = renderToStaticMarkup(<PixPendenteBar pendente={pendente} />);
    expect(html).toContain("Pedido #4821");
    expect(html).toContain("R$ 89,90");
    expect(html).toContain("Pix pendente");
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
