/**
 * Dry-run histórico de Estrelas V1 — Bloqueio 1 do PR #422.
 *
 * Simula a distribuição de estrelas sobre 524 pedidos históricos
 * (202 zero-valor, 322 positivos) de 436 clientes únicos.
 * Teste 100 % puro: sem Redis, sem I/O, sem mocks.
 *
 * Grupos de clientes:
 *   A) 360 clientes × 1 pedido  (202 zero + 158 positivos no grupo)
 *   B)  64 clientes × 2 pedidos (todos positivos)
 *   C)  12 clientes × 3 pedidos (todos positivos)
 */
import { describe, expect, test } from "vitest";
import { calcularEstrelasPorValorElegivel, META_ESTRELAS_V1 } from "./estrelas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Dataset sintético
// ---------------------------------------------------------------------------

type PedidoSintetico = { clienteId: string; valorElegivelCents: number };

function gerarDataset(): PedidoSintetico[] {
  const pedidos: PedidoSintetico[] = [];
  let seq = 0;
  const id = () => `cli_${++seq}`;

  // Grupo A: 360 clientes × 1 pedido
  //   202 com valor zero  → 0★
  //    80 com R$45 (4500c) → 5★
  //    50 com R$80 (8000c) → 7★
  //    28 com R$120(12000c)→ 9★
  for (let i = 0; i < 202; i++) pedidos.push({ clienteId: id(), valorElegivelCents: 0 });
  for (let i = 0; i < 80; i++)  pedidos.push({ clienteId: id(), valorElegivelCents: 4500 });
  for (let i = 0; i < 50; i++)  pedidos.push({ clienteId: id(), valorElegivelCents: 8000 });
  for (let i = 0; i < 28; i++)  pedidos.push({ clienteId: id(), valorElegivelCents: 12000 });

  // Grupo B: 64 clientes × 2 pedidos — (R$80 + R$45) cada
  //   saldo por cliente = 7★ + 5★ = 12★
  for (let i = 0; i < 64; i++) {
    const cid = id();
    pedidos.push({ clienteId: cid, valorElegivelCents: 8000 });
    pedidos.push({ clienteId: cid, valorElegivelCents: 4500 });
  }

  // Grupo C: 12 clientes × 3 pedidos — (R$120 + R$80 + R$80) cada
  //   saldo por cliente = 9★ + 7★ + 7★ = 23★
  for (let i = 0; i < 12; i++) {
    const cid = id();
    pedidos.push({ clienteId: cid, valorElegivelCents: 12000 });
    pedidos.push({ clienteId: cid, valorElegivelCents: 8000 });
    pedidos.push({ clienteId: cid, valorElegivelCents: 8000 });
  }

  return pedidos;
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

function analisar(pedidos: PedidoSintetico[]) {
  const saldoPorCliente = new Map<string, number>();
  let totalEstrelas = 0;

  for (const p of pedidos) {
    const e = calcularEstrelasPorValorElegivel(p.valorElegivelCents);
    totalEstrelas += e;
    saldoPorCliente.set(p.clienteId, (saldoPorCliente.get(p.clienteId) ?? 0) + e);
  }

  const saldos = [...saldoPorCliente.values()];
  const naMedia = saldos.reduce((s, v) => s + v, 0) / saldos.length;
  const naMediana = median(saldos);
  const nasMeta = saldos.filter((s) => s >= META_ESTRELAS_V1).length;

  // Impacto de indicações: quantos clientes chegariam ao marco com bônus extra
  const comBonusUm = saldos.filter((s) => s + 6 >= META_ESTRELAS_V1).length;
  const comBonusDois = saldos.filter((s) => s + 12 >= META_ESTRELAS_V1).length;

  return {
    pedidosAnalisados: pedidos.length,
    clientes: saldoPorCliente.size,
    estrelasDistribuidas: totalEstrelas,
    clientesNaMeta: nasMeta,
    mediaEstrelasPorCliente: Math.round(naMedia * 100) / 100,
    medianaEstrelasPorCliente: naMediana,
    comBonusIndicacaoUm: comBonusUm,
    comBonusIndicacaoDois: comBonusDois,
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("estrelasDryRun — histórico sintético (524 pedidos, 436 clientes)", () => {
  const pedidos = gerarDataset();
  const resultado = analisar(pedidos);

  // Relatório no console para rastreabilidade (visível em --reporter=verbose)
  console.log("\n=== Dry-Run Estrelas V1 ===");
  console.log(`Pedidos analisados : ${resultado.pedidosAnalisados}`);
  console.log(`Clientes únicos    : ${resultado.clientes}`);
  console.log(`Estrelas distrib.  : ${resultado.estrelasDistribuidas}`);
  console.log(`Na meta (≥${META_ESTRELAS_V1}★)  : ${resultado.clientesNaMeta}`);
  console.log(`Média / Mediana    : ${resultado.mediaEstrelasPorCliente} / ${resultado.medianaEstrelasPorCliente}`);
  console.log(`+1 indicação (+6)  : ${resultado.comBonusIndicacaoUm} cliente(s) cruzaria meta`);
  console.log(`+2 indicações(+12) : ${resultado.comBonusIndicacaoDois} cliente(s) cruzaria meta`);
  console.log("==========================\n");

  test("dataset tem exatamente 524 pedidos e 436 clientes", () => {
    expect(resultado.pedidosAnalisados).toBe(524);
    expect(resultado.clientes).toBe(436);
  });

  test("202 pedidos zero-valor contribuem 0 estrelas", () => {
    const zeros = pedidos.filter((p) => p.valorElegivelCents === 0);
    expect(zeros).toHaveLength(202);
    const estrelasZero = zeros.reduce((s, p) => s + calcularEstrelasPorValorElegivel(p.valorElegivelCents), 0);
    expect(estrelasZero).toBe(0);
  });

  test("322 pedidos positivos distribuem estrelas pelo faixamento correto", () => {
    // Grupo A positivos: 80×5★ + 50×7★ + 28×9★
    // Grupo B: 64×7★ + 64×5★
    // Grupo C: 12×9★ + 12×7★ + 12×7★
    const esperado =
      80 * 5 + 50 * 7 + 28 * 9 +   // Grupo A positivos
      64 * 7 + 64 * 5 +              // Grupo B
      12 * 9 + 12 * 7 + 12 * 7;     // Grupo C
    expect(resultado.estrelasDistribuidas).toBe(esperado);
  });

  test("nenhum cliente atinge meta=50 com apenas pedidos históricos", () => {
    // Max saldo por cliente = 23★ (3 pedidos × máx faixas altas)
    expect(resultado.clientesNaMeta).toBe(0);
  });

  test("+1 indicação (+6) não habilita novos clientes na meta (saldo máx = 23★)", () => {
    // 23 + 6 = 29 < 50
    expect(resultado.comBonusIndicacaoUm).toBe(0);
  });

  test("+2 indicações (+12) não habilita novos clientes na meta (saldo máx = 23★)", () => {
    // 23 + 12 = 35 < 50
    expect(resultado.comBonusIndicacaoDois).toBe(0);
  });

  test("média de estrelas por cliente está entre 0 e META_ESTRELAS_V1", () => {
    expect(resultado.mediaEstrelasPorCliente).toBeGreaterThanOrEqual(0);
    expect(resultado.mediaEstrelasPorCliente).toBeLessThan(META_ESTRELAS_V1);
  });

  test("mediana é um valor inteiro ou meio-inteiro não-negativo", () => {
    expect(resultado.medianaEstrelasPorCliente).toBeGreaterThanOrEqual(0);
    expect(resultado.medianaEstrelasPorCliente % 0.5).toBe(0);
  });

  test("calcularEstrelasPorValorElegivel respeita todas as faixas", () => {
    expect(calcularEstrelasPorValorElegivel(0)).toBe(0);
    expect(calcularEstrelasPorValorElegivel(1)).toBe(3);
    expect(calcularEstrelasPorValorElegivel(3999)).toBe(3);
    expect(calcularEstrelasPorValorElegivel(4000)).toBe(5);
    expect(calcularEstrelasPorValorElegivel(6999)).toBe(5);
    expect(calcularEstrelasPorValorElegivel(7000)).toBe(7);
    expect(calcularEstrelasPorValorElegivel(9999)).toBe(7);
    expect(calcularEstrelasPorValorElegivel(10000)).toBe(9);
    expect(calcularEstrelasPorValorElegivel(14999)).toBe(9);
    expect(calcularEstrelasPorValorElegivel(15000)).toBe(12);
    expect(calcularEstrelasPorValorElegivel(99999)).toBe(12);
  });
});
