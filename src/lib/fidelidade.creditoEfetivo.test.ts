import { vi, describe, test, expect, beforeEach } from "vitest";

// Nível 6.6.1: prova que `creditarFidelidadeEfetiva` nunca credita os dois
// modelos (antigo/pizzas e novo/pontos) para o mesmo pedido — decide, a
// partir de uma única leitura de config:fidelidade:pontos, qual dos dois
// pode gerar crédito novo. Usa Redis real (fake em memória, com suporte aos
// dois scripts Lua do modelo de pontos), não mocks de alto nível — para
// provar de verdade que o histórico/saldo de cada modelo fica intacto.
const store = new Map<string, unknown>();

function realGet(key: string) {
  if (!store.has(key) && key === `cliente:${TELEFONE}`) {
    return {
      clienteId: clienteIdPontos,
      telefone: TELEFONE,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      lastLoginAt: "2020-01-01T00:00:00.000Z",
      pontosAtivos: true,
      pontosAtivadoEm: "2020-01-01T00:00:00.000Z",
    };
  }
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

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => realGet(key)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => realSet(key, value, opts)),
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => realEval(script, keys, args)),
  },
}));

import {
  creditarFidelidadeEfetiva,
  salvarConfigFidelidadePontos,
  salvarConfigFidelidade,
  obterSaldoPontos,
  obterProgressoFidelidade,
} from "./fidelidade";

const TELEFONE = "86999997001";
const CLIENTE_ID_LEGADO = "cli_legado_1";
const PEDIDO = { id: "ped_efetivo_1", status: "entregue", telefone: TELEFONE, clienteId: CLIENTE_ID_LEGADO, total: 100, taxaEntrega: 0, pizzasCount: 2 };
const clienteIdPontos = `cli_${TELEFONE}`;

beforeEach(() => {
  store.clear();
});

describe("creditarFidelidadeEfetiva — precedência única entre modelo antigo e modelo por pontos", () => {
  test("pontos ativo + legado ativo: somente pontos credita", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 1000, descricaoRecompensa: "x" });
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "y" });

    await creditarFidelidadeEfetiva(PEDIDO);

    expect((await obterSaldoPontos(clienteIdPontos)).disponivel).toBe(100);
    expect((await obterProgressoFidelidade(CLIENTE_ID_LEGADO)).progresso).toBe(0);
  });

  test("pontos ativo + legado desativado: somente pontos credita", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 1000, descricaoRecompensa: "x" });
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "y" });

    await creditarFidelidadeEfetiva(PEDIDO);

    expect((await obterSaldoPontos(clienteIdPontos)).disponivel).toBe(100);
    expect((await obterProgressoFidelidade(CLIENTE_ID_LEGADO)).progresso).toBe(0);
  });

  test("pontos desativado + legado ativo: somente legado credita", async () => {
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 1000, descricaoRecompensa: "x" });
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "y" });

    await creditarFidelidadeEfetiva(PEDIDO);

    expect((await obterSaldoPontos(clienteIdPontos)).disponivel).toBe(0);
    expect((await obterProgressoFidelidade(CLIENTE_ID_LEGADO)).progresso).toBe(2);
  });

  test("ambos desativados: nenhum credito", async () => {
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 1000, descricaoRecompensa: "x" });
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "y" });

    await creditarFidelidadeEfetiva(PEDIDO);

    expect((await obterSaldoPontos(clienteIdPontos)).disponivel).toBe(0);
    expect((await obterProgressoFidelidade(CLIENTE_ID_LEGADO)).progresso).toBe(0);
  });

  test("repetir a entrega (mesmo pedidoId) nao duplica nenhum credito, em nenhum dos dois modelos", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 1000, descricaoRecompensa: "x" });
    // Legado tambem ativo desde o inicio: quando a config de pontos for
    // desligada mais abaixo, o legado ja esta pronto para creditar (sem
    // precisar salvar a config de novo no meio do teste).
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "y" });

    await creditarFidelidadeEfetiva(PEDIDO);
    await creditarFidelidadeEfetiva(PEDIDO);
    await creditarFidelidadeEfetiva(PEDIDO);

    expect((await obterSaldoPontos(clienteIdPontos)).disponivel).toBe(100);

    // Troca para o legado (simulando reprocessamento com config diferente) e
    // confirma que o crédito de pontos já feito não é duplicado nem revertido.
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 1000, descricaoRecompensa: "x" });
    await creditarFidelidadeEfetiva(PEDIDO);
    expect((await obterSaldoPontos(clienteIdPontos)).disponivel).toBe(100);
    // O legado credita agora (idempotente por pedidoId — só uma vez).
    await creditarFidelidadeEfetiva(PEDIDO);
    expect((await obterProgressoFidelidade(CLIENTE_ID_LEGADO)).progresso).toBe(2);
  });

  test("historico antigo (legado) continua legivel e intacto quando o programa de pontos esta ativo", async () => {
    // Crédito legado feito ANTES deste PR (programa de pontos nem existia
    // ativo ainda) — precisa continuar acessível mesmo depois de pontos
    // virar o modelo efetivo.
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 1000, descricaoRecompensa: "x" });
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "y" });
    await creditarFidelidadeEfetiva({ ...PEDIDO, id: "ped_legado_antigo" });
    expect((await obterProgressoFidelidade(CLIENTE_ID_LEGADO)).progresso).toBe(2);

    // Agora o admin liga o programa de pontos — o histórico legado não é
    // apagado nem alterado, só deixa de crescer.
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 1000, descricaoRecompensa: "x" });
    await creditarFidelidadeEfetiva({ ...PEDIDO, id: "ped_novo_pontos" });

    expect((await obterProgressoFidelidade(CLIENTE_ID_LEGADO)).progresso).toBe(2); // intacto, nao cresceu
    expect((await obterSaldoPontos(clienteIdPontos)).disponivel).toBe(100); // novo modelo creditou
  });
});
