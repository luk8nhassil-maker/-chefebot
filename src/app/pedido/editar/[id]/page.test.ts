import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesma convenção de src/app/cardapio/page.test.ts: componente client-only
// com hooks/fetch, sem jsdom neste repo — valida a fonte em vez de montar a
// árvore. Cobre a integração entre a edição de pedido (main) e a
// persistência de Pix pendente (PR #205), sem alterar nenhuma regra
// financeira/de edição já validada.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const fonteSalvar = readFileSync(
  fileURLToPath(new URL("../../../api/pedido-app/[id]/editar/salvar/route.ts", import.meta.url)),
  "utf-8"
);
const fonteDescartar = readFileSync(
  fileURLToPath(new URL("../../../api/pedido-app/[id]/editar/descartar/route.ts", import.meta.url)),
  "utf-8"
);

describe("/pedido/editar/[id] — integração com Pix pendente (não deve interferir)", () => {
  test("[caso 2] nunca lê/escreve a referência local de Pix pendente (cf_pix_pendente) — não perde nem duplica nada", () => {
    expect(fonte).not.toContain("cf_pix_pendente");
    expect(fonte).not.toContain("pixPendenteLocal");
    expect(fonte).not.toContain("salvarReferenciaPixPendente");
    expect(fonte).not.toContain("limparReferenciaPixPendente");
  });

  test("[caso 3] não renderiza PixPendenteBar — a barra nunca aparece (nem duplicada) na tela de edição", () => {
    expect(fonte).not.toContain("PixPendenteBar");
    expect(fonte).not.toContain("usePixPendente");
  });

  test("[caso 4] não renderiza ClientBottomNav — nada fixo na base pode cobrir os CTAs de Salvar/Descartar", () => {
    expect(fonte).not.toContain("ClientBottomNav");
  });

  test("CTAs de salvar e descartar existem nesta tela (para o caso 4 fazer sentido)", () => {
    expect(fonte).toContain("Salvar alterações");
    expect(fonte).toContain("Descartar alterações");
  });
});

describe("POST /api/pedido-app/[id]/editar/salvar — [caso 5] nunca cria uma segunda referência Pix", () => {
  test("statusToken do pedido nunca é regenerado ao salvar (mesmo token antes/depois)", () => {
    // A resposta devolve sempre atualizado.statusToken (o mesmo já validado
    // no início da rota), nunca um token novo — a referência local
    // (pedidoId+statusToken) salva na criação do pedido continua válida.
    expect(fonteSalvar).toContain("statusToken: atualizado.statusToken");
    expect(fonteSalvar).not.toMatch(/statusToken:\s*criarTokenPublico/i);
    expect(fonteSalvar).not.toContain("randomUUID()");
  });

  test("quando o pagamento muda para/continua Pix, reaproveita criarPixMetadata/prepararPixProviderMercadoPago já validados — nunca uma segunda lógica de cobrança", () => {
    // `pagamento` é a forma canônica de body.pagamento, normalizada no início
    // da rota (ver src/lib/pagamentoComposto.ts) — a cobrança é montada a
    // partir dela, nunca da string crua enviada pelo cliente.
    expect(fonteSalvar).toContain("criarPixMetadata(id, pagamento, total)");
    expect(fonteSalvar).toContain("prepararPixProviderMercadoPago(");
  });

  test("a forma de pagamento usada na cobrança é a canônica, nunca a string crua do cliente", () => {
    expect(fonteSalvar).toContain("normalizarPagamentoComposto(body.pagamento.trim())");
    expect(fonteSalvar).not.toContain("criarPixMetadata(id, body.pagamento");
  });

  test("a soma de um pagamento composto é revalidada contra o total recalculado", () => {
    expect(fonteSalvar).toContain("pagamentoAindaValido(pagamento, total)");
  });
});

describe("POST /api/pedido-app/[id]/editar/descartar — [caso 6] mantém o pagamento original recuperável", () => {
  test("nunca toca no campo pix nem gera uma nova cobrança ao descartar", () => {
    expect(fonteDescartar).not.toContain(".pix");
    expect(fonteDescartar).not.toContain("criarPixMetadata");
    expect(fonteDescartar).not.toContain("prepararPixProviderMercadoPago");
  });

  test("statusToken do pedido é só validado (nunca regenerado) ao descartar", () => {
    expect(fonteDescartar).not.toMatch(/statusToken:\s*criarTokenPublico/i);
    expect(fonteDescartar).not.toContain("randomUUID()");
  });
});

describe("/pedido/editar/[id] — REGRESSÃO (auditoria independente, ciclo de autoauditoria pós-9ª rodada): aba Calzone do modal 'Adicionar item' usa a lista EFETIVA de sabores do catálogo oficial, nunca a lista cheia da pizza incondicionalmente", () => {
  // Mesma classe de bug já corrigida no Cardápio Público e no Pedido
  // Manual/Salão: esta tela (admin, edição de um pedido já feito) monta o
  // item do Calzone 100% pelo caminho legado (name/detail, sem
  // simpleSelection) — o servidor (officialUnitPrice, em
  // .../editar/salvar) já recusa um sabor fora da lista efetiva mesmo sem
  // esta correção, mas o modal mostrava TODOS os sabores da pizza
  // incondicionalmente, deixando o admin escolher uma opção que o servidor
  // sempre rejeitaria ao salvar.
  test("calzoneFlavorNames vem de menu.catalog (produto.flavors), só cai para a lista cheia da pizza quando o catálogo está genuinamente ausente", () => {
    expect(fonte).toContain(
      "const calzoneFlavorNames = menu.catalog\n" +
      "    ? menu.catalog.lanches.find((l) => l.name === calzoneItem?.name)?.flavors?.map((f) => f.name) ?? []\n" +
      "    : flavors;"
    );
  });

  test("a aba calzone do modal renderiza a partir de calzoneFlavorNames, não da lista cheia `flavors` (que continua servindo só a aba pizza)", () => {
    const abaCalzone = fonte.slice(fonte.indexOf('{aba === "calzone"'), fonte.indexOf('{aba === "calzone"') + 600);
    expect(abaCalzone).toContain("calzoneFlavorNames.map((f) =>");
    expect(abaCalzone).not.toContain("flavors.map((f) =>");
  });

  test("REGRESSÃO (auditoria independente, 2º ciclo de autoauditoria) — a decisão é pela presença GENUÍNA de `menu.catalog`, nunca pelo resultado do `.find` (catálogo presente + Calzone ausente nunca cai para a lista legada)", () => {
    // Antes desta correção, a condição era `calzoneCatalogProduto ? ... :
    // flavors` — o RESULTADO do `.find`, que também dá undefined quando o
    // catálogo está presente mas não contém o Calzone (catálogo
    // dessincronizado/malformado). Agora a condição é `menu.catalog ? ... :
    // flavors` — só a ausência genuína do campo autoriza a lista legada.
    expect(fonte).not.toContain("calzoneCatalogProduto");
  });
});
