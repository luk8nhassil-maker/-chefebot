// Fase 10 — creditarPontosPedidoEntregue passa a usar o snapshot oficial do
// pedido (Fase 3, @/lib/pedidoSnapshot) como fonte do valor elegível quando
// presente, em vez dos campos legados total/taxaEntrega. Sem snapshot
// (WhatsApp, Salão, pedidos antigos), o cálculo legado continua idêntico.
import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

function realGet(key: string) {
  return store.has(key) ? store.get(key) : null;
}
function realSet(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
  if (opts?.nx && store.has(key)) return null;
  store.set(key, value);
  return "OK";
}
function realEval(_script: string, keys: string[], args: string[]) {
  if (keys.length === 1) {
    const [key] = keys;
    const [token] = args;
    if (store.get(key) === token) {
      store.delete(key);
      return 1;
    }
    return 0;
  }
  const [lockKey, estadoKey] = keys;
  const [token, estadoJson] = args;
  if (store.get(lockKey) === token) {
    store.set(estadoKey, JSON.parse(estadoJson as unknown as string));
    return 1;
  }
  return 0;
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => realGet(key)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => realSet(key, value, opts)),
    del: vi.fn(async (key: string) => store.delete(key)),
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => realEval(script, keys, args)),
  },
}));

import {
  creditarPontosPedidoEntregue,
  calcularPontosElegiveisDoSnapshot,
  salvarConfigFidelidadePontos,
  obterSaldoPontos,
} from "./fidelidade";
import { construirSnapshotOficial, construirSnapshotItem } from "./pedidoSnapshot";

beforeEach(async () => {
  store.clear();
  await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });
});

function snapshotSimples(params: { subtotalReais: number; descontoReais?: number; taxaReais?: number }) {
  const item = construirSnapshotItem({ kind: "pizza", nome: "Pizza G Calabresa", quantidade: 1, precoUnitarioReais: params.subtotalReais });
  return construirSnapshotOficial({
    itens: [item],
    subtotalReais: params.subtotalReais,
    descontoReais: params.descontoReais ?? 0,
    taxaReais: params.taxaReais ?? 0,
    tipoEntrega: "delivery",
    pagamento: "Pix",
    criadoEm: new Date().toISOString(),
  });
}

describe("calcularPontosElegiveisDoSnapshot", () => {
  test("subtotal sem desconto: pontos = piso(subtotal)", () => {
    const snapshot = snapshotSimples({ subtotalReais: 45 });
    expect(calcularPontosElegiveisDoSnapshot(snapshot)).toEqual({ valorElegivel: 45, pontos: 45 });
  });

  test("desconto de fidelidade é subtraído antes de calcular pontos", () => {
    const snapshot = snapshotSimples({ subtotalReais: 45, descontoReais: 10 });
    expect(calcularPontosElegiveisDoSnapshot(snapshot)).toEqual({ valorElegivel: 35, pontos: 35 });
  });

  test("taxa de entrega nunca entra no cálculo (nem soma nem subtrai)", () => {
    const comTaxa = calcularPontosElegiveisDoSnapshot(snapshotSimples({ subtotalReais: 45, taxaReais: 8 }));
    const semTaxa = calcularPontosElegiveisDoSnapshot(snapshotSimples({ subtotalReais: 45, taxaReais: 0 }));
    expect(comTaxa).toEqual(semTaxa);
  });

  test("desconto maior que o subtotal nunca gera valor elegível negativo", () => {
    const snapshot = snapshotSimples({ subtotalReais: 20, descontoReais: 50 });
    expect(calcularPontosElegiveisDoSnapshot(snapshot)).toEqual({ valorElegivel: 0, pontos: 0 });
  });

  test("centavos fracionários nunca geram ponto fracionado (piso, igual à regra legada)", () => {
    const snapshot = snapshotSimples({ subtotalReais: 45.99 });
    expect(calcularPontosElegiveisDoSnapshot(snapshot).pontos).toBe(45);
  });
});

describe("creditarPontosPedidoEntregue — snapshot como fonte quando presente", () => {
  test("pedido com snapshotOficial usa o valor do snapshot, ignorando total/taxaEntrega legados divergentes", async () => {
    const snapshot = snapshotSimples({ subtotalReais: 45, taxaReais: 8 });
    await creditarPontosPedidoEntregue({
      id: "ped_snap_1",
      status: "entregue",
      telefone: "86999990010",
      // Legado propositalmente divergente do snapshot — snapshot deve vencer.
      total: 999,
      taxaEntrega: 0,
      snapshotOficial: snapshot,
    });
    const saldo = await obterSaldoPontos("cli_86999990010");
    expect(saldo.disponivel).toBe(45);
  });

  test("pedido com desconto de fidelidade no snapshot credita só sobre o valor efetivamente pago", async () => {
    const snapshot = snapshotSimples({ subtotalReais: 45, descontoReais: 45 });
    await creditarPontosPedidoEntregue({
      id: "ped_snap_2",
      status: "entregue",
      telefone: "86999990011",
      total: 8,
      taxaEntrega: 8,
      snapshotOficial: snapshot,
    });
    const saldo = await obterSaldoPontos("cli_86999990011");
    expect(saldo.disponivel).toBe(0);
  });

  test("pedido sem snapshotOficial (WhatsApp/Salão/antigo) usa o cálculo legado, comportamento inalterado", async () => {
    await creditarPontosPedidoEntregue({
      id: "ped_legado_1",
      status: "entregue",
      telefone: "86999990012",
      total: 50,
      taxaEntrega: 5,
    });
    const saldo = await obterSaldoPontos("cli_86999990012");
    expect(saldo.disponivel).toBe(45);
  });

  test("idempotência preservada: reprocessar o mesmo pedido com snapshot não credita duas vezes", async () => {
    const snapshot = snapshotSimples({ subtotalReais: 30 });
    const pedido = { id: "ped_snap_3", status: "entregue" as const, telefone: "86999990013", total: 30, snapshotOficial: snapshot };
    await creditarPontosPedidoEntregue(pedido);
    await creditarPontosPedidoEntregue(pedido);
    const saldo = await obterSaldoPontos("cli_86999990013");
    expect(saldo.disponivel).toBe(30);
  });
});
