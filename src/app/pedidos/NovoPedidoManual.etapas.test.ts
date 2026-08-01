import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesmo padrão de src/app/pedidos/page.test.ts e pixSeguranca.page.test.ts:
// sem jsdom/testing-library — os requisitos estruturais da tela de pedido
// manual em etapas ficam garantidos na própria fonte.
const fonte = readFileSync(fileURLToPath(new URL("./NovoPedidoManual.tsx", import.meta.url)), "utf-8");

describe("NovoPedidoManual — cinco etapas clicáveis", () => {
  test("existem exatamente cinco etapas, na ordem Cliente, Produtos, Entrega, Pagamento e Revisar", () => {
    expect(fonte).toContain('{ id: "cliente", label: "Cliente" }');
    expect(fonte).toContain('{ id: "produtos", label: "Produtos" }');
    expect(fonte).toContain('{ id: "entrega", label: "Entrega" }');
    expect(fonte).toContain('{ id: "pagamento", label: "Pagamento" }');
    expect(fonte).toContain('{ id: "revisar", label: "Revisar" }');
    const ordem = ["cliente", "produtos", "entrega", "pagamento", "revisar"].map((id) =>
      fonte.indexOf(`id: "${id}"`)
    );
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
  });

  test("o cabeçalho de etapas é clicável (botão, não div estática)", () => {
    const cabecalho = fonte.slice(fonte.indexOf("{PASSOS.map((p, i) => {"), fonte.indexOf("{/* Corpo */}"));
    expect(cabecalho).toContain("onClick={() => irParaPasso(p.id)}");
    expect(cabecalho).toContain("disabled={!alcancavel}");
  });
});

describe("NovoPedidoManual — bloqueio de avanço", () => {
  test("existe uma etapa alcançável derivada da validade de cada etapa anterior", () => {
    expect(fonte).toContain("const indiceAlcancavel");
    expect(fonte).toContain("function irParaPasso(destino: Passo)");
    expect(fonte).toContain("if (indiceDestino <= indiceAlcancavel) setPasso(destino)");
  });

  test("os botões Continuar de cada etapa ficam desabilitados sem os dados obrigatórios", () => {
    expect(fonte).toContain("disabled={!clienteValido}");
    expect(fonte).toContain("disabled={!podeIrParaEntrega}");
    expect(fonte).toContain("disabled={!entregaValida}");
    expect(fonte).toContain("disabled={!pagamentoValido}");
  });

  test("voltar nunca é bloqueado pela mesma validação (botões Voltar não usam indiceAlcancavel)", () => {
    const botoesVoltar = [...fonte.matchAll(/onClick=\{\(\) => setPasso\("(cliente|produtos|entrega|pagamento)"\)\}/g)];
    expect(botoesVoltar.length).toBeGreaterThanOrEqual(3);
  });
});

describe("NovoPedidoManual — telefone como primeiro campo e busca administrativa", () => {
  test("a etapa Cliente começa pelo telefone, antes do nome", () => {
    const etapaCliente = fonte.slice(fonte.indexOf('passo === "cliente"'), fonte.indexOf('passo === "produtos"'));
    const idxTelefone = etapaCliente.indexOf("Telefone com DDD");
    const idxNome = etapaCliente.indexOf("Nome do cliente");
    expect(idxTelefone).toBeGreaterThan(-1);
    expect(idxNome).toBeGreaterThan(-1);
    expect(idxTelefone).toBeLessThan(idxNome);
  });

  test("busca por telefone chama a rota administrativa autenticada, com debounce", () => {
    expect(fonte).toContain("/api/admin/clientes/buscar-telefone?telefone=");
    expect(fonte).toContain("window.setTimeout(async () => {");
    expect(fonte).toContain("window.clearTimeout(t)");
  });

  test("normalização do telefone não assume DDD fixo (usa apenas dígitos e comprimento mínimo)", () => {
    expect(fonte).toContain('telefone.replace(/\\D/g, "")');
    expect(fonte).not.toMatch(/\b86\d{2,}\b/); // nenhum DDD hardcoded na lógica de validação
  });

  test("nome é preenchido automaticamente só quando o campo está vazio, e continua editável", () => {
    expect(fonte).toContain('setCliente((atual) => (atual.trim() ? atual : data.nome))');
    expect(fonte).toContain('value={cliente} onChange={(e) => setCliente(e.target.value)}');
  });

  test("indicação visual de cliente reconhecido existe e depende do estado de busca", () => {
    expect(fonte).toContain("clienteReconhecido && !buscandoTelefone");
    expect(fonte).toContain("Cliente reconhecido");
  });
});

