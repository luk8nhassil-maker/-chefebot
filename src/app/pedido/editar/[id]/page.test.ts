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
    expect(fonteSalvar).toContain("criarPixMetadata(id, body.pagamento, total)");
    expect(fonteSalvar).toContain("prepararPixProviderMercadoPago(");
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
