import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Trecho não encontrado: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Trecho duplicado inesperado: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function patchAdmin() {
  const path = "src/app/admin/page.tsx";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    "import { interpretarRespostaReset } from '@/lib/whatsappResetResposta'\n",
    "import { interpretarRespostaReset } from '@/lib/whatsappResetResposta'\nimport { filtrarPedidosPorPeriodoDashboard } from '@/lib/adminDashboardPedidos'\n",
    "import helper dashboard",
  );

  const inicioFiltro = source.indexOf("function filtraPorPeriodo(");
  const fimFiltro = source.indexOf("\nfunction calcularGraficoPico", inicioFiltro);
  if (inicioFiltro < 0 || fimFiltro < 0) throw new Error("Bloco filtraPorPeriodo não encontrado");
  source = source.slice(0, inicioFiltro) +
    "function filtraPorPeriodo(pedidos: Pedido[], periodo: Periodo, dataInicio: string, dataFim: string): Pedido[] {\n" +
    "  return filtrarPedidosPorPeriodoDashboard(pedidos, periodo, dataInicio, dataFim)\n" +
    "}\n" +
    source.slice(fimFiltro + 1);

  source = replaceOnce(
    source,
    "fetch('/api/orders').then(r => r.json()).catch(err => { console.error('Falha ao carregar pedidos:', err); return [] }),",
    "fetch('/api/orders?historico=true', { cache: 'no-store' }).then(r => r.json()).catch(err => { console.error('Falha ao carregar pedidos:', err); return [] }),",
    "fetch histórico dashboard",
  );

  source = replaceOnce(
    source,
    "const entreguesMes = Array.isArray(ped) ? ped.filter((p: any) => p.status === 'entregue').reduce((s: number, p: any) => s + (Number(p.total) || 0), 0) : 0",
    "const pedidosMes = Array.isArray(ped) ? filtrarPedidosPorPeriodoDashboard(ped, 'personalizado', `${mesAtual}-01`, `${mesAtual}-31`) : []\n      const entreguesMes = pedidosMes.filter((p: Pedido) => p.status === 'entregue').reduce((s: number, p: Pedido) => s + (Number(p.total) || 0), 0)",
    "faturamento mensal não soma histórico inteiro",
  );

  source = replaceOnce(
    source,
    "const emAndamento = (statusCounts['pendente'] || 0) + (statusCounts['em preparo'] || 0) + (statusCounts['saiu para entrega'] || 0)",
    "const emAndamento =\n    (statusCounts['novo'] || 0) +\n    (statusCounts['em_preparo'] || 0) +\n    (statusCounts['saiu_entrega'] || 0) +\n    // Compatibilidade com registros realmente antigos que usavam rótulos textuais.\n    (statusCounts['pendente'] || 0) +\n    (statusCounts['em preparo'] || 0) +\n    (statusCounts['saiu para entrega'] || 0)",
    "status em andamento",
  );

  source = replaceOnce(source, ">Pedidos hoje</p>", ">Pedidos do período</p>", "rótulo pedidos período");
  source = replaceOnce(source, ">Faturamento dia</p>", ">Faturamento do período</p>", "rótulo faturamento período");

  writeFileSync(path, source);
}

function patchOrdersRoute() {
  const path = "src/app/api/orders/route.ts";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    "  const soArquivados = url.searchParams.get('arquivados') === 'true'\n\n  if (soArquivados) {",
    "  const soArquivados = url.searchParams.get('arquivados') === 'true'\n  const incluirHistorico = url.searchParams.get('historico') === 'true'\n\n  // Dashboard/relatórios precisam enxergar o histórico ainda retido no Redis,\n  // inclusive pedidos arquivados. É somente leitura e passa pelas mesmas\n  // sanitizações da rota normal; não muda a área operacional de /pedidos.\n  if (incluirHistorico) {\n    return NextResponse.json([...pedidosPainel].reverse().map(sanitizarPedidoPixResposta).map(sanitizarPedidoParaPainel))\n  }\n\n  if (soArquivados) {",
    "GET histórico completo",
  );

  const deleteInicio = source.indexOf("export async function DELETE");
  const mutacaoInicio = source.indexOf("  await mutarPedidos<Pedido, void>", deleteInicio);
  const retornoInicio = source.indexOf("  return NextResponse.json({ ok: true })", mutacaoInicio);
  if (deleteInicio < 0 || mutacaoInicio < 0 || retornoInicio < 0) {
    throw new Error("Bloco DELETE /api/orders não encontrado");
  }

  const novaMutacao = `  await mutarPedidos<Pedido, void>((pedidosFrescos) => {\n    // Exclusão explícita por id mantém a semântica histórica da rota. O botão\n    // \"Limpar histórico\", porém, chama DELETE sem id e NUNCA mais pode apagar\n    // vendas concluídas: apenas as tira da área operacional via soft-archive.\n    if (id) {\n      return {\n        persistir: true,\n        pedidos: pedidosFrescos.filter(p => p.id !== id),\n        resultado: undefined,\n      }\n    }\n\n    const agora = new Date().toISOString()\n    let mudou = false\n    const atualizados = pedidosFrescos.map(p => {\n      if (p.status !== 'entregue' || p.isArchived) return p\n      mudou = true\n      return {\n        ...p,\n        isArchived: true,\n        archivedAt: agora,\n        archivedBy: 'manual',\n        archivedReason: 'limpar_historico',\n      }\n    })\n\n    return mudou\n      ? { persistir: true, pedidos: atualizados, resultado: undefined }\n      : { persistir: false, resultado: undefined }\n  })\n`;

  source = source.slice(0, mutacaoInicio) + novaMutacao + source.slice(retornoInicio);
  writeFileSync(path, source);
}

patchAdmin();
patchOrdersRoute();
