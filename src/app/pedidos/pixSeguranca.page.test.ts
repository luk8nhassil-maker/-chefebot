import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesmo padrão de src/app/pedidos/page.test.ts: sem jsdom/testing-library
// para esta tela grande — os requisitos da camada de segurança da
// confirmação manual de Pix ficam garantidos estruturalmente na fonte.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

const corpoModal = fonte.slice(
  fonte.indexOf("{/* Modal de segurança"),
  fonte.indexOf("{/* Modal Finalizar Pedido */}")
);

describe("/pedidos — estados visuais do Pix (pendente/comprovante/confirmado)", () => {
  test("1. Pix pendente mostra o alerta amber 'PIX ainda não confirmado'", () => {
    expect(fonte).toContain("PIX ainda não confirmado");
    expect(fonte).toContain("Não libere este pedido antes de conferir a entrada do dinheiro.");
  });

  test("2. Pix pendente mostra o botão VERIFICAR PAGAMENTO com o aviso de ação de exceção", () => {
    expect(fonte).toContain("VERIFICAR PAGAMENTO");
    expect(fonte).toContain("Ação manual de exceção");
  });

  test("3. estado confirmado automaticamente não renderiza o botão de verificação (ramo mutuamente exclusivo do pixConfirmado)", () => {
    const trecho = fonte.slice(fonte.indexOf("isPix && !isCanceled ? ("), fonte.indexOf("{/* Verificar pagamento — pagamento misto"));
    // A estrutura é: p.pixConfirmado ? (blocos verdes, sem botão) : (bloco amber com VERIFICAR PAGAMENTO)
    const blocoConfirmado = trecho.slice(trecho.indexOf("p.pixConfirmado ? ("), trecho.indexOf(") : (\n            <div style={{ background: \"var(--attention-surface)\""));
    expect(blocoConfirmado).not.toContain("VERIFICAR PAGAMENTO");
    expect(blocoConfirmado).toContain("Pagamento confirmado automaticamente");
    expect(blocoConfirmado).toContain("Pagamento confirmado manualmente");
  });

  test("4. estado confirmado manualmente mostra usuário (confirmadoPorNome), data e horário", () => {
    expect(fonte).toContain("Confirmado manualmente por <strong>{p.pix?.confirmadoPorNome");
    expect(fonte).toContain("formatarDataHoraBR(p.pix?.confirmadoEm)");
  });

  test("15. estado automático e manual usam copys diferentes (nunca a mesma label)", () => {
    expect(fonte).toContain("Pagamento confirmado automaticamente");
    expect(fonte).toContain("Pagamento confirmado manualmente");
  });

  test("comprovante recebido reaproveita pix.status/evidencia existentes (não cria estado novo)", () => {
    expect(fonte).toContain("function pixTemComprovanteNaoValidado");
    expect(fonte).toContain('status === "em_revisao" || status === "suspeito" || status === "comprovante_recebido"');
    expect(fonte).toContain("Comprovante não é confirmação de pagamento.");
  });
});

describe("/pedidos — modal de segurança da confirmação manual (copy, checklist, senha)", () => {
  test("5. modal contém a copy financeira completa exigida", () => {
    expect(corpoModal).toContain("O DINHEIRO JÁ ENTROU NA CONTA?");
    expect(corpoModal).toContain("Este Pix ainda NÃO foi confirmado pelo banco.");
    expect(corpoModal).toContain("Não confirme apenas porque o cliente enviou um comprovante.");
    expect(corpoModal).toContain("Abra o banco ou Mercado Pago e confira se o valor realmente entrou antes de continuar.");
  });

  test("6. valor esperado aparece destacado no modal", () => {
    expect(corpoModal).toContain("Valor esperado");
    expect(corpoModal).toContain("valorFormatado");
  });

  test("checklist tem os três itens obrigatórios exigidos", () => {
    expect(corpoModal).toContain("Conferi a entrada do dinheiro no banco ou Mercado Pago.");
    expect(corpoModal).toContain("é exatamente");
    expect(corpoModal).toContain("O pagamento corresponde ao cliente");
  });

  test("campo de senha tem opção de mostrar/ocultar e nunca é logado", () => {
    expect(corpoModal).toContain('type={pixSenhaVisivel ? "text" : "password"}');
    expect(corpoModal).toContain("Ocultar senha");
    expect(corpoModal).toContain("Mostrar senha");
    expect(fonte).not.toMatch(/console\.(log|error|warn)\([^)]*pixSenha/);
  });

  test("botão final mostra o valor e o secundário 'Voltar e conferir novamente' existe", () => {
    expect(corpoModal).toContain("CONFIRMAR ${valorFormatado} COMO RECEBIDO");
    expect(corpoModal).toContain("Voltar e conferir novamente");
  });

  test("erro é anunciado via aria-live", () => {
    expect(corpoModal).toContain('aria-live="assertive"');
  });

  test("modal é role=dialog com aria-modal e aria-labelledby (acessibilidade)", () => {
    expect(corpoModal).toContain('role="dialog"');
    expect(corpoModal).toContain('aria-modal="true"');
    expect(corpoModal).toContain('aria-labelledby="pix-modal-titulo"');
  });

  test("Escape fecha sem confirmar (não chama confirmarPixManual) e não fecha durante o envio", () => {
    const efeitoFoco = fonte.slice(fonte.indexOf("Acessibilidade do modal de segurança"), fonte.indexOf("const abrirVerificacaoPix"));
    expect(efeitoFoco).toContain('e.key === "Escape"');
    expect(efeitoFoco).toContain("if (pixConfirmandoRef.current) return");
    expect(efeitoFoco).not.toContain("confirmarPixManual(");
  });
});

