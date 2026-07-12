import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesma abordagem de guarda estrutural usada nas outras telas do cliente
// (sem jsdom/testing-library neste repo): a lógica pura (busca, status,
// ordenação, sanitização) já é coberta por render real/testes unitários em
// clientePedidos.test.ts e ClientBottomNav.test.tsx; aqui só garantimos que a
// tela usa essas peças corretamente e não reintroduz regressões proibidas.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/cliente/pedidos — Meus pedidos", () => {
  test("cabeçalho com título e subtítulo aprovados", () => {
    expect(fonte).toContain("Meus pedidos");
    expect(fonte).toContain("Acompanhe o status de todos os seus pedidos.");
  });

  test("exibe o buscador com o placeholder aprovado", () => {
    expect(fonte).toContain("Buscar por número, nome ou informação do pedido...");
  });

  test("rótulo de seção 'Seus pedidos'", () => {
    expect(fonte).toContain("Seus pedidos");
  });

  test("usa o menu inferior compartilhado com Pedido ativo e Sacola preservando o rascunho", () => {
    expect(fonte).toContain("import ClientBottomNav from '@/components/ClientBottomNav'");
    expect(fonte).toMatch(/<ClientBottomNav active="pedido"/);
    expect(fonte).toContain("CF_OPEN_CART_KEY");
    expect(fonte).toMatch(/onSacolaClick=\{abrirSacola\}/);
  });

  test("cada card aponta para /rastrear/[id] usando Link", () => {
    expect(fonte).toContain("import Link from 'next/link'");
    expect(fonte).toMatch(/href=\{`\/rastrear\/\$\{p\.id\}`\}/);
  });

  test("estado sem pedidos tem CTA para /pedido", () => {
    expect(fonte).toContain("Você ainda não fez nenhum pedido.");
    expect(fonte).toContain("Fazer meu primeiro pedido");
    expect(fonte).toMatch(/href="\/pedido"/);
  });

  test("estado sem resultado de busca oferece 'Limpar busca', nunca reaproveita a copy de 'sem pedidos'", () => {
    expect(fonte).toContain("Nenhum pedido encontrado para essa busca.");
    expect(fonte).toContain("Limpar busca");
  });

  test("estado de erro nunca expõe mensagem técnica, só 'Tentar novamente'", () => {
    expect(fonte).toContain("Tentar novamente");
    expect(fonte).not.toMatch(/error\.message/);
  });

  test("sessão expirada redireciona para /cliente com next=/cliente/pedidos", () => {
    expect(fonte).toContain("window.location.href = '/cliente?next=/cliente/pedidos'");
  });

  test("rodapé de contagem nunca diz 'últimos N' — é o histórico completo", () => {
    expect(fonte).toContain("pedido encontrado");
    expect(fonte).toContain("pedidos encontrados");
    expect(fonte).not.toMatch(/últimos? \d/i);
  });

  test("busca com cache: no-store e atualização periódica só com a página visível", () => {
    expect(fonte).toContain("cache: 'no-store'");
    expect(fonte).toContain("setInterval(talvezAtualizar, 15000)");
    expect(fonte).toContain("document.visibilityState === 'visible'");
    expect(fonte).toContain("visibilitychange");
  });

  test("preserva o texto da busca durante a atualização (busca não é resetada no fetch)", () => {
    // "carregar" nunca mexe em setBusca — só setPedidos/setTela.
    const carregarFn = fonte.match(/const carregar = useCallback\(async \(\) => \{[\s\S]*?\}, \[\]\)/)?.[0] ?? "";
    expect(carregarFn).not.toContain("setBusca");
  });

  test("não usa amarelo (--primary) como cor de status", () => {
    expect(fonte).not.toMatch(/cor:\s*['"]info['"][^}]*var\(--primary\)/);
    expect(fonte).toContain("var(--info-soft)");
    expect(fonte).toContain("var(--attention-soft)");
    expect(fonte).toContain("var(--danger-soft)");
  });

  test("não reintroduz corte arbitrário (.slice(-5)/.slice(-10)) na listagem", () => {
    expect(fonte).not.toContain(".slice(-5)");
    expect(fonte).not.toContain(".slice(-10)");
  });
});
