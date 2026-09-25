import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const client = readFileSync(fileURLToPath(new URL("./RankingRetencaoPreview.tsx", import.meta.url)), "utf-8");

describe("Preview seguro da retenção do ranking (quem já participa)", () => {
  test("fica bloqueado em producao", () => {
    expect(page).toContain('process.env.VERCEL_ENV === "production"');
    expect(page).toContain("notFound()");
  });

  test("reaproveita o componente real de produção, não uma simulação paralela", () => {
    expect(client).toContain('import { FidelidadeRankingScreen } from "@/app/cliente/FidelidadeRankingScreen"');
  });

  test("nao chama fetch nem navega de verdade — toda ação é simulada localmente", () => {
    expect(client).not.toContain("fetch(");
    expect(client).not.toContain("window.location");
    expect(client).not.toContain("/api/cliente/indicacao");
    expect(client).not.toContain("/api/cliente/ranking/evento");
  });

  test("onNovoPedido, onIndicarAmigo e onCompartilharConquista nunca chamam a implementação real", () => {
    expect(client).toContain('onNovoPedido={() => simular(');
    expect(client).toContain('onIndicarAmigo={() => simular(');
    expect(client).toContain('onCompartilharConquista={() => simular(');
    expect(client).not.toContain("compartilharIndicacao(");
    expect(client).not.toContain("compartilharConquistaRanking(");
  });

  test("cobre os 18 cenários obrigatórios", () => {
    const ids = [
      "posicao-intermediaria",
      "subiu",
      "desceu",
      "manteve",
      "sem-historico",
      "lider",
      "ultimo",
      "sozinho",
      "empate",
      "top3",
      "temporada-acabando",
      "premio-configurado",
      "sem-premio",
      "indicacao-ativa",
      "indicacao-indisponivel",
      "pos-pedido-pendente",
      "pos-pedido-creditado",
      "compartilhamento",
    ];
    expect(ids).toHaveLength(18);
    for (const id of ids) {
      expect(client).toContain(`id: "${id}"`);
    }
  });

  test("cenário 'sem prêmio' nunca promete prêmio (fail-closed)", () => {
    const bloco = client.slice(client.indexOf('id: "sem-premio"'), client.indexOf('id: "indicacao-ativa"'));
    expect(bloco).toContain("premio: null");
  });

  test("cenário de indicação indisponível não ativa Estrelas V1", () => {
    const bloco = client.slice(
      client.indexOf('id: "indicacao-indisponivel"'),
      client.indexOf('id: "pos-pedido-pendente"'),
    );
    expect(bloco).toContain("ativa: false");
  });

  test("cenário pós-pedido pendente nunca promete crédito", () => {
    const bloco = client.slice(
      client.indexOf('id: "pos-pedido-pendente"'),
      client.indexOf('id: "pos-pedido-creditado"'),
    );
    expect(bloco).toContain('estado: "pendente"');
    expect(bloco).not.toContain("estrelasGanhas");
  });
});
