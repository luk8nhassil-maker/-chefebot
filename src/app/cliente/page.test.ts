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

describe("/cliente — Estados A/B/C de ativação individual (Nível 6.6)", () => {
  test("card de ativação: título, texto e os dois botões (\"Ativar meus pontos\" e \"Entrar com WhatsApp\")", () => {
    expect(fonte).toContain("Ative seus pontos");
    expect(fonte).toContain("Ativar meus pontos");
    expect(fonte).toContain("Entrar com WhatsApp");
    expect(fonte).toMatch(/onClick=\{ativarOuEntrar\}/);
    expect(fonte).toMatch(/onClick=\{entrarComWhatsapp\}/);
  });

  test("\"Entrar com WhatsApp\" só aparece sem sessão (nunca exigido, sempre disponível antes do login)", () => {
    const indiceGuarda = fonte.indexOf("{!perfil && (");
    const indiceBotao = fonte.indexOf("Entrar com WhatsApp", indiceGuarda);
    expect(indiceGuarda).toBeGreaterThan(-1);
    expect(indiceBotao).toBeGreaterThan(indiceGuarda);
    expect(indiceBotao - indiceGuarda).toBeLessThan(600);
  });

  test("status público do programa é consultado sem exigir sessão (estado antes do login)", () => {
    expect(fonte).toContain("/api/fidelidade/status");
    expect(fonte).toContain("buscarStatusPublico");
  });

  test("ativação individual chama a rota dedicada, nunca reaproveita a rota de fidelidade só-leitura", () => {
    expect(fonte).toContain("/api/cliente/fidelidade/ativar");
  });

  test("intenção 'ativar' aciona a ativação automaticamente após confirmar o código", () => {
    expect(fonte).toMatch(/intent === 'ativar'/);
  });

  test("estado de erro de carregamento tem retentativa, nunca fica preso sem saída", () => {
    expect(fonte).toContain("Tentar novamente");
    expect(fonte).toContain("irParaEstadoInicial");
  });

  test("pontosAtivos do perfil decide entre estado de ativação e estado de pontos (C)", () => {
    expect(fonte).toContain("perfilData.cliente.pontosAtivos");
  });
});

describe("/cliente — barra de progresso sempre visível, mesmo com 0 pontos (Nível 6.6)", () => {
  test("card \"Seu progresso\" com aria de progressbar", () => {
    expect(fonte).toContain("Seu progresso");
    expect(fonte).toContain('role="progressbar"');
    expect(fonte).toContain("aria-valuenow");
    expect(fonte).toContain("aria-valuemin={0}");
    expect(fonte).toContain("aria-valuemax={100}");
  });

  test("progresso nunca usa valor fixo — sempre lê de fidelidade.* (meta, saldo, recompensa dinâmicos)", () => {
    expect(fonte).toContain("fidelidade.metaPontos");
    expect(fonte).toContain("fidelidade.saldoPontos");
    expect(fonte).toContain("fidelidade.progressoPercentual");
    expect(fonte).toContain("fidelidade.descricaoRecompensa");
  });

  test("meta não configurada (<=0) tem mensagem própria, em vez de barra 0/0 sem sentido", () => {
    expect(fonte).toMatch(/fidelidade\.metaPontos > 0/);
    expect(fonte).toContain("A recompensa ainda não foi configurada");
  });

  test("\"Como funcionam os pontos?\" explica a regra real (sem inventar condição não configurada)", () => {
    expect(fonte).toContain("Como funcionam os pontos?");
    expect(fonte).toContain("comoFuncionaAberto");
    expect(fonte).toContain("R$1 gasto");
    expect(fonte).toContain("marcado como entregue");
  });
});
