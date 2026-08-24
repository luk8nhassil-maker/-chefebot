import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin — histórico de pedidos", () => {
  test("dashboard carrega o histórico completo, não apenas pedidos ativos", () => {
    expect(fonte).toContain("fetch('/api/orders?historico=true')");
  });

  test("filtro de Ontem/Hoje/Semana usa a regra operacional central", () => {
    expect(fonte).toContain("filtrarPedidosPorPeriodoDashboard");
    expect(fonte).toContain("return filtrarPedidosPorPeriodoDashboard(pedidos, periodo, dataInicio, dataFim)");
    expect(fonte).not.toContain("const hojeStr = agora.toLocaleDateString('pt-BR')");
  });
});
