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

  test("o progresso é uma linha de cinco círculos clicáveis (botão, não div estática)", () => {
    const cabecalho = fonte.slice(fonte.indexOf('className="pm-steps-row"'), fonte.indexOf("{/* Corpo */}"));
    expect(cabecalho).toContain("onClick={() => irParaPasso(p.id)}");
    expect(cabecalho).toContain("disabled={!alcancavel}");
    expect(cabecalho).toContain("pm-step-circle");
    // Linha conectando os círculos (CSS, via ::after) e rótulo abaixo de cada um.
    expect(fonte).toContain(".pm-step-col:not(:last-child)::after");
    expect(cabecalho).toContain("{p.label}");
  });

  test("cada etapa mostra o indicador 'ETAPA X DE 5' e um título/instrução curta", () => {
    expect(fonte).toContain("function EtapaHeader(");
    expect(fonte).toContain("ETAPA {indice + 1} DE {PASSOS.length}");
    expect(fonte).toContain("const STEP_META: Record<Passo,");
  });
});

describe("NovoPedidoManual — bloqueio de avanço", () => {
  test("existe uma etapa alcançável derivada da validade de cada etapa anterior", () => {
    expect(fonte).toContain("const indiceAlcancavel");
    expect(fonte).toContain("function irParaPasso(destino: Passo)");
    expect(fonte).toContain("if (indiceDestino <= indiceAlcancavel) {");
  });

  test("o botão Continuar/Criar pedido fica desabilitado sem os dados obrigatórios da etapa atual", () => {
    expect(fonte).toContain("const clienteValido = !!cliente.trim() && (semTelefone || digitosTelefone.length >= 10)");
    expect(fonte).toContain("const produtosValido = itens.length > 0");
    expect(fonte).toContain("const entregaValida =");
    expect(fonte).toContain("const pagamentoValido =");
    expect(fonte).toContain("disabled={passo === \"revisar\" ? enviando || pendencias.length > 0 : !etapaValidaAtual}");
  });

  test("voltar nunca é bloqueado pela mesma validação (índice anterior, sem checar indiceAlcancavel)", () => {
    expect(fonte).toContain('onClick={() => setPasso(PASSOS[indicePassoAtual - 1].id)}');
    expect(fonte).not.toContain("disabled={!alcancavel}\n              onClick={() => setPasso(PASSOS[indicePassoAtual - 1].id)}");
  });
});

describe("NovoPedidoManual — telefone como primeiro campo e busca administrativa", () => {
  test("a etapa Cliente começa pelo telefone, antes do nome", () => {
    const etapaCliente = fonte.slice(fonte.indexOf('passo === "cliente" && ('), fonte.indexOf('passo === "produtos" && produtoUiState === "resumo"'));
    const idxTelefone = etapaCliente.indexOf("TELEFONE *");
    const idxNome = etapaCliente.indexOf("NOME *");
    expect(idxTelefone).toBeGreaterThan(-1);
    expect(idxNome).toBeGreaterThan(-1);
    expect(idxTelefone).toBeLessThan(idxNome);
  });

  test("o campo de telefone tem ícone, máscara de exibição e texto de ajuda", () => {
    const etapaCliente = fonte.slice(fonte.indexOf('passo === "cliente" && ('), fonte.indexOf('passo === "produtos" && produtoUiState === "resumo"'));
    expect(etapaCliente).toContain("<Phone");
    expect(etapaCliente).toContain("formatarTelefoneExibicao(telefone)");
    expect(etapaCliente).toContain("Assim que reconhecemos o telefone");
  });

  test("busca por telefone chama a rota administrativa autenticada, com debounce", () => {
    expect(fonte).toContain("/api/admin/clientes/buscar-telefone?telefone=");
    expect(fonte).toContain("window.setTimeout(async () => {");
    expect(fonte).toContain("window.clearTimeout(t)");
  });

  test("normalização do telefone não assume DDD fixo (usa apenas dígitos e comprimento mínimo)", () => {
    expect(fonte).toContain('const digitosTelefone = telefone.replace(/\\D/g, "")');
    expect(fonte).not.toMatch(/\b86\d{2,}\b/); // nenhum DDD hardcoded na lógica de validação
  });

  test("nome é preenchido automaticamente só quando o campo está vazio, e continua editável", () => {
    expect(fonte).toContain('setCliente((atual) => (atual.trim() ? atual : data.nome))');
    expect(fonte).toContain('id="pm-nome"');
    expect(fonte).toContain("value={cliente}");
    expect(fonte).toContain("onChange={(e) => setCliente(e.target.value)}");
  });

  test("indicação visual de cliente reconhecido existe e depende do estado de busca", () => {
    expect(fonte).toContain("clienteReconhecido && !buscandoTelefone");
    expect(fonte).toContain("Cliente reconhecido");
  });
});