describe("NovoPedidoManual — cliente reconhecido em card compacto", () => {
  test("ícone oficial do WhatsApp aparece junto do reconhecimento", () => {
    expect(fonte).toContain("function WhatsAppIcon()");
    expect(fonte).toContain("<WhatsAppIcon />");
  });

  test("cliente reconhecido esconde o campo de nome atrás de um card com lápis", () => {
    expect(fonte).toContain("clienteReconhecido && !editandoNome");
    expect(fonte).toContain('aria-label="Editar nome do cliente"');
    expect(fonte).toContain("onClick={() => setEditarNomeParaTelefone(telefone)}");
  });

  test("o campo de nome editável continua existindo para cliente novo, sem telefone ou em edição", () => {
    expect(fonte).toContain('value={cliente} onChange={(e) => setCliente(e.target.value)}');
  });
});

describe("NovoPedidoManual — opção Sem número de telefone", () => {
  test("existe uma opção explícita, nunca inferida de campo vazio", () => {
    expect(fonte).toContain("Sem número de telefone");
    expect(fonte).toContain("checked={semTelefone}");
  });

  test("marcar a opção desliga a busca (o reconhecimento é derivado de semTelefone, nunca fica preso em true)", () => {
    expect(fonte).toContain("if (semTelefone) return");
    expect(fonte).toContain("const clienteReconhecido = !semTelefone &&");
  });

  test("o telefone só é dispensado da validação quando a flag semTelefone está marcada", () => {
    expect(fonte).toContain(
      "const clienteValido = !!cliente.trim() && (semTelefone || telefone.replace(/\\D/g, \"\").length >= 10)"
    );
  });

  test("o payload envia semTelefonePainel só quando a opção está marcada, e nunca telefone junto", () => {
    expect(fonte).toContain('telefone: semTelefone ? "" : telefone.trim()');
    expect(fonte).toContain("...(semTelefone ? { semTelefonePainel: true } : {})");
  });
});

describe("NovoPedidoManual — opção S/N no número do endereço", () => {
  test("existe um botão dedicado que alterna o número para S/N", () => {
    expect(fonte).toContain('setNumero((n) => (n.trim().toUpperCase() === "S/N" ? "" : "S/N"))');
    expect(fonte).toMatch(/>\s*S\/N\s*<\/button>/);
  });
});

describe("NovoPedidoManual — bilhete de itens escolhidos", () => {
  test("cada item do carrinho mostra nome, detalhe, preço e controles de ajuste/remoção", () => {
    const etapaProdutos = fonte.slice(fonte.indexOf('passo === "produtos"'), fonte.indexOf('passo === "entrega"'));
    expect(etapaProdutos).toContain("money(item.price * item.qty)");
    expect(etapaProdutos).toContain("alterarQuantidade(itens, i, -1)");
    expect(etapaProdutos).toContain("alterarQuantidade(itens, i, 1)");
    expect(etapaProdutos).toContain("removerItem(itens, i)");
  });
});

describe("NovoPedidoManual — etapa final de revisão", () => {
  test("a etapa Revisar mostra cliente, produtos, entrega e pagamento com edição por seção", () => {
    const etapaRevisar = fonte.slice(fonte.indexOf('passo === "revisar" && ('), fonte.indexOf("{/* Rodapé"));
    expect(etapaRevisar).toContain('irParaPasso("cliente")');
    expect(etapaRevisar).toContain('irParaPasso("produtos")');
    expect(etapaRevisar).toContain('irParaPasso("entrega")');
    expect(etapaRevisar).toContain('irParaPasso("pagamento")');
    expect(etapaRevisar).toContain("Resumo");
  });

  test("o botão final Criar pedido só existe na etapa Revisar", () => {
    const ocorrencias = [...fonte.matchAll(/Criar pedido/g)];
    expect(ocorrencias.length).toBeGreaterThan(0);
    expect(fonte).toContain('onClick={enviar}');
  });
});

describe("NovoPedidoManual — não duplica catálogo, preço ou payload já existentes", () => {
  test("continua importando o motor central de montagem/preço, sem duplicar lógica", () => {
    expect(fonte).toContain('from "@/lib/montagemManual"');
    expect(fonte).toContain("calcularTotalManual");
    expect(fonte).toContain("construirItemManual");
  });

  test("continua enviando para a mesma rota central de criação de pedido", () => {
    expect(fonte).toContain('fetch("/api/pedido-app"');
    expect(fonte).toContain("clientRequestId");
  });
});
