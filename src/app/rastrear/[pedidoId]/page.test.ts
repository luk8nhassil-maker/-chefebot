import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesma abordagem de guarda estrutural usada em src/app/cliente/page.test.ts
// (sem jsdom/testing-library neste repo): confirma que /rastrear/[pedidoId]
// ganhou o menu inferior compartilhado com "Pedido" ativo, sem quebrar
// token/polling/status/Pix/mapa já existentes.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/rastrear/[pedidoId] — menu inferior fixo com Pedido ativo", () => {
  test("renderiza o menu inferior compartilhado, fora de qualquer condicional de carregamento", () => {
    expect(fonte).toContain("import ClientBottomNav from '@/components/ClientBottomNav'");
    expect(fonte).toMatch(/<ClientBottomNav active="pedido"/);
  });

  test("Início do menu abre /pedido (via href padrão do componente, sem override)", () => {
    // Não passamos inicioHref customizado: o padrão do componente compartilhado
    // já é "/pedido", conferido em ClientBottomNav.test.tsx.
    expect(fonte).not.toMatch(/<ClientBottomNav[^>]*inicioHref=/);
  });

  test("Sacola volta para /pedido restaurando o rascunho e sinalizando abrir a sacola", () => {
    expect(fonte).toContain("CF_OPEN_CART_KEY");
    expect(fonte).toMatch(/onSacolaClick=\{abrirSacola\}/);
    expect(fonte).toContain("window.location.href = '/pedido'");
  });

  test("aba Pedido aponta para a própria página de rastreio quando o id já carregou", () => {
    expect(fonte).toMatch(/pedidoHref=\{pedidoId \? `\/rastrear\/\$\{pedidoId\}` : null\}/);
  });

  test("navegação de 'continuar comprando' usa /pedido, nunca /cardapio", () => {
    expect(fonte).not.toContain("/cardapio");
  });

  test("preserva token/polling/status/Pix/mapa: params, fetchStatus, fetchLocalizacao e intervalo continuam intactos", () => {
    expect(fonte).toContain("params.then(p => setPedidoId(p.pedidoId))");
    expect(fonte).toContain("fetch(`/api/pedido-status?pedidoId=${pedidoId}`");
    expect(fonte).toContain("fetch(`/api/localizacao?pedidoId=${pedidoId}`");
    expect(fonte).toContain("setInterval(() => {");
    expect(fonte).toContain("MapaEntregador");
  });
});
