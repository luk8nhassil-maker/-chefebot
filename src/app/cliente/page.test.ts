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
    // A tela pode chamar /api/cardapio-whatsapp-session (vínculo do link do
    // WhatsApp), mas nunca renderizar um link de navegação para /cardapio.
    expect(fonte).not.toContain('href="/cardapio"');
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

describe("/cliente — Perfil 3.0: número reconhecido pelo link do WhatsApp", () => {
  test("etapa de confirmação existe com a copy oficial", () => {
    expect(fonte).toContain("Encontramos seu WhatsApp");
    expect(fonte).toContain("Este é o número usado para abrir seu cardápio:");
    expect(fonte).toContain("Confirme seu WhatsApp para ativar seus pontos, acompanhar suas recompensas e não perder nenhuma vantagem.");
    expect(fonte).toContain("Confirmar e receber código");
    expect(fonte).toContain("Vamos enviar um código de segurança para este WhatsApp.");
    expect(fonte).toContain("Este número não é meu");
  });

  test("a etapa de confirmação exibe só o número mascarado vindo do servidor (nunca campo de telefone)", () => {
    // O número renderizado é o estado waMascarado (produzido no servidor);
    // não existe input de telefone dentro do bloco 'confirmar'.
    const blocoConfirmar = fonte.slice(fonte.indexOf("step === 'confirmar'"), fonte.indexOf("step === 'telefone'"));
    expect(blocoConfirmar).toContain("{waMascarado}");
    expect(blocoConfirmar).not.toContain('type="tel"');
    expect(blocoConfirmar).not.toContain("setTelefone");
  });

  test("o envio do código no fluxo reconhecido manda só o token opaco, nunca telefone", () => {
    const blocoPedirVinculo = fonte.slice(fonte.indexOf("async function pedirCodigoVinculo"), fonte.indexOf("async function pedirCodigo("));
    expect(blocoPedirVinculo).toContain("JSON.stringify({ waToken })");
    // nenhum telefone entra no body desse request (o servidor resolve o destino)
    expect(blocoPedirVinculo).not.toContain("JSON.stringify({ telefone");
  });

  test("a verificação do código no fluxo reconhecido usa o token, e no manual o telefone digitado", () => {
    expect(fonte).toContain("otpViaVinculo ? { waToken, codigo, traceId } : { telefone, codigo, traceId }");
  });

  test("token da URL é removido do endereço após leitura (nunca fica na barra)", () => {
    expect(fonte).toContain("params.delete('t')");
    expect(fonte).toContain("window.history.replaceState");
  });

  test("reutiliza as mesmas chaves de sessão do cardápio (token opaco + 4 finais), nunca o número completo", () => {
    expect(fonte).toContain("cf_wa_token");
    expect(fonte).toContain("cf_wa_final");
    // nenhum telefone completo hardcoded na fonte
    expect(fonte).not.toMatch(/\d{10,}/);
  });

  test("tela de código: copy, reenvio com contador e troca de número", () => {
    expect(fonte).toContain("Confira seu WhatsApp");
    expect(fonte).toContain("Enviamos um código para o número final ${waFinal}.");
    expect(fonte).toContain("Confirmar código");
    expect(fonte).toContain("Reenviar código em ${reenvioEm}s");
    expect(fonte).toContain("'Reenviar código'");
    expect(fonte).toContain("Usar outro número");
  });

  test("cliente novo informa somente o nome (copy oficial), salvo via PATCH do perfil", () => {
    expect(fonte).toContain("Como podemos chamar você?");
    expect(fonte).toContain("Seu WhatsApp já está confirmado. Falta só seu nome para ativar suas vantagens.");
    expect(fonte).toContain('placeholder="Seu nome"');
    expect(fonte).toContain("Ativar meus pontos");
    expect(fonte).toMatch(/method: 'PATCH'/);
    const blocoNome = fonte.slice(fonte.indexOf("async function salvarNome"), fonte.indexOf("async function sair"));
    expect(blocoNome).not.toContain("telefone");
  });

  test("vínculo inválido/expirado volta ao fluxo manual (vinculoInvalido)", () => {
    expect(fonte).toContain("vinculoInvalido");
    expect(fonte).toContain("limparVinculo");
  });

  test("fluxo manual continua existindo (acesso direto sem token)", () => {
    expect(fonte).toContain("Entre com seu WhatsApp");
    expect(fonte).toContain("Receber código no WhatsApp");
    expect(fonte).toContain('type="tel"');
  });
});

