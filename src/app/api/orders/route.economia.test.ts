import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8");
const getRoute = fonte.slice(fonte.indexOf("export async function GET"), fonte.indexOf("type ResultadoAplicarStatus"));

describe("GET /api/orders — leitura econômica com escrita protegida", () => {
  test("faz leitura direta primeiro e só entra no mutex quando há limpeza real a persistir", () => {
    expect(getRoute).toContain("const snapshotPedidos = (await redis.get<Pedido[]>('pedidos')) || []");
    expect(getRoute).toContain("const limpezaInicial = limparPedidosExpirados(snapshotPedidos)");
    expect(getRoute).toContain("if (limpezaInicial.mudou)");
    expect(getRoute).toContain("mutarPedidos<Pedido, Pedido[]>");
  });

  test("não remove o mutex do caminho de escrita da limpeza preguiçosa", () => {
    expect(getRoute).toContain("persistir: true");
    expect(getRoute).toContain("pedidos: limpezaAtual.pedidos");
  });
});
