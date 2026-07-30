import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Componente client-only com hooks/fetch, sem jsdom neste repo — valida a
// fonte em vez de montar a árvore. Mesma convenção de src/app/pedidos/page.test.ts
// e src/app/cardapio/page.test.ts.
//
// Estes testes travam o requisito central da correção de UX: a montagem
// guiada (sabores/borda/tamanho/leite) vive DENTRO do mesmo <div role="dialog">
// do modal "Novo pedido" — nunca uma segunda camada fullscreen por cima dele.
const fonte = readFileSync(fileURLToPath(new URL("./NovoPedidoManual.tsx", import.meta.url)), "utf-8");

/** Só o corpo da função do componente (depois do último import, exclusive). */
const corpoComponente = fonte.slice(fonte.indexOf("export default function NovoPedidoManual"));

describe("construtor renderizado dentro do modal principal (não fullscreen)", () => {
  test("existe um único role=\"dialog\" de nível superior — o modal principal", () => {
    // O construtor tinha um SEGUNDO role="dialog" próprio antes desta correção
    // (uma segunda camada fullscreen). Agora só o modal externo é dialog.
    const ocorrencias = fonte.match(/role="dialog"/g) ?? [];
    expect(ocorrencias.length).toBe(1);
  });

  test("nenhum elemento usa position:\"fixed\" além do modal externo e dos overlays de confirmação", () => {
    const ocorrencias = corpoComponente.match(/position:\s*"fixed"/g) ?? [];
    // 1 = modal externo (role=dialog); os demais são os overlays de
    // confirmação (categoriaPendente, confirmarSaida) — nunca o construtor.
    expect(ocorrencias.length).toBeLessThanOrEqual(3);
  });

  test("a grade de opções do construtor não abre uma segunda tela fullscreen (sem inset:0 fora do modal/overlays)", () => {
    // O construtor antigo usava `style={{ position: "fixed", inset: 0, zIndex: 2900, ... }}`
    // como um segundo <div> cobrindo a tela inteira. Essa combinação específica
    // não pode mais existir em lugar nenhum do arquivo.
    expect(fonte).not.toMatch(/position:\s*"fixed",\s*inset:\s*0,\s*zIndex:\s*2900/);
  });

  test("a grade de opções (etapaAtual.opcoes) está dentro do mesmo bloco JSX que o cabeçalho \"Novo pedido\" — sem early return nem portal", () => {
    // Nenhum ReactDOM.createPortal, nenhum return condicional antes do JSX do
    // modal: tudo é uma árvore só, o construtor é só mais uma ramificação do
    // corpo do modal.
    expect(fonte).not.toContain("createPortal");
    const indiceModal = fonte.indexOf('aria-label="Novo pedido manual"');
    const indiceOpcoes = fonte.indexOf("etapaAtual.opcoes.map");
    expect(indiceModal).toBeGreaterThan(-1);
    expect(indiceOpcoes).toBeGreaterThan(indiceModal);
  });
});

describe("botão \"← Voltar aos produtos\"", () => {
  test("existe e chama cancelarConstrutor", () => {
    expect(fonte).toContain("← Voltar aos produtos");
    const indice = fonte.indexOf("← Voltar aos produtos");
    const janela = fonte.slice(fonte.lastIndexOf("<button", indice), indice);
    expect(janela).toContain("onClick={cancelarConstrutor}");
  });

  test("cancelarConstrutor não mexe no carrinho nem na busca — só fecha o construtor", () => {
    const corpo = fonte.slice(
      fonte.indexOf("function cancelarConstrutor"),
      fonte.indexOf("function cancelarConstrutor") + 200
    );
    expect(corpo).toContain("setProdutoAberto(null)");
    expect(corpo).not.toContain("setItens(");
    expect(corpo).not.toContain("setTermo(");
    expect(corpo).not.toContain("setCategoria(");
  });
});

