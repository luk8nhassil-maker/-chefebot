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
