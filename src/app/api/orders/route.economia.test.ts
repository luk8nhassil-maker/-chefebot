import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8");
const getRoute = fonte.slice(fonte.indexOf("export async function GET"), fonte.indexOf("type ResultadoAplicarStatus"));

describe("GET /api/orders — leitura econômica com escrita protegida", () => {
  test("faz leitura direta primeiro e só entra no mutex quando há limpeza real a persistir", () => {
    // A leitura continua FORA do mutex global (caminho quente e barato). O
    // envelope lerComRetry só repete a MESMA leitura quando o datastore falha
    // de forma transitória — não introduz lock nem escrita.
    expect(getRoute).toContain("lerComRetry(() => redis.get<Pedido[]>('pedidos')");
    expect(getRoute).toContain("const limpezaInicial = limparPedidosExpirados(snapshotPedidos)");
    expect(getRoute).toContain("if (limpezaInicial.mudou)");
    expect(getRoute).toContain("mutarPedidos<Pedido, Pedido[]>");
  });

  test("a retentativa cobre SÓ a leitura — repetir escrita duplicaria pedido", () => {
    const inicioRetry = getRoute.indexOf("lerComRetry(");
    expect(inicioRetry).toBeGreaterThan(-1);
    const trechoRetry = getRoute.slice(inicioRetry, getRoute.indexOf("const limpezaInicial"));
    expect(trechoRetry).not.toContain("redis.set");
    expect(trechoRetry).not.toContain("mutarPedidos");
    // E a leitura repetida acontece antes de qualquer aquisição de mutex.
    expect(inicioRetry).toBeLessThan(getRoute.indexOf("mutarPedidos<Pedido, Pedido[]>"));
  });

  test("não remove o mutex do caminho de escrita da limpeza preguiçosa", () => {
    expect(getRoute).toContain("persistir: true");
    expect(getRoute).toContain("pedidos: limpezaAtual.pedidos");
  });
});
