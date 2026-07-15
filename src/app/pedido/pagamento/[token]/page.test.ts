import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesma convenção de src/app/cardapio/page.test.ts: componente client-only
// com hooks/fetch/params assíncrono, sem jsdom neste repo — valida a fonte
// em vez de montar a árvore.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/pedido/pagamento/[token] — tela persistente de retomada do Pix", () => {
  test("reaproveita PixPagamentoCard.tsx em vez de recriar a UI do QR/copia-e-cola", () => {
    expect(fonte).toContain('import PixPagamentoCard');
    expect(fonte).toMatch(/<PixPagamentoCard\b/);
  });

  test("busca os dados sempre pelo token da URL — nunca por um id/estado vindo de outra tela", () => {
    expect(fonte).toContain("params.then((p) => setToken(p.token))");
    expect(fonte).toContain("/api/pedido-app/pagamento-pix?token=");
    // Não depende de nada do fluxo de checkout do cardápio (pedidoConfirmado,
    // cf_draft) — a única fonte de dados é a API pelo token público.
    expect(fonte).not.toContain("pedidoConfirmado");
    expect(fonte).not.toContain("cf_draft");
  });

  test("[caso 8] reload: o efeito de busca depende só de `token` (derivado da URL), não de estado herdado de outra navegação", () => {
    expect(fonte).toMatch(/useEffect\(\(\) => \{\s*if \(!token\) return/);
  });

  test("verificação automática reaproveita a mesma cadência (5s) já validada no cardápio, sem nova lógica de negócio", () => {
    expect(fonte).toContain("setInterval(() => verificar(token), 5000)");
  });

  test("expõe verificação manual explícita (não só automática)", () => {
    expect(fonte).toContain("handleVerificarManual");
    expect(fonte).toContain("Verificar agora");
  });

  test("nunca mostra a barra de Pix pendente na própria tela de pagamento", () => {
    expect(fonte).not.toContain("PixPendenteBar");
  });

  test("[item 7] Pix indisponível/expirado nunca cria nova cobrança nem regenera QR — só ações seguras existentes", () => {
    expect(fonte).toContain("Este Pix não está mais disponível.");
    expect(fonte).not.toMatch(/criar.{0,20}novo.{0,20}pix/i);
    expect(fonte).not.toContain("gerar-pix");
    expect(fonte).toContain("Voltar aos pedidos");
    expect(fonte).toContain("Falar com a Pizzaria");
  });

  test("transição para acompanhamento quando o Pix é confirmado", () => {
    expect(fonte).toMatch(/estado === 'confirmado'[\s\S]{0,200}\/rastrear\/\$\{dados\.id\}/);
  });

  test("limpa a referência local quando o backend confirma que não há mais pendência", () => {
    expect(fonte).toContain("deveLimparReferenciaPixPendente(data.estado)");
    expect(fonte).toContain("limparReferenciaPixPendente(localStorage)");
  });

  test("token não encontrado (404) também limpa a referência local", () => {
    expect(fonte).toMatch(/res\.status === 404[\s\S]{0,120}limparReferenciaPixPendente/);
  });

  test("menu inferior sempre visível, sem aba destacada (não é nenhuma das 4 abas fixas)", () => {
    expect(fonte).toContain('<ClientBottomNav active={null}');
  });
});

describe("/pedido/pagamento/[token] — [bloqueio 2] pagamento misto Pix + Dinheiro", () => {
  test("[caso 9] valorPix (Pix da parcela) vem só da resposta do backend, nunca calculado no cliente", () => {
    expect(fonte).toContain("dados.valorPix ?? dados.pix?.valorEsperado");
    // Nunca subtrai/calcula a parcela Pix a partir do total no próprio componente.
    expect(fonte).not.toMatch(/dados\.total\s*-\s*dados\.pix/);
  });

  test("usa calcularDivisaoPixDinheiro (centavos seguros) em vez de aritmética de ponto flutuante solta", () => {
    expect(fonte).toContain("import { calcularDivisaoPixDinheiro } from '@/lib/pixValores'");
    expect(fonte).toContain("calcularDivisaoPixDinheiro(dados.total || 0, valorPixBackend)");
  });

  test("[caso 12] Pix integral: isHibrido/hibridoAtual vêm só do resultado do cálculo (nenhum true hardcoded)", () => {
    expect(fonte).toContain("isHibrido={divisao.isHibrido}");
    expect(fonte).toContain("hibridoAtual={divisao.isHibrido ? { pix: divisao.pix, dinheiro: divisao.dinheiro } : null}");
    expect(fonte).not.toContain("isHibrido={false}");
    expect(fonte).not.toContain("isHibrido={true}");
  });

  test("[caso 13] QR/copia-e-cola continuam vindo só do pedido (dados.pix), sem duplicar lógica de geração", () => {
    expect(fonte).toContain("dados.pix?.copiaECola || dados.pix?.qrCode");
  });

  test("pedidoTotal passado ao card é sempre o total completo do pedido, nunca só a parte Pix", () => {
    expect(fonte).toContain("pedidoTotal={dados.total || 0}");
  });
});

describe("/pedido/pagamento/[token] — [bloqueio 3] WhatsApp dinâmico, sem número hardcoded", () => {
  test("[caso 9] número de telefone fixo não existe mais neste arquivo", () => {
    expect(fonte).not.toContain("PIZZARIA_NUMERO");
    expect(fonte).not.toContain("5586999999999");
  });

  test("[caso 11] usa o contato configurado (whatsappPizzaria) vindo do backend, nunca um valor fixo", () => {
    expect(fonte).toContain("whatsappPizzaria?: string");
    expect(fonte).toMatch(/href=\{`https:\/\/wa\.me\/\$\{whatsappPizzaria\}`\}/);
  });

  test("[caso 10] botão de WhatsApp só renderiza quando há número configurado", () => {
    expect(fonte).toMatch(/\{whatsappPizzaria && \(/);
  });

  test("nenhuma cor hexadecimal nova (ex.: #fff) — só tokens do design system", () => {
    expect(fonte).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(fonte).toContain("var(--on-success)");
  });
});
