import { describe, test, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ClientBottomNav from "./ClientBottomNav";

// Sem jsdom/testing-library neste repo (ver outros *.test.ts): renderiza a
// árvore real com react-dom/server (não precisa de DOM) e verifica o HTML
// gerado — cobre exatamente os requisitos do menu inferior unificado.

describe("ClientBottomNav — quatro opções fixas do menu inferior do cliente", () => {
  test("mostra exatamente Início, Sacola, Pedido e Pontos — nunca 'Perfil'", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="pontos" />);
    expect(html).toContain(">Início<");
    expect(html).toContain(">Sacola<");
    expect(html).toContain(">Pedido<");
    expect(html).toContain(">Pontos<");
    expect(html).not.toContain("Perfil");
  });

  test("aba Pontos sempre aponta para /cliente", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="pontos" />);
    expect(html).toContain('href="/cliente"');
  });
});

describe("ClientBottomNav — estado ativo por aba", () => {
  test("active='pontos' marca só a aba Pontos", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="pontos" />);
    const pontosLink = html.match(/<a[^>]*href="\/cliente"[^>]*>/)?.[0] ?? "";
    expect(pontosLink).toContain("active");
  });

  test("active='pedido' marca a aba Pedido quando há pedidoHref", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="pedido" pedidoHref="/rastrear/abc" />);
    const pedidoLink = html.match(/<a[^>]*href="\/rastrear\/abc"[^>]*>/)?.[0] ?? "";
    expect(pedidoLink).toContain("active");
  });

  test("active=null não destaca nenhuma aba", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active={null} />);
    // "active" só deve aparecer dentro do próprio CSS embutido (seletor
    // ".cbn-item.active"), nunca como className de um item renderizado.
    expect(html).not.toMatch(/class="cbn-item active"/);
    expect(html).not.toMatch(/class="cbn-item [a-z-]*\s*active"/);
  });
});

describe("ClientBottomNav — aba Pedido: link de rastreio ou desabilitada", () => {
  test("sem pedidoHref -> item desabilitado, sem link", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="inicio" pedidoHref={null} />);
    expect(html).toContain("cbn-item disabled");
    expect(html).not.toContain('href="/rastrear');
  });

  test("com pedidoHref -> vira link para a rota de rastreio", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="inicio" pedidoHref="/rastrear/xyz" />);
    expect(html).toContain('href="/rastrear/xyz"');
    expect(html).not.toContain("cbn-item disabled");
  });
});

describe("ClientBottomNav — badge da sacola", () => {
  test("cartCount > 0 mostra o número", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="sacola" cartCount={3} />);
    expect(html).toContain("cbn-badge");
    expect(html).toContain(">3<");
  });

  test("cartCount 0 (ou ausente) não mostra badge", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="sacola" />);
    // A classe .cbn-badge sempre existe no CSS embutido; o que não pode
    // existir é o elemento <span class="cbn-badge"> em si.
    expect(html).not.toContain('class="cbn-badge"');
  });

  test("cartCount > 99 mostra '99+'", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="sacola" cartCount={150} />);
    expect(html).toContain(">99+<");
  });
});

describe("ClientBottomNav — Início/Sacola internos (cardápio) viram <button>, não <a>", () => {
  test("com onInicioClick/onSacolaClick, não navegam via href", () => {
    const html = renderToStaticMarkup(
      <ClientBottomNav active="inicio" onInicioClick={vi.fn()} onSacolaClick={vi.fn()} />
    );
    expect(html).toContain("<button");
    // "Início" e "Sacola" não devem estar dentro de um <a href="/pedido">
    // quando controlados por onClick (evita reload desnecessário dentro do
    // próprio cardápio).
    expect(html).not.toMatch(/<a[^>]*href="\/pedido"[^>]*>[\s\S]*?Início/);
  });

  test("sem onInicioClick/onSacolaClick, viram links para /pedido (padrão)", () => {
    const html = renderToStaticMarkup(<ClientBottomNav active="pontos" />);
    const links = html.match(/href="\/pedido"/g) ?? [];
    expect(links.length).toBe(2); // Início e Sacola
  });
});