describe("NovoPedidoManual — campo de nome condicional", () => {
  test("o campo de nome só aparece para cliente novo (busca concluída sem correspondência), sem telefone, ou edição explícita", () => {
    expect(fonte).toContain("const buscaConcluidaParaTelefoneAtual = telefonePesquisado !== null && telefonePesquisado === digitosTelefone");
    expect(fonte).toContain("const semCorrespondencia = buscaConcluidaParaTelefoneAtual && !clienteReconhecido");
    expect(fonte).toContain("const mostrarCampoNome = semTelefone || semCorrespondencia || editandoNome");
    expect(fonte).toContain("{mostrarCampoNome && (");
  });

  test("a busca só é considerada concluída para o telefone atual (nunca antes do debounce terminar)", () => {
    expect(fonte).toContain("setTelefonePesquisado(digitos)");
  });
});

describe("NovoPedidoManual — cliente reconhecido em card compacto", () => {
  test("ícone oficial do WhatsApp aparece junto do reconhecimento, usando o token de marca do WhatsApp", () => {
    expect(fonte).toContain("function WhatsAppIcon()");
    expect(fonte).toContain("<WhatsAppIcon />");
    expect(fonte).toContain('fill="var(--whatsapp)"');
  });

  test("cliente reconhecido esconde o campo de nome atrás de um card com lápis", () => {
    expect(fonte).toContain("clienteReconhecido && !editandoNome");
    expect(fonte).toContain('aria-label="Editar nome do cliente"');
    expect(fonte).toContain("onClick={() => setEditarNomeParaTelefone(telefone)}");
    expect(fonte).toContain("<Pencil size={16} />");
  });
});

