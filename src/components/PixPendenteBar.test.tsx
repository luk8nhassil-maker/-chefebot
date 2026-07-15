import { describe, test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PixPendenteBar from "./PixPendenteBar";

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
  const pendente = { pedidoId: "p1", statusToken: "tok-123", numero: 4821, total: 89.9 };

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
});
