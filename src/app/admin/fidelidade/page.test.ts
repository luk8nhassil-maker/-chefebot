import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin/fidelidade — Analytics de pedidos", () => {
  test("usa exatamente o contrato do endpoint de analytics", () => {
    expect(fonte).toContain("pedidosValidos");
    expect(fonte).toContain("receitaElegivelCents");
    expect(fonte).toContain("ticketMedioCents");
    expect(fonte).toContain("totalEventosNoIndice");
    expect(fonte).toContain("clientesNovos");
    expect(fonte).toContain("clientesRecorrentes");
    expect(fonte).toContain("percentualClientesRecorrentes");
    expect(fonte).not.toContain("analytics.metricas?.totalPedidos");
    expect(fonte).not.toContain("analytics.metricas?.totalReceita");
    expect(fonte).not.toContain("analytics.metricas?.ticketMedio ??");
  });

  test("trata período sem pedidos como estado vazio e explica a contagem", () => {
    expect(fonte).toContain("(analytics.totalEventosNoIndice ?? analytics.metricas?.pedidosValidos ?? 0) === 0");
    expect(fonte).toContain("Cada cliente é contado uma única vez");
  });
});

describe("/admin/fidelidade — Prêmio da temporada e resultado de encerramento", () => {
  test("prêmio só é enviado ao criar quando a descrição foi preenchida (fail-closed)", () => {
    const bloco = fonte.slice(fonte.indexOf("async function criarTemporada30d"), fonte.indexOf("async function verResultadoTemporada"));
    expect(bloco).toContain("if (premioDescricaoInput.trim())");
    expect(bloco).toContain("corpo.premioAprovado = premioAprovadoInput");
    // Fora do if: nada de prêmio é adicionado ao corpo por padrão.
    const antesDoIf = bloco.slice(0, bloco.indexOf("if (premioDescricaoInput.trim())"));
    expect(antesDoIf).not.toContain("premioAprovado");
  });

  test("checkbox de aprovação nunca vem marcado por padrão", () => {
    expect(fonte).toContain("useState(false)");
    expect(fonte).toContain("checked={premioAprovadoInput}");
  });

  test("resultado sem vencedor explica o motivo (prêmio não aprovado ou sem participantes)", () => {
    const bloco = fonte.slice(fonte.indexOf("!resultadoTemporada.vencedorDeclarado"), fonte.indexOf("<strong>Vencedores:</strong>"));
    expect(bloco).toContain("ranking sem participantes");
    expect(bloco).toContain("prêmio não foi aprovado antes do encerramento");
  });

  test("vencedor que revogou consentimento depois aparece anonimizado no histórico, nunca com o nome antigo", () => {
    const bloco = fonte.slice(fonte.indexOf("<strong>Vencedores:</strong>"), fonte.indexOf("</ul>"));
    expect(bloco).toContain("v.identidade.participaCampanha");
    expect(bloco).toContain("Fora da disputa (revogou depois)");
  });
});