describe("NovoPedidoManual — card 'Sem número de telefone' (nunca um checkbox solto)", () => {
  test("é um card inteiro clicável com indicador de seleção, não um checkbox", () => {
    const etapaCliente = fonte.slice(fonte.indexOf('passo === "cliente" && ('), fonte.indexOf('passo === "produtos" && produtoUiState === "resumo"'));
    expect(etapaCliente).toContain("Sem número de telefone");
    expect(etapaCliente).toContain("onClick={() => setSemTelefone((v) => !v)}");
    expect(etapaCliente).toContain("aria-pressed={semTelefone}");
    expect(etapaCliente).toContain("<SelectionDot selecionado={semTelefone} />");
    expect(etapaCliente).not.toContain('type="checkbox"');
  });

  test("marcar a opção desliga a busca (o reconhecimento é derivado de semTelefone, nunca fica preso em true)", () => {
    expect(fonte).toContain("if (semTelefone) return");
    expect(fonte).toContain("const clienteReconhecido = !semTelefone &&");
  });

  test("o telefone só é dispensado da validação quando a flag semTelefone está marcada", () => {
    expect(fonte).toContain(
      "const clienteValido = !!cliente.trim() && (semTelefone || digitosTelefone.length >= 10)"
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

describe("NovoPedidoManual — etapa Entrega com cards clicáveis", () => {
  test("Entrega/Retirada/No local são cards com ícone, não pílulas de texto", () => {
    const etapaEntrega = fonte.slice(fonte.indexOf('passo === "entrega"'), fonte.indexOf('passo === "pagamento"'));
    expect(etapaEntrega).toContain("Bike");
    expect(etapaEntrega).toContain("Store");
    expect(etapaEntrega).toContain("UtensilsCrossed");
    expect(etapaEntrega).toContain("pm-select-card");
  });
});

describe("NovoPedidoManual — etapa Pagamento com cards clicáveis", () => {
  test("cada forma de pagamento é um card com ícone e o total fica visível", () => {
    const etapaPagamento = fonte.slice(fonte.indexOf('passo === "pagamento" && ('), fonte.indexOf('passo === "revisar" && ('));
    expect(etapaPagamento).toContain("pm-select-card");
    expect(etapaPagamento).toContain("Total do pedido");
    expect(etapaPagamento).toContain("money(totais.total)");
  });
});

describe("NovoPedidoManual — montadores no mesmo modal (nunca fullscreen)", () => {
  test("o construtor guiado é um painel centralizado, não uma camada cobrindo a tela inteira", () => {
    const construtor = fonte.slice(fonte.indexOf("{/* Construtor guiado"), fonte.indexOf("{confirmarSaida && ("));
    expect(construtor).toContain('width: "min(94vw, 560px)"');
    expect(construtor).toContain('justifyContent: "center"');
  });

  test("radio para escolha única (borda, tamanho, leite, sabor único); checkbox só para sabores de pizza (até 2)", () => {
    expect(fonte).toContain('const tipoControleEtapa: "radio" | "checkbox" = etapaAtual?.tipo === "sabores" ? "checkbox" : "radio"');
    expect(fonte).toContain('type={tipoControleEtapa}');
    expect(fonte).toContain('name="pm-opcao-etapa"');
    expect(fonte).toContain("checked={sel}");
  });
});

describe("NovoPedidoManual — bilhete de itens escolhidos", () => {
  test("cada item do carrinho mostra nome, detalhe, preço e controles de ajuste/remoção", () => {
    const etapaProdutos = fonte.slice(fonte.indexOf('passo === "produtos" && produtoUiState === "resumo" && ('), fonte.indexOf('passo === "entrega"'));
    expect(etapaProdutos).toContain("money(item.price * item.qty)");
    expect(etapaProdutos).toContain("alterarQuantidade(itens, i, -1)");
    expect(etapaProdutos).toContain("alterarQuantidade(itens, i, 1)");
    expect(etapaProdutos).toContain("removerItem(itens, i)");
  });
});

describe("NovoPedidoManual — etapa Produtos em dois estados (resumo/seletor)", () => {
  const etapaResumo = fonte.slice(
    fonte.indexOf('passo === "produtos" && produtoUiState === "resumo" && ('),
    fonte.indexOf('passo === "produtos" && produtoUiState === "seletor" && (')
  );
  const etapaSeletor = fonte.slice(
    fonte.indexOf('passo === "produtos" && produtoUiState === "seletor" && ('),
    fonte.indexOf('passo === "entrega"')
  );

  test("a etapa inicia no resumo (ESTADO A), nunca no seletor", () => {
    expect(fonte).toContain('const [produtoUiState, setProdutoUiState] = useState<"resumo" | "seletor">("resumo")');
  });

  test("resumo vazio mostra estado vazio claro e mantém o botão + Adicionar em destaque", () => {
    expect(etapaResumo).toContain("Nenhum produto adicionado ainda");
    // O botão + Adicionar é renderizado incondicionalmente, antes do ternário
    // vazio/bilhete (`itens.length === 0 ? (` — o gate do estado vazio em si).
    const idxBotaoAdicionar = etapaResumo.indexOf('onClick={() => setProdutoUiState("seletor")}');
    const idxTernarioVazio = etapaResumo.indexOf("itens.length === 0 ? (");
    expect(idxBotaoAdicionar).toBeGreaterThan(-1);
    expect(idxTernarioVazio).toBeGreaterThan(-1);
    expect(idxBotaoAdicionar).toBeLessThan(idxTernarioVazio);
  });

  test("+ Adicionar abre o seletor (ESTADO B)", () => {
    expect(etapaResumo).toContain('onClick={() => setProdutoUiState("seletor")}');
    expect(etapaResumo).toContain("<Plus size={18}");
  });

  test("+ Adicionar continua disponível depois do primeiro item (não é substituído pelo bilhete)", () => {
    // O botão fica fora do ternário itens.length === 0 ? vazio : bilhete — sempre visível.
    const idxBotao = etapaResumo.indexOf('onClick={() => setProdutoUiState("seletor")}');
    const idxTernario = etapaResumo.indexOf("itens.length === 0 ? (");
    expect(idxBotao).toBeLessThan(idxTernario);
  });

  test("Continuar bloqueado sem item e liberado com pelo menos um item", () => {
    expect(fonte).toContain("const produtosValido = itens.length > 0");
    expect(fonte).toContain("[clienteValido, produtosValido, entregaValida, pagamentoValido, pendencias.length === 0][indicePassoAtual]");
  });

  test("o rodapé com Voltar/Continuar (navegação entre etapas) some enquanto o seletor está aberto", () => {
    expect(fonte).toContain("const emSeletorProdutos = passo === \"produtos\" && produtoUiState === \"seletor\"");
    expect(fonte).toContain("{!emSeletorProdutos && (");
  });

  test("o seletor tem cabeçalho com botão de voltar ao resumo, título e subtítulo", () => {
    expect(etapaSeletor).toContain('onClick={() => setProdutoUiState("resumo")}');
    expect(etapaSeletor).toContain('aria-label="Voltar ao resumo do pedido"');
    expect(etapaSeletor).toContain("Adicionar produto");
    expect(etapaSeletor).toContain("Preços do cardápio oficial");
  });

  test("busca aparece no topo do seletor e pesquisa em todas as categorias", () => {
    expect(etapaSeletor).toContain("<Search");
    expect(etapaSeletor).toContain('placeholder="Buscar pizza, calzone, suco…"');
    // A busca em si (useMemo) fica fora do JSX, mas alimenta `resultados`
    // usado nesta camada — "todas" as categorias quando há termo digitado.
    expect(fonte).toContain('buscarProdutos(produtos, termo, buscando ? "todas" : categoria)');
  });

  test("a barra de categorias é um componente próprio, chamado sem NENHUMA condição dentro do seletor", () => {
    // <BarraCategorias .../> aparece cru dentro do JSX do seletor — nenhum
    // `{condição && (` o envolve. Isso é o que torna estruturalmente
    // impossível a barra inteira sumir por causa de `buscando`, `categoria`
    // ou do resultado da busca.
    expect(etapaSeletor).toContain("<BarraCategorias");
    expect(etapaSeletor).not.toMatch(/\{[^{}]*&&\s*\(\s*<BarraCategorias/);
    expect(etapaSeletor).not.toMatch(/\{buscando\s*\?\s*[^:]*:\s*<BarraCategorias/);
  });

  test("função BarraCategorias sempre renderiza as 4 categorias — `destacar`/`categoriaAtiva` só mudam o estado visual", () => {
    const corpo = fonte.slice(fonte.indexOf("function BarraCategorias("), fonte.indexOf("export default function NovoPedidoManual"));
    expect(corpo).toContain("CATEGORIAS.map((c) => {");
    expect(corpo).toContain("const ativo = destacar && categoriaAtiva === c.id");
    // O map em si nunca é condicionado — só o atributo `ativo` de cada botão.
    expect(corpo).not.toMatch(/\{destacar\s*&&\s*\(/);
    expect(corpo).not.toMatch(/\{categoriaAtiva\s*&&\s*\(/);
  });

  test("clicar numa categoria só troca o filtro (via onSelecionar) — nunca desmonta ou reseta a barra", () => {
    expect(etapaSeletor).toContain("destacar={!buscando}");
    expect(etapaSeletor).toContain("onSelecionar={(id) => {");
    expect(etapaSeletor).toContain("setTermo(\"\")");
    expect(etapaSeletor).toContain("setCategoria(id)");
  });

  test("categoria ativa recebe estado visual (aria-selected) e semântica de abas acessível por teclado", () => {
    const corpo = fonte.slice(fonte.indexOf("function BarraCategorias("), fonte.indexOf("export default function NovoPedidoManual"));
    expect(corpo).toContain('role="tablist"');
    expect(corpo).toContain('role="tab"');
    expect(corpo).toContain("aria-selected={ativo}");
  });

  test("a barra não encolhe/some por flex — flexShrink e altura mínima fixos, com rolagem horizontal", () => {
    const corpo = fonte.slice(fonte.indexOf("function BarraCategorias("), fonte.indexOf("export default function NovoPedidoManual"));
    expect(corpo).toContain('overflowX: "auto"');
    expect(corpo).toContain("flexShrink: 0");
    expect(corpo).toContain("minHeight: 36");
  });

  test("busca ativa e estado vazio (sem resultado na categoria) não desmontam a barra — só mudam o que vem depois dela", () => {
    // A barra é renderizada ANTES dos blocos condicionais de busca/vazio, e
    // nenhum desses blocos a envolve.
    const idxBarra = etapaSeletor.indexOf("<BarraCategorias");
    const idxBuscando = etapaSeletor.indexOf("{buscando && (");
    const idxVazio = etapaSeletor.indexOf("resultados.length === 0 && !buscando");
    expect(idxBarra).toBeGreaterThan(-1);
    expect(idxBuscando).toBeGreaterThan(idxBarra);
    expect(idxVazio).toBeGreaterThan(idxBarra);
  });

  test("produtos filtrados mostram ícone/categoria, nome, preço, estado indisponível e um botão 'Escolher'", () => {
    expect(etapaSeletor).toContain("const IconeProduto = ICONE_CATEGORIA[p.categoria]");
    expect(etapaSeletor).toContain("Esgotado");
    expect(etapaSeletor).toContain("Escolher");
    expect(etapaSeletor).toContain("onClick={() => abrirProduto(p)}");
    expect(etapaSeletor).toContain("disabled={p.esgotado}");
  });

  test("categorias e ícones usam exclusivamente os contratos oficiais do ChefeBot (CATEGORIAS/CategoriaManual)", () => {
    expect(fonte).toContain("const ICONE_CATEGORIA: Record<CategoriaManual, LucideIcon>");
    expect(fonte).toContain('from "@/lib/montagemManual"');
  });
});

describe("NovoPedidoManual — ciclo completo (+ Adicionar → categoria → produto → montar → adicionar → resumo)", () => {
  test("escolher produto sem montagem adiciona direto e volta ao resumo automaticamente", () => {
    expect(fonte).toContain("function adicionarDireto(produto: ProdutoManual) {");
    const corpo = fonte.slice(fonte.indexOf("function adicionarDireto("), fonte.indexOf("function confirmarMontagem("));
    expect(corpo).toContain("adicionarAoCarrinho(atual, item)");
    expect(corpo).toContain('setProdutoUiState("resumo")');
  });

  test("confirmar a montagem de um produto com opções adiciona ao carrinho e volta ao resumo automaticamente", () => {
    const corpo = fonte.slice(fonte.indexOf("function confirmarMontagem("), fonte.indexOf("function avancarEtapa("));
    expect(corpo).toContain("adicionarAoCarrinho(atual, item)");
    expect(corpo).toContain("setProdutoAberto(null)");
    expect(corpo).toContain('setProdutoUiState("resumo")');
  });

  test("cancelar o montador (voltar na primeira etapa) devolve ao seletor, não ao resumo", () => {
    // voltarEtapa só fecha o montador (setProdutoAberto(null)); nunca toca em produtoUiState,
    // então o seletor (ESTADO B) continua visível por baixo.
    const corpo = fonte.slice(fonte.indexOf("function voltarEtapa("), fonte.indexOf("function escolher("));
    expect(corpo).toContain("setProdutoAberto(null)");
    expect(corpo).not.toContain("produtoUiState");
  });

  test("o montador é um painel centralizado dentro do mesmo modal — nunca fullscreen", () => {
    const construtor = fonte.slice(fonte.indexOf("{/* Construtor guiado"), fonte.indexOf("{confirmarSaida && ("));
    expect(construtor).toContain('width: "min(94vw, 560px)"');
    expect(construtor).toContain('justifyContent: "center"');
  });

  test("segundo produto (de categoria diferente) pode ser adicionado sem perder o primeiro", () => {
    // adicionarAoCarrinho só funde itens IDÊNTICOS (mesmo kind/name/detail);
    // produtos diferentes coexistem na mesma lista `itens`, sem filtro por categoria.
    expect(fonte).toContain("adicionarAoCarrinho");
    expect(fonte).not.toMatch(/itens\.filter\([^)]*categoria/);
  });
});

describe("NovoPedidoManual — o carrinho nunca é perdido no ciclo de Produtos", () => {
  test("fechar o seletor (voltar ao resumo) não toca no carrinho", () => {
    const handler = fonte.slice(
      fonte.indexOf('onClick={() => setProdutoUiState("resumo")}'),
      fonte.indexOf('onClick={() => setProdutoUiState("resumo")}') + 60
    );
    expect(handler).not.toContain("setItens");
  });

  test("trocar de categoria ou pesquisar não reseta `itens`", () => {
    expect(fonte).not.toMatch(/setCategoria\([^)]*\)[\s\S]{0,20}setItens\(/);
    expect(fonte).not.toMatch(/setTermo\([^)]*\)[\s\S]{0,20}setItens\(\[\]\)/);
  });

  test("sair de Produtos para outra etapa preserva o carrinho (só reseta a UI do seletor para a próxima visita)", () => {
    const corpo = fonte.slice(fonte.indexOf("function irParaPasso("), fonte.indexOf("const bairros ="));
    expect(corpo).toContain('if (passo === "produtos" && destino !== "produtos") setProdutoUiState("resumo")');
    expect(corpo).not.toContain("setItens");
  });

  test("`itens` (o carrinho) só é alterado por adicionar/ajustar/remover — nunca por navegação de etapa ou de seletor", () => {
    const setItensChamadas = [...fonte.matchAll(/setItens\(/g)].length;
    // adicionarDireto, confirmarMontagem, aumentar, diminuir e remover — as
    // únicas cinco origens legítimas de mutação do carrinho.
    expect(setItensChamadas).toBe(5);
  });
});

describe("NovoPedidoManual — teclado, foco e responsividade no fluxo Produtos", () => {
  test("o campo de busca do seletor recebe foco automaticamente ao abrir", () => {
    const etapaSeletor = fonte.slice(
      fonte.indexOf('passo === "produtos" && produtoUiState === "seletor" && ('),
      fonte.indexOf('passo === "entrega"')
    );
    expect(etapaSeletor).toContain("autoFocus");
  });

  test("categorias, produtos e o botão + Adicionar são <button> nativos (operáveis por teclado)", () => {
    expect(fonte).toContain('onClick={() => abrirProduto(p)}');
    expect(fonte).toContain('onClick={() => setProdutoUiState("seletor")}');
  });

  test("todo o modal (incluindo a etapa Produtos) é responsivo — largura relativa com teto para desktop", () => {
    expect(fonte).toContain('width: "min(94vw, 640px)"');
  });
});

describe("NovoPedidoManual — etapa final de revisão", () => {
  test("a etapa Revisar mostra cliente, produtos, entrega e pagamento, cada um em card inteiro clicável com um único lápis", () => {
    const etapaRevisar = fonte.slice(fonte.indexOf('passo === "revisar" && ('), fonte.indexOf("{/* Rodapé"));
    expect(etapaRevisar).toContain('irParaPasso("cliente")');
    expect(etapaRevisar).toContain('irParaPasso("produtos")');
    expect(etapaRevisar).toContain('irParaPasso("entrega")');
    expect(etapaRevisar).toContain('irParaPasso("pagamento")');
    expect(etapaRevisar).toContain("Resumo");
    expect(etapaRevisar.match(/<CardRevisao/g)?.length).toBe(4);
  });

  test("CardRevisao é inteiro clicável e mostra um único ícone de lápis", () => {
    expect(fonte).toContain("function CardRevisao(");
    expect(fonte).toContain("<Pencil size={14}");
  });

  test("o botão final 'Criar pedido' só existe na etapa Revisar e chama enviar()", () => {
    const ocorrencias = [...fonte.matchAll(/Criar pedido/g)];
    expect(ocorrencias.length).toBeGreaterThan(0);
    expect(fonte).toContain("function irParaProximoPasso()");
    expect(fonte).toContain('if (passo === "revisar") { enviar(); return }');
  });

  test("clique duplo é bloqueado e o progresso de envio é visível", () => {
    expect(fonte).toContain("if (enviando || pendencias.length > 0 || identificadorTentativaFalhou) return");
    expect(fonte).toContain("Criando pedido…");
  });
});

describe("NovoPedidoManual — teclado, foco e responsividade", () => {
  test("inputs e cards selecionáveis têm estado de foco visível via CSS", () => {
    expect(fonte).toContain(".pm-input:focus-visible, .pm-input:focus {");
  });

  test("o modal principal é responsivo (largura relativa, com teto para desktop)", () => {
    expect(fonte).toContain('width: "min(94vw, 640px)"');
  });

  test("respeita prefers-reduced-motion no indicador de carregamento", () => {
    expect(fonte).toContain("@media (prefers-reduced-motion: reduce)");
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
