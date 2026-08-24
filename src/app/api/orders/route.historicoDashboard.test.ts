import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8");

describe("/api/orders — histórico do Dashboard", () => {
  test("historico=true devolve ativos e arquivados pela mesma rota autenticada", () => {
    expect(fonte).toContain("const incluirHistorico = url.searchParams.get('historico') === 'true'");
    expect(fonte).toContain("if (incluirHistorico)");
    expect(fonte).toContain("[...pedidosPainel].reverse().map(sanitizarPedidoPixResposta).map(sanitizarPedidoParaPainel)");
  });

  test("limpar histórico sem id arquiva entregues em vez de apagá-los", () => {
    const deleteInicio = fonte.indexOf("export async function DELETE")
    const blocoDelete = fonte.slice(deleteInicio)
    expect(blocoDelete).not.toContain("pedidosFrescos.filter(p => p.status !== 'entregue')")
    expect(blocoDelete).toContain("p.status !== 'entregue' || p.isArchived")
    expect(blocoDelete).toContain("isArchived: true")
    expect(blocoDelete).toContain("archivedReason: 'limpar_historico'")
  });

  test("exclusão explícita por id continua disponível sem ampliar escopo", () => {
    const deleteInicio = fonte.indexOf("export async function DELETE")
    const blocoDelete = fonte.slice(deleteInicio)
    expect(blocoDelete).toContain("pedidosFrescos.filter(p => p.id !== id)")
  });
});