describe("/pedidos — regras de habilitação do botão final (checklist + senha + rede)", () => {
  test("7. botão final começa bloqueado (disabled quando !podeConfirmarPix)", () => {
    expect(corpoModal).toContain("disabled={!podeConfirmarPix}");
  });

  test("8. checklist incompleto mantém o botão bloqueado — podeConfirmarPix exige checklistCompleto", () => {
    expect(fonte).toContain("const checklistCompleto = pixChecklist.conferiu && pixChecklist.valorBate && pixChecklist.clienteCorreto");
    expect(fonte).toContain("const podeConfirmarPix = checklistCompleto && pixSenha.length > 0 && !pixConfirmando");
  });

  test("9. checklist completo sem senha mantém o botão bloqueado — exige pixSenha.length > 0", () => {
    expect(fonte).toMatch(/podeConfirmarPix = checklistCompleto && pixSenha\.length > 0/);
  });

  test("10. checklist completo + senha preenchida habilita o botão (nenhuma outra condição bloqueia)", () => {
    expect(fonte).toContain("const podeConfirmarPix = checklistCompleto && pixSenha.length > 0 && !pixConfirmando");
  });

  test("11. fechar o modal (fecharVerificacaoPix) nunca confirma pagamento — só reseta estado local", () => {
    const corpoFechar = fonte.slice(fonte.indexOf("const fecharVerificacaoPix = ()"), fonte.indexOf("const checklistCompleto"));
    expect(corpoFechar).not.toContain("fetch(");
    expect(corpoFechar).not.toContain("confirmarPixManual");
  });

  test("12. duplo clique não envia duas confirmações — guard por podeConfirmarPix (inclui !pixConfirmando) e pixConfirmando(true) logo no início", () => {
    const corpoConfirmar = fonte.slice(fonte.indexOf("const confirmarPixManual = async"), fonte.indexOf("const finalizarPedidoSilencioso"));
    expect(corpoConfirmar).toContain("if (!podeConfirmarPix) return");
    expect(corpoConfirmar).toContain("setPixConfirmando(true)");
  });

  test("13. senha incorreta (401) mostra erro e NÃO atualiza pedidos como pago", () => {
    const corpoConfirmar = fonte.slice(fonte.indexOf("const confirmarPixManual = async"), fonte.indexOf("const finalizarPedidoSilencioso"));
    const blocoErroSenha = corpoConfirmar.slice(corpoConfirmar.indexOf('r.status === 401'));
    expect(blocoErroSenha).toContain("setPixErro(data.error");
    expect(blocoErroSenha.slice(0, blocoErroSenha.indexOf("return"))).not.toContain("setPedidos(");
  });

  test("14. pagamento já confirmado (409) atualiza a interface com o pedido real do servidor e fecha o modal", () => {
    const corpoConfirmar = fonte.slice(fonte.indexOf("const confirmarPixManual = async"), fonte.indexOf("const finalizarPedidoSilencioso"));
    const blocoJaConfirmado = corpoConfirmar.slice(corpoConfirmar.indexOf("r.status === 409"), corpoConfirmar.indexOf("r.status === 401"));
    expect(blocoJaConfirmado).toContain("setPedidos(prev => prev.map(p => p.id === id && data.pedido ? { ...p, ...data.pedido } : p))");
    expect(blocoJaConfirmado).toContain("setTimeout(fecharVerificacaoPix");
  });

  test("falha de rede mostra mensagem de reconexão sem marcar como pago", () => {
    const corpoConfirmar = fonte.slice(fonte.indexOf("const confirmarPixManual = async"), fonte.indexOf("const finalizarPedidoSilencioso"));
    expect(corpoConfirmar).toContain("Não foi possível confirmar agora. Verifique a conexão e tente novamente.");
  });

  test("sucesso mostra o toast de confirmação segura com o valor recebido", () => {
    const corpoConfirmar = fonte.slice(fonte.indexOf("const confirmarPixManual = async"), fonte.indexOf("const finalizarPedidoSilencioso"));
    expect(corpoConfirmar).toContain("PAGAMENTO CONFIRMADO COM SEGURANÇA");
  });

  test("confirmação chama o endpoint dedicado e seguro, nunca o PATCH antigo de pixConfirmado direto", () => {
    const corpoConfirmar = fonte.slice(fonte.indexOf("const confirmarPixManual = async"), fonte.indexOf("const finalizarPedidoSilencioso"));
    expect(corpoConfirmar).toContain('fetch("/api/orders/confirmar-pix-manual"');
    expect(corpoConfirmar).not.toMatch(/fetch\("\/api\/orders",\s*\{\s*method:\s*"PATCH"[\s\S]*pixConfirmado/);
  });
});