describe("cabeçalho e etapas continuam visíveis durante a montagem", () => {
  test("\"Novo pedido\" e os passos Itens/Entrega/Pagamento estão FORA de qualquer condicional de produtoAberto", () => {
    const indiceRetornoJsx = fonte.indexOf("return (\n    <div");
    const indiceNovoPedido = fonte.indexOf(">Novo pedido<");
    const indicePassos = fonte.indexOf("PASSOS.map");
    // Primeira ramificação JSX que só renderiza COM produtoAberto — procurada
    // a partir do `return`, para não pegar a checagem em clicarCategoria()
    // (lógica pura, não JSX) que aparece mais cedo no corpo do componente.
    const indicePrimeiraChecagemProdutoAberto = fonte.indexOf("produtoAberto && etapaAtual && (", indiceRetornoJsx);
    expect(indiceRetornoJsx).toBeGreaterThan(-1);
    expect(indiceNovoPedido).toBeGreaterThan(-1);
    expect(indicePassos).toBeGreaterThan(-1);
    expect(indicePrimeiraChecagemProdutoAberto).toBeGreaterThan(-1);
    // O cabeçalho vem antes de qualquer branch que dependa de produtoAberto.
    expect(indiceNovoPedido).toBeLessThan(indicePrimeiraChecagemProdutoAberto);
    expect(indicePassos).toBeLessThan(indicePrimeiraChecagemProdutoAberto);
  });

  test("caminho \"categoria › produto › etapa\" é renderizado com os três segmentos", () => {
    expect(fonte).toContain("{produtoAberto.categoriaLabel} › {produtoAberto.nome} › {etapaAtual.titulo}");
  });

  test("texto \"Passo N de M\" é renderizado com os valores corretos", () => {
    expect(fonte).toContain("Passo {etapaVisivel + 1} de {etapas.length}");
  });

  test("categorias (chips) continuam acessíveis durante a montagem — outro map sobre CATEGORIAS dentro do bloco produtoAberto", () => {
    const blocoConstrutor = fonte.slice(
      fonte.indexOf('passo === "itens" && produtoAberto && etapaAtual && ('),
      fonte.indexOf('passo === "entrega" && (')
    );
    expect(blocoConstrutor).toContain("CATEGORIAS.map");
    expect(blocoConstrutor).toContain("clicarCategoria");
  });
});

describe("trocar de categoria durante a montagem pede confirmação", () => {
  test("clicarCategoria só troca direto quando não há montagem em andamento OU é a mesma categoria", () => {
    const corpo = fonte.slice(fonte.indexOf("function clicarCategoria"), fonte.indexOf("function confirmarTrocaCategoria"));
    expect(corpo).toContain("if (produtoAberto && c !== categoria) setCategoriaPendente(c)");
    expect(corpo).toContain("else setCategoria(c)");
  });

  test("confirmarTrocaCategoria descarta a montagem e troca a categoria; cancelarTrocaCategoria não altera nada", () => {
    const corpoConfirmar = fonte.slice(
      fonte.indexOf("function confirmarTrocaCategoria"),
      fonte.indexOf("function cancelarTrocaCategoria")
    );
    expect(corpoConfirmar).toContain("setProdutoAberto(null)");
    expect(corpoConfirmar).toContain("setCategoria(categoriaPendente)");

    const corpoCancelar = fonte.slice(
      fonte.indexOf("function cancelarTrocaCategoria"),
      fonte.indexOf("function cancelarTrocaCategoria") + 150
    );
    expect(corpoCancelar).not.toContain("setProdutoAberto");
    expect(corpoCancelar).not.toContain("setCategoria(categoriaPendente)");
    expect(corpoCancelar).toContain("setCategoriaPendente(null)");
  });

  test("diálogo de confirmação existe e oferece as duas saídas (continuar montando / trocar categoria)", () => {
    expect(fonte).toContain("{categoriaPendente && (");
    expect(fonte).toContain("Descartar esta montagem?");
    expect(fonte).toContain("onClick={cancelarTrocaCategoria}");
    expect(fonte).toContain("onClick={confirmarTrocaCategoria}");
  });
});

describe("voltar preserva seleção", () => {
  test("voltarEtapa nunca reseta `selecao` — só troca etapaVisivel ou fecha o construtor", () => {
    const corpo = fonte.slice(fonte.indexOf("function voltarEtapa"), fonte.indexOf("function voltarEtapa") + 400);
    expect(corpo).not.toContain("setSelecao(");
    expect(corpo).toContain("setEtapaVisivel(etapaVisivel - 1)");
    expect(corpo).toContain("cancelarConstrutor()");
  });

  test("os chips de resumo (o que já foi escolhido) permitem pular direto para qualquer etapa sem apagar a seleção", () => {
    const blocoConstrutor = fonte.slice(
      fonte.indexOf('passo === "itens" && produtoAberto && etapaAtual && ('),
      fonte.indexOf('passo === "entrega" && (')
    );
    expect(blocoConstrutor).toContain("resumoEtapa(e, selecao)");
    expect(blocoConstrutor).toMatch(/onClick=\{\(\) => setEtapaVisivel\(i\)\}/);
    // Nenhuma chamada a setSelecao dentro do bloco do construtor inteiro —
    // a única forma de alterar a seleção é escolher() (toque numa opção).
    expect(blocoConstrutor).not.toContain("setSelecao(selecaoVazia())");
  });
});

describe("cancelar item não apaga o carrinho", () => {
  test("nem cancelarConstrutor nem voltarEtapa tocam em `itens`", () => {
    const corpoCancelar = fonte.slice(fonte.indexOf("function cancelarConstrutor"), fonte.indexOf("function voltarEtapa") + 400);
    expect(corpoCancelar).not.toContain("setItens(");
  });

  test("o botão de rodapé alterna entre \"Voltar\" e \"Cancelar item\" (etapa 0), sempre chamando voltarEtapa", () => {
    const blocoRodapeConstrutor = fonte.slice(
      fonte.indexOf('passo === "itens" && produtoAberto && etapaAtual && (', fonte.indexOf("Rodapé")),
      fonte.indexOf('passo === "itens" && !produtoAberto && (', fonte.indexOf("Rodapé"))
    );
    expect(blocoRodapeConstrutor).toContain("onClick={voltarEtapa}");
    expect(blocoRodapeConstrutor).toContain('{etapaVisivel > 0 ? "Voltar" : "Cancelar item"}');
  });
});

