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

  test("cobre os 18 cenários obrigatórios da retenção (#445)", () => {
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

  test("cobre os 8 cenários adicionais da Gamificação V2, totalizando 26", () => {
    const idsGamificacao = [
      "status-campeao",
      "status-prata",
      "status-bronze",
      "status-elite",
      "missao-semanal-desbloqueada",
      "missao-indicacao-concluida",
      "nivel-chef",
      "gamificacao-completa",
    ];
    expect(idsGamificacao).toHaveLength(8);
    for (const id of idsGamificacao) {
      expect(client).toContain(`id: "${id}"`);
    }
  });

  test("Preview V3 (auditoria de hardening do #446): 16 cenários novos, totalizando 42, sem remover nenhum dos 26 originais", () => {
    const idsV3 = [
      "v3-selo-outro-campeao-podium",
      "v3-selo-outro-elite-pos4",
      "v3-selo-outro-elite-pos10",
      "v3-perseguindo-top10-pos11",
      "v3-coroa-sem-ameaca-config",
      "v3-coroa-ameacada",
      "v3-coroa-config-mas-folgada",
      "v3-missao-indicacao-card-incompleta",
      "v3-missao-indicacao-card-concluida",
      "v3-missao-semanal-cliente-antigo",
      "v3-nivel-progresso-parcial",
      "v3-nivel-maximo",
      "v3-movimento-recente-subiu",
      "v3-movimento-recente-desceu",
      "v3-carryover-sem-login-anterior",
      "v3-podium-selos-multiplos",
    ];
    expect(idsV3).toHaveLength(16);
    for (const id of idsV3) {
      expect(client).toContain(`id: "${id}"`);
    }
    const totalCenarios = (client.match(/^\s{2}\{\n\s{4}id: "/gm) ?? []).length;
    expect(totalCenarios).toBe(42);
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
