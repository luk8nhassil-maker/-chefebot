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

  test("não passa mais pedidoHref para o menu inferior (aba Pedido é sempre estática)", () => {
    expect(fonte).not.toContain("pedidoHref");
    expect(fonte).not.toContain("cf_ultimo_pedido");
  });

  test("aceita retorno seguro (?next=) após login/verificação, via allowlist", () => {
    expect(fonte).toContain("import { destinoNextPermitido } from '@/lib/clientePedidos'");
    expect(fonte).toContain("nextPermitidoAtual");
    // usado tanto no carregamento inicial (já logado) quanto após confirmar OTP
    const usos = fonte.match(/nextPermitidoAtual\(\)/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(2);
  });
});

// Guarda estrutural do bug "saldo 0 confundido com programa inativo": a tela
// só pode decidir "inativo" pela flag booleana `fidelidade.ativo` (vinda do
// backend), nunca por uma checagem falsy sobre saldo/pontos (ex.: `!pontos`,
// `!fidelidade.saldoPontos`), que trataria 0 como "sem dado". Ver
// src/app/api/cliente/fidelidade/route.test.ts para a cobertura do lado do
// servidor (config ativo/inativo/ausente, saldo 0 vs. saldo > 0).
describe("/cliente — saldo 0 pontos nunca é tratado como programa inativo", () => {
  test("a mensagem de 'inativo' depende só de !fidelidade.ativo, nunca do saldo", () => {
    expect(fonte).toMatch(/\{!fidelidade\.ativo && \(/);
    expect(fonte).not.toMatch(/!fidelidade\.saldoPontos/);
    expect(fonte).not.toMatch(/!pontos\b/);
  });

  test("o painel de progresso (saldo, meta, barra, faltantes) só depende de fidelidade.ativo", () => {
    expect(fonte).toMatch(/\{fidelidade\.ativo && \(/);
    // Saldo e meta são exibidos como vêm do backend (inclui 0), sem `|| valorPadrao`
    // nem checagem de truthiness que apagaria o zero.
    expect(fonte).toContain("{fidelidade.saldoPontos}");
    expect(fonte).toContain("{fidelidade.saldoPontos} de {fidelidade.metaPontos} pontos");
    expect(fonte).not.toMatch(/fidelidade\.saldoPontos \|\|/);
    expect(fonte).not.toMatch(/fidelidade\.metaPontos \|\|/);
  });

  test("a barra de progresso usa progressoPercentual diretamente (0% quando saldo é 0)", () => {
    expect(fonte).toContain("width: `${Math.min(100, fidelidade.progressoPercentual)}%`");
  });

  test("pontos faltantes e recompensa configurada continuam exibidos com saldo 0", () => {
    expect(fonte).toContain("Faltam {fidelidade.pontosFaltantes} pontos para: {fidelidade.descricaoRecompensa}");
  });

  test("extrato vazio mostra estado vazio simples, não é confundido com 'inativo'", () => {
    expect(fonte).toContain("{fidelidade.extrato.length === 0 && (");
    expect(fonte).toContain("Nenhuma movimentação ainda — seu primeiro pedido entra aqui.");
  });

  test("'Continuar comprando' é renderizado depois dos dois blocos condicionais de ativo/inativo (sempre visível)", () => {
    const inicioBlocoInativo = fonte.indexOf("{!fidelidade.ativo && (");
    const inicioBlocoAtivo = fonte.indexOf("{fidelidade.ativo && (");
    const botaoContinuar = fonte.indexOf("Continuar comprando");
    expect(inicioBlocoInativo).toBeGreaterThan(-1);
    expect(inicioBlocoAtivo).toBeGreaterThan(inicioBlocoInativo);
    expect(botaoContinuar).toBeGreaterThan(inicioBlocoAtivo);
  });
});
