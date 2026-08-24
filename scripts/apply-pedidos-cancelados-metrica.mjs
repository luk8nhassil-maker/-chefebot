import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Trecho não encontrado: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Trecho duplicado inesperado: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function patchPage() {
  const path = "src/app/pedidos/page.tsx";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    'import { calcularMediaPreparoMinutos, contarPizzasVendidas } from "@/lib/pedidosMetricas"',
    'import { calcularMediaPreparoMinutos, contarPedidosOperacionais, contarPizzasVendidas } from "@/lib/pedidosMetricas"',
    "import métricas",
  );

  source = replaceOnce(
    source,
    "  const totalPedidos = pedidos.length",
    "  const totalPedidos = contarPedidosOperacionais(pedidos)",
    "total de pedidos",
  );

  writeFileSync(path, source);
}

function patchMetricas() {
  const path = "src/lib/pedidosMetricas.ts";
  let source = readFileSync(path, "utf8");

  const marker = `/**\n * Pizzas pagas mantidas no expediente atual. Pedido cancelado não entra no\n * total. A janela temporal continua sendo a mesma lista oficial carregada\n * pelo painel; esta função não inventa uma segunda regra de data.\n */\nexport function contarPizzasVendidas`;

  const helper = `/**\n * Total exibido no card \"Pedidos\" do painel operacional.\n *\n * O total precisa ser reconciliável com as etapas visíveis (Novo, Fazendo,\n * Na rua e Entregue). Cancelado continua preservado no histórico, mas não\n * representa um pedido vendido/operacional e, portanto, não entra no card.\n */\nexport function contarPedidosOperacionais(pedidos: PedidoParaMetricas[]): number {\n  if (!Array.isArray(pedidos)) return 0\n  return pedidos.filter((pedido) => pedido?.status !== \"cancelado\").length\n}\n\n/**\n * Pizzas pagas mantidas no expediente atual. Pedido cancelado não entra no\n * total. A janela temporal continua sendo a mesma lista oficial carregada\n * pelo painel; esta função não inventa uma segunda regra de data.\n */\nexport function contarPizzasVendidas`;

  source = replaceOnce(source, marker, helper, "helper de pedidos operacionais");
  writeFileSync(path, source);
}

function patchMetricasTest() {
  const path = "src/lib/pedidosMetricas.test.ts";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    "  calcularMediaPreparoMinutos,\n  contarPizzasDoPedido,",
    "  calcularMediaPreparoMinutos,\n  contarPedidosOperacionais,\n  contarPizzasDoPedido,",
    "import do helper",
  );

  const before = `  test(\"pizzas vendidas ignora pedidos cancelados\", () => {`;
  const after = `  test(\"total de pedidos ignora cancelados e continua contando entregues\", () => {\n    expect(contarPedidosOperacionais([\n      { status: \"novo\" },\n      { status: \"em_preparo\" },\n      { status: \"saiu_entrega\" },\n      { status: \"entregue\" },\n      { status: \"cancelado\" },\n      { status: \"cancelado\" },\n    ])).toBe(4)\n    expect(contarPedidosOperacionais([{ status: \"cancelado\" }, { status: \"cancelado\" }])).toBe(0)\n  })\n\n  test(\"pizzas vendidas ignora pedidos cancelados\", () => {`;
  source = replaceOnce(source, before, after, "teste de pedidos cancelados");
  writeFileSync(path, source);
}

function patchPageTest() {
  const path = "src/app/pedidos/page.metricas.test.ts";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    '    expect(fonte).toContain("const totalPedidos = pedidos.length")',
    '    expect(fonte).toContain("const totalPedidos = contarPedidosOperacionais(pedidos)")\n    expect(fonte).not.toContain("const totalPedidos = pedidos.length")',
    "asserção da métrica total",
  );

  writeFileSync(path, source);
}

patchPage();
patchMetricas();
patchMetricasTest();
patchPageTest();