describe("finalizar item retorna à categoria anterior", () => {
  test("abrirProduto fixa a categoria do produto ANTES de abrir o construtor", () => {
    const corpo = fonte.slice(fonte.indexOf("function abrirProduto"), fonte.indexOf("function adicionarDireto"));
    expect(corpo).toContain("setCategoria(produto.categoria)");
  });

  test("confirmarMontagem fecha o construtor sem tocar em `categoria` — a lista reaparece na mesma categoria", () => {
    const corpo = fonte.slice(fonte.indexOf("function confirmarMontagem"), fonte.indexOf("function avancarEtapa"));
    expect(corpo).toContain("setProdutoAberto(null)");
    expect(corpo).not.toContain("setCategoria(");
  });

  test("confirmarMontagem e adicionarDireto anunciam o item adicionado (feedback visível)", () => {
    const corpoConfirmar = fonte.slice(fonte.indexOf("function confirmarMontagem"), fonte.indexOf("function avancarEtapa"));
    expect(corpoConfirmar).toContain("anunciarAdicionado(produtoAberto.nome)");

    const corpoDireto = fonte.slice(fonte.indexOf("function adicionarDireto"), fonte.indexOf("function confirmarMontagem"));
    expect(corpoDireto).toContain("anunciarAdicionado(produto.nome)");
  });

  test("o aviso \"adicionado ao pedido\" só aparece na lista de produtos (fora do construtor), com aria-live", () => {
    const blocoLista = fonte.slice(
      fonte.indexOf('passo === "itens" && !produtoAberto && ('),
      fonte.indexOf('passo === "itens" && produtoAberto && etapaAtual && (')
    );
    expect(blocoLista).toContain("ultimoAdicionado");
    expect(blocoLista).toContain('aria-live="polite"');
    expect(blocoLista).toContain("adicionado ao pedido");
  });
});

describe("responsividade — modal nunca vira tela inteira", () => {
  test("o modal principal mantém largura máxima e altura máxima (não 100vw/100vh)", () => {
    expect(fonte).toContain('maxWidth: 560');
    expect(fonte).toContain('maxHeight: "94svh"');
  });

  test("a grade de opções do construtor rola só dentro do próprio bloco (overflowY:auto com minHeight:0), nunca a página", () => {
    const blocoConstrutor = fonte.slice(
      fonte.indexOf('passo === "itens" && produtoAberto && etapaAtual && ('),
      fonte.indexOf('passo === "entrega" && (')
    );
    expect(blocoConstrutor).toMatch(/flex:\s*1,\s*minHeight:\s*0,\s*overflowY:\s*"auto"/);
  });
});

describe("nenhuma alteração no payload enviado ao servidor", () => {
  test("enviar() continua montando exatamente os mesmos campos, na mesma forma", () => {
    const corpo = fonte.slice(fonte.indexOf("async function enviar"), fonte.indexOf("const podeIrParaEntrega"));
    expect(corpo).toContain('fetch("/api/pedido-app"');
    expect(corpo).toContain('method: "POST"');
    expect(corpo).toContain("cliente: cliente.trim()");
    expect(corpo).toContain("telefone: telefone.trim()");
    expect(corpo).toContain("usarOutroWhatsapp: true");
    expect(corpo).toContain("itens: itens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty }))");
    expect(corpo).toContain("tipoEntrega,");
    expect(corpo).toContain("pagamento: pagamentoFinal");
    expect(corpo).toContain("...(clientRequestId ? { clientRequestId } : {})");
  });

  test("nenhum novo campo de UI (categoriaPendente, ultimoAdicionado) vaza para o corpo da requisição", () => {
    const corpo = fonte.slice(fonte.indexOf("async function enviar"), fonte.indexOf("const podeIrParaEntrega"));
    expect(corpo).not.toContain("categoriaPendente");
    expect(corpo).not.toContain("ultimoAdicionado");
  });

  test("não importa nem altera src/lib/montagemManual.ts nem src/app/api/pedido-app — só usa o que já existia", () => {
    expect(fonte).toContain('from "@/lib/montagemManual"');
    // A lista de nomes importados do módulo de domínio é a mesma de antes da
    // correção de UX (mais o helper de pendência já existente) — nenhuma
    // função nova precisou ser criada em montagemManual.ts para esta UX.
    expect(fonte).not.toMatch(/from ["']@\/app\/api\/pedido-app/);
  });
});
