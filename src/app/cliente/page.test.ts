import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guarda estrutural do patch de unificação de navegação: sem
// testing-library/jsdom neste repo (ver pedidoAtivoCliente.test.ts e
// ClientBottomNav.test.tsx para a lógica/UI testáveis por render), então os
// requisitos puramente textuais/estruturais da tela ficam garantidos aqui
// direto na fonte — evita que um texto ou link volte por engano.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/cliente — Área do Cliente renomeada para Pontos", () => {
  test("usa o menu inferior compartilhado, marcando Pontos como ativo", () => {
    expect(fonte).toContain("import ClientBottomNav from '@/components/ClientBottomNav'");
    expect(fonte).toMatch(/<ClientBottomNav[^>]*active="pontos"/);
  });

  test("título é 'Meus pontos', nunca 'Sua fidelidade'", () => {
    expect(fonte).toContain("Meus pontos");
    expect(fonte).not.toContain("Sua fidelidade");
  });

  test("não existe mais link público de retorno para /cardapio", () => {
    expect(fonte).not.toContain("/cardapio");
    expect(fonte).not.toContain("← Cardápio");
  });

  test("'Continuar comprando' e 'Prefiro pedir sem entrar agora' levam para /pedido", () => {
    expect(fonte).toMatch(/href="\/pedido"[^>]*>\s*Continuar comprando/);
    expect(fonte).toMatch(/href="\/pedido"[^>]*>\s*Prefiro pedir sem entrar agora/);
  });

  test("resgate de pontos redireciona para /pedido, nunca /cardapio", () => {
    expect(fonte).toContain("window.location.href = '/pedido'");
  });

  test("texto público de fidelidade inativa usa linguagem de 'programa de pontos'", () => {
    expect(fonte).toContain("O programa de pontos ainda não está ativo");
    expect(fonte).not.toContain("A fidelidade ainda não está ativa");
  });

  test("botão Sair é preservado", () => {
    expect(fonte).toContain("Sair da conta");
    expect(fonte).toMatch(/onClick=\{sair\}/);
  });

  test("nunca remove o rascunho cf_draft ao abrir Pontos", () => {
    expect(fonte).not.toContain("cf_draft");
  });

  test("aba Sacola sinaliza abrir a sacola em /pedido (não navega direto para sc-cart aqui)", () => {
    expect(fonte).toContain("CF_OPEN_CART_KEY");
    expect(fonte).toMatch(/onSacolaClick=\{abrirSacola\}/);
  });

  test("não renomeia tipos/chaves internas de fidelidade (backend intocado)", () => {
    // A tela troca só a copy pública; as chamadas de API e o shape de dados
    // continuam com o nome "fidelidade" internamente.
    expect(fonte).toContain("/api/cliente/fidelidade");
    expect(fonte).toContain("type Fidelidade");
  });
});