describe("/cliente — fluxo determinístico pós-OTP (máquina de estados)", () => {
  test("a próxima tela vem do servidor (next), nunca de sondagem de perfil/fidelidade", () => {
    expect(fonte).toContain("const next = data.next === 'points' ? 'points' : 'name'");
    // nenhum retry/sondagem decide etapa: helpers antigos não existem mais
    expect(fonte).not.toContain("carregarPerfilComRetry");
    expect(fonte).not.toContain("abrirAposVerificacao");
    // ticket de navegação não participa do fluxo do front
    expect(fonte).not.toContain("/api/cliente/sessao?tk=");
  });

  test("sessão vive primeiro em memória; storage é best-effort e nunca bloqueia", () => {
    expect(fonte).toContain("sessaoMemRef.current = sessao");
    expect(fonte).toMatch(/telemetria\('session_in_memory'/);
    expect(fonte).toMatch(/guardou \? 'session_storage_ok' : 'session_storage_failed'/);
    // fetchCliente recebe o token em memória explicitamente
    expect(fonte).toContain("sessaoMemRef.current)");
  });

  test("iniciarSemSessao é proibido depois de OTP válido (nunca volta ao início)", () => {
    const bloco = fonte.slice(fonte.indexOf("async function iniciarSemSessao"), fonte.indexOf("let token = ''"));
    expect(bloco).toContain("otpValidadoRef.current");
    expect(bloco).toContain("unexpected_return_to_confirm");
  });

  test("mount decide autenticação SÓ pelo estado-sessao (único 401 que volta a confirmar)", () => {
    expect(fonte).toContain("/api/cliente/estado-sessao");
    // nenhuma outra rota decide autenticação no mount
    const mount = fonte.slice(fonte.indexOf("ÚNICA fonte de"), fonte.indexOf("Contador de reenvio"));
    expect(mount).not.toContain("/api/cliente/perfil");
    expect(mount).not.toContain("/api/cliente/fidelidade");
  });

  test("identidade e fidelidade carregam separadas; falha vira retry local, nunca logout", () => {
    expect(fonte).toContain("async function carregarIdentidade");
    expect(fonte).toContain("async function carregarFidelidade");
    expect(fonte).not.toMatch(/Promise\.all\(\[\s*fetchCliente\('\/api\/cliente\/perfil/);
    expect(fonte).toContain("Não conseguimos carregar seus pontos agora.");
    expect(fonte).toContain("Não conseguimos carregar seu perfil agora.");
    expect(fonte).toContain("Tentar novamente");
  });

  test("salvar nome nunca pede novo código: falha mantém a tela com retry", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarNome"), fonte.indexOf("async function sair"));
    expect(bloco).toContain("Não conseguimos salvar agora. Tente de novo.");
    expect(bloco).not.toContain("setStep('telefone')");
    expect(bloco).not.toContain("setStep('confirmar')");
    expect(bloco).not.toContain("setStep('otp')");
  });

  test("código de suporte (traceId) aparece discreto e acompanha a telemetria", () => {
    expect(fonte).toContain("Código de suporte: {traceId}");
    expect(fonte).toMatch(/trace: traceId/);
  });
});

describe("/cliente — sessão portátil: PATCH do nome sem depender de sondagem por clienteId", () => {
  test("salvarNome registra o status da própria requisição de gravação do nome (telemetria)", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarNome"), fonte.indexOf("async function sair"));
    expect(bloco).toMatch(/telemetria\('name_save_request_status', \{ status: res\.status, trace: traceId \}\)/);
  });

  test("tela do nome também mostra o Código de suporte quando há erro (não só na tela do código)", () => {
    const inicioNome = fonte.indexOf("step === 'nome'");
    const blocoNome = fonte.slice(inicioNome, fonte.indexOf("step === 'perfil'", inicioNome));
    expect(blocoNome).toContain("Código de suporte: {traceId}");
    expect(blocoNome).toMatch(/erro && traceId/);
  });
});

describe("/cliente — Etapa 2: sem lembrete operacional de pedido + barra global de Pix pendente", () => {
  test("[caso 10] não mostra mais o card de 'pedido em andamento' (pontos previstos)", () => {
    expect(fonte).not.toContain("Seu pedido em andamento vai render");
    expect(fonte).not.toContain("pontosPrevistos > 0");
  });

  test("mantém saldo, progresso e extrato de pontos (não são notificação de pedido)", () => {
    expect(fonte).toContain("Seu saldo de pontos");
    expect(fonte).toContain("Extrato de pontos");
  });

  test("usa o hook central usePixPendente e repassa para a barra + indicador do menu", () => {
    expect(fonte).toContain("import PixPendenteBar, { usePixPendente } from '@/components/PixPendenteBar'");
    expect(fonte).toContain("usePixPendente()");
    expect(fonte).toContain("<PixPendenteBar pendente={pixPendente} />");
    expect(fonte).toMatch(/<ClientBottomNav[\s\S]{0,120}pixPendente=\{!!pixPendente\}/);
  });
});
