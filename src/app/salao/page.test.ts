import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesmo padrao dos demais page.test.ts do repo (ver src/app/admin/page.test.ts):
// sem jsdom/testing-library, requisitos garantidos estruturalmente na fonte.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/salao — comanda enviada abre a tela de rodadas, não o construtor da Rodada 1", () => {
  test("ComandaEnviadaCard fica clicável e abre a comanda (onAbrir)", () => {
    const bloco = fonte.slice(fonte.indexOf("function ComandaEnviadaCard"), fonte.indexOf("function RodadasView"));
    expect(bloco).toContain("onAbrir");
    expect(bloco).toContain("onClick={onAbrir}");
  });

  test("status 'aberta' abre ComandaBuilder (Rodada 1, fluxo intocado); status 'enviada' abre RodadasView", () => {
    const bloco = fonte.slice(fonte.indexOf("if (comandaAtiva && menu) {"), fonte.indexOf("return (\n    <div style={{ minHeight"));
    expect(bloco).toContain('comandaAtiva.status === "aberta"');
    expect(bloco).toContain("<ComandaBuilder");
    expect(bloco).toContain('comandaAtiva.status === "enviada"');
    expect(bloco).toContain("<RodadasView");
  });
});

describe("/salao — 'Adicionar nova rodada'", () => {
  test("o botão só aparece quando não existe rodada em rascunho", () => {
    const bloco = fonte.slice(fonte.indexOf("function RodadasView"), fonte.indexOf("function RodadaEnviadaCard"));
    expect(bloco).toContain("!rodadaRascunho &&");
    expect(bloco).toContain("+ Adicionar nova rodada");
  });

  test("trava de clique duplo (mesmo padrão de src/app/configuracoes/page.tsx)", () => {
    const bloco = fonte.slice(fonte.indexOf("async function adicionarNovaRodada"), fonte.indexOf("function RodadaEnviadaCard"));
    expect(bloco).toContain("if (criandoRef.current) return");
    expect(bloco).toContain("criandoRef.current = true");
    expect(bloco).toContain("criandoRef.current = false");
  });

  test("usa clientRequestId (gerarClientRequestId), reaproveitado entre tentativas — nunca regenerado a cada clique", () => {
    const bloco = fonte.slice(fonte.indexOf("async function adicionarNovaRodada"), fonte.indexOf("function RodadaEnviadaCard"));
    expect(bloco).toContain("clientRequestIdRef");
    expect(bloco).toContain("if (!clientRequestIdRef.current) clientRequestIdRef.current = gerarClientRequestId()");
  });

  test("chama a rota dedicada de criação de rodada, não a rota de itens da Rodada 1", () => {
    const bloco = fonte.slice(fonte.indexOf("async function adicionarNovaRodada"), fonte.indexOf("function RodadaEnviadaCard"));
    expect(bloco).toContain("fetch(`/api/salao/comandas/${comanda.id}/rodadas`");
  });
});

describe("/salao — Rodada 2 em rascunho", () => {
  test("adicionar/alterar quantidade/remover itens sempre grava na rota da rodada específica (nunca na rota raiz da comanda)", () => {
    const bloco = fonte.slice(fonte.indexOf("function RodadaRascunhoCard"), fonte.indexOf("function EnviarPedidoModal"));
    expect(bloco).toContain("fetch(`/api/salao/comandas/${comandaId}/rodadas/${rodada.id}`");
    expect(bloco).not.toMatch(/fetch\(`\/api\/salao\/comandas\/\$\{comandaId\}`/);
  });

  test("preço nunca é enviado como autoridade — só kind/name/detail/price/qty do estado local, revalidado no servidor", () => {
    const bloco = fonte.slice(fonte.indexOf("const salvar = useCallback"), fonte.indexOf("const [produtoAberto, setProdutoAberto] = useState<ProdutoManual | null>(null)\n  const [selecao, setSelecao] = useState<SelecaoMontagem>(selecaoVazia())\n  const [etapaVisivel, setEtapaVisivel] = useState(0)\n  const etapas = useMemo(() => (produtoAberto ? montarEtapas(produtoAberto, menu) : []), [produtoAberto, menu])\n  const etapaAtual = etapas[etapaVisivel]\n  const bloqueio = motivoBloqueio(etapaAtual, selecao)\n  const completa = montagemCompleta(etapas, selecao)\n\n  function abrirProduto"));
    expect(bloco).toContain("kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty");
  });

  test("não existe botão/texto de enviar a Rodada 2 para a cozinha — só o aviso de que isso vem na próxima etapa", () => {
    const bloco = fonte.slice(fonte.indexOf("function RodadaRascunhoCard"), fonte.indexOf("function EnviarPedidoModal"));
    expect(bloco).not.toContain("Enviar pedido");
    expect(bloco).not.toContain("/enviar");
    expect(bloco).toContain("Você poderá enviar esta rodada para a cozinha na próxima etapa.");
  });

  test("usa o mesmo seletor oficial de produtos (montagemManual) — categorias e busca reaproveitadas", () => {
    const bloco = fonte.slice(fonte.indexOf("function RodadaRascunhoCard"), fonte.indexOf("function EnviarPedidoModal"));
    expect(bloco).toContain("listarProdutosManuais(menu)");
    expect(bloco).toContain("buscarProdutos(produtos, termo");
    expect(bloco).toContain("CATEGORIAS.map");
  });

  test("permite quantidade, remoção e mostra o subtotal da rodada", () => {
    const bloco = fonte.slice(fonte.indexOf("function RodadaRascunhoCard"), fonte.indexOf("function EnviarPedidoModal"));
    expect(bloco).toContain("function mudarQuantidade");
    expect(bloco).toContain("function removerItem");
    expect(bloco).toContain("Subtotal da rodada");
  });
});

describe("/salao — Rodada 1 (enviada) permanece somente leitura na tela de rodadas", () => {
  test("RodadaEnviadaCard não tem nenhum input/botão de edição de itens", () => {
    const bloco = fonte.slice(fonte.indexOf("function RodadaEnviadaCard"), fonte.indexOf("function RodadaRascunhoCard"));
    expect(bloco).not.toContain("onClick");
    expect(bloco).not.toContain("<input");
  });
});

describe("/salao — total parcial soma todas as rodadas", () => {
  test("RodadasView calcula/usa totalParcial a partir de todas as rodadas", () => {
    const bloco = fonte.slice(fonte.indexOf("function RodadasView"), fonte.indexOf("function RodadaEnviadaCard"));
    expect(bloco).toContain("comanda.totalParcial ?? rodadas.reduce((s, r) => s + r.subtotal, 0)");
    expect(bloco).toContain("Total parcial");
  });
});
