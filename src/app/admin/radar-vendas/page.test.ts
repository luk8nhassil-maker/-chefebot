import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin/radar-vendas — jornada do dono", () => {
  test("permanece dentro do painel de gestão", () => {
    expect(fonte).toContain('import PanelShell from "@/components/PanelShell"');
    expect(fonte).toContain("showGestaoNav");
    expect(fonte).toContain("Radar de Vendas 2.1");
  });

  test("mantém ativação paga e indicação como alternativas visíveis", () => {
    expect(fonte).toContain("Ativar Radar e ver oportunidades");
    expect(fonte).toContain("Desbloquear indicando uma pizzaria");
    expect(fonte).toContain("pizzaria indicada vira cliente pagante confirmado");
  });

  test("não promete receita garantida", () => {
    expect(fonte).toContain("não é receita garantida");
    expect(fonte).toContain("não uma promessa de venda");
  });
});
