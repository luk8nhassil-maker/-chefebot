// Prova de integração do blocker "missão de indicação — cancela e converte
// de novo" (auditoria de correção final): usa as implementações REAIS de
// rankingMissaoIndicacaoEstado.ts + rankingBonusTemporada.ts (ledger de
// verdade, não mockado) — só ./redis é um mock em memória descartável.
//
// Antes da correção, o eventoId do crédito de bônus era fixo por
// (temporada, cliente) — `missaoIndicacao:{temp}:{cli}` — então depois de um
// crédito ser creditado e ESTORNADO (cancelamento tardio do pedido do
// indicado), uma NOVA indicação válida tentava creditar com o MESMO
// eventoId, o ledger via o movimento antigo ainda presente e devolvia
// "ja_creditado" sem nunca escrever um novo movimento: a missão aparecia
// concluída de novo, mas o bônus líquido continuava em zero.
import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    // Valores gravados via `eval` (BLOCKER 8, escreverBonusSeDono) ficam
    // como STRING crua no Map — o GET precisa tentar o parse de volta.
    get: vi.fn(async (key: string) => {
      if (!store.has(key)) return null;
      const valor = store.get(key);
      if (typeof valor === "string") {
        try {
          return JSON.parse(valor);
        } catch {
          return valor;
        }
      }
      return valor;
    }),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const atual = Number(store.get(key) ?? 0) + 1;
      store.set(key, atual);
      return atual;
    }),
    expire: vi.fn(async () => 1),
    // BLOCKER 8: compare-and-set (2 keys, 2 args) — grava keys[1] só se
    // keys[0] (o lock) ainda bater; compare-and-delete-lock (1 key, 1 arg).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      if (keys.length >= 2 && args.length >= 2) {
        store.set(keys[1], args[1]);
        return 1;
      }
      store.delete(keys[0]);
      return 1;
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

const { configGamificacao, sincronizarScoreMock } = vi.hoisted(() => ({
  configGamificacao: { missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 8 },
  sincronizarScoreMock: vi.fn(async () => undefined),
}));
vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: vi.fn(async () => configGamificacao) }));
vi.mock("./rankingScoreTemporadaSync", () => ({ sincronizarScoreTemporadaComBonus: sincronizarScoreMock }));

import { concluirMissaoIndicacaoNoPedido, reverterMissaoIndicacaoDoPedido, obterEstadoMissaoIndicacao } from "./rankingMissaoIndicacaoEstado";
import { obterBonusCompeticaoDaTemporada } from "./rankingBonusTemporada";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_indicador";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("missão de indicação: cancelamento e nova conversão válida (blocker 3)", () => {
  test("pedido A credita, cancelar A zera o líquido, pedido B (nova conversão) credita de novo exatamente uma vez", async () => {
    const a = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", agora: new Date() });
    expect(a).toEqual({ concluida: true, bonusCreditado: 8 });
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(8);

    await reverterMissaoIndicacaoDoPedido("pedido-A", "primeira compra do indicado cancelada");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(0);
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).concluida).toBe(false);

    const b = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B", agora: new Date() });
    expect(b).toEqual({ concluida: true, bonusCreditado: 8 });
    // Antes da correção, isto ficava travado em 0 (o ledger via o eventoId
    // antigo ainda presente e recusava creditar de novo).
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(8);
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).concluida).toBe(true);
  });

  test("retry do MESMO pedido (B) depois de já concluído nunca duplica o bônus", async () => {
    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", agora: new Date() });
    await reverterMissaoIndicacaoDoPedido("pedido-A", "cancelado");
    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B", agora: new Date() });

    const retry = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B", agora: new Date() });
    expect(retry).toEqual({ concluida: false, bonusCreditado: 0 });
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(8);
  });

  test("cancelar pedido B (a segunda conversão) estorna exatamente o crédito de B, não o de A (já estornado)", async () => {
    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", agora: new Date() });
    await reverterMissaoIndicacaoDoPedido("pedido-A", "cancelado");
    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B", agora: new Date() });

    await reverterMissaoIndicacaoDoPedido("pedido-B", "segunda conversão também cancelada");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(0);

    // Reverter A de novo (idempotência) continua no-op e nunca afeta o de B.
    await reverterMissaoIndicacaoDoPedido("pedido-A", "retry do cancelamento antigo");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(0);
  });
});
