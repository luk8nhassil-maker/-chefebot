// Prova de integração REAL do blocker "reserva durável da conversão
// principal" (última correção de segurança/integridade sobre o PR #449): usa
// as implementações REAIS de fidelidadeEfeitos.ts (o pipeline de efeitos do
// pedido), rankingIndicacaoConversao.ts (a reserva durável), estrelasIndicacao.ts
// e fidelidade.ts (o ledger de verdade, com sua própria idempotência por
// eventoId) e indicacaoToken.ts (a relação permanente indicador→indicado).
// Só ./redis é um mock em memória descartável (com nx/eval funcionando de
// verdade), e os módulos genuinamente NÃO relacionados a indicação
// (jornada, analytics, temporada, missão semanal/da temporada, retenção)
// são mocks simples no-op.
//
// Por quê este arquivo existe: o lock efêmero (comReservaConversaoAtiva,
// TTL de 10s) sozinho só protege enquanto os dois processos concorrentes
// estão vivos ao mesmo tempo. Ele NÃO protege contra um crash entre o
// crédito real (+6) e a confirmação da reserva como "ativa" — nesse buraco,
// um segundo pedido do MESMO indicado, chegando antes do retry do primeiro,
// podia creditar um segundo +6. A correção introduz um ESTADO DURÁVEL
// (processando/ativa, sem TTL) que sobrevive ao crash; estes testes provam
// isso fim a fim, com o ledger de verdade — não com uma decisão simulada.
import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    // Valores gravados via `eval` (abaixo) ficam como STRING crua no Map,
    // exatamente como um Redis de verdade guardaria após um `redis.call("SET",
    // ...)` dentro de um script Lua (nunca passa pela serialização do client
    // @upstash/redis) — então o GET precisa tentar fazer o parse de volta,
    // igual o client real faz.
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
    del: vi.fn(async (...keys: string[]) => {
      let removidos = 0;
      for (const key of keys) if (store.delete(key)) removidos++;
      return removidos;
    }),
    incr: vi.fn(async (key: string) => {
      const atual = Number(store.get(key) ?? 0) + 1;
      store.set(key, atual);
      return atual;
    }),
    expire: vi.fn(async () => 1),
    // Este mock genérico só entende os DOIS formatos de script Lua usados
    // hoje neste módulo real (fidelidade.ts + rankingGamificacaoLock.ts):
    //   - compare-and-delete: 1 key (o lock), 1 arg (o token) — libera um
    //     lock só se o dono ainda bater.
    //   - compare-and-set: 2 keys (lock + destino), 2 args (token + payload)
    //     — grava o estado só se o dono do lock ainda bater
    //     (PERSISTIR_ESTADO_SE_DONO_SCRIPT). O valor gravado é a STRING crua
    //     (ver comentário do `get` acima), nunca o objeto já desserializado.
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      if (keys.length >= 2) {
        store.set(keys[1], args[1]);
        return 1;
      }
      store.delete(keys[0]);
      return 1;
    }),
  },
}));

// Módulos genuinamente NÃO relacionados a esta jornada — mocks simples,
// nunca tocados pelas asserções destes testes.
vi.mock("./jornadaChef", () => ({
  liberarRecompensaDePedidoCancelado: vi.fn(async () => undefined),
  processarConclusaoPedidoJornada: vi.fn(async () => null),
  reverterConclusaoPedidoJornada: vi.fn(async () => ({ ok: true, pendenciaAberta: false })),
  TENANT_PADRAO: "default",
}));
vi.mock("./historicoAnalitico", () => ({
  registrarEventoEntregue: vi.fn(async () => undefined),
  estornarEventoAnalitico: vi.fn(async () => undefined),
}));
vi.mock("./temporadas", () => ({
  obterTemporadaAtiva: vi.fn(async () => null),
}));
vi.mock("./rankingRetencao", () => ({
  detectarCreditoDoPedido: vi.fn(() => null),
}));
vi.mock("./rankingMissaoSemanalEstado", () => ({
  consumirMissaoSemanalNoPedido: vi.fn(async () => ({ consumida: false, bonusCreditado: 0 })),
  reverterMissaoSemanalDoPedido: vi.fn(async () => undefined),
}));
vi.mock("./rankingMissaoIndicacaoEstado", () => ({
  concluirMissaoIndicacaoNoPedido: vi.fn(async () => ({ concluida: false, bonusCreditado: 0 })),
  reverterMissaoIndicacaoDoPedido: vi.fn(async () => undefined),
}));
vi.mock("./expedienteOperacional", () => ({
  chaveExpedienteOperacional: vi.fn(() => "expediente-teste"),
}));

// fidelidade.ts fica REAL (ledger de verdade), exceto os efeitos que não são
// desta jornada (fidelidade legada por pizza, pontos do próprio pedido,
// reversão de resgate) — mantê-los reais só adicionaria ruído sem nenhuma
// asserção relevante para este blocker.
vi.mock("./fidelidade", async (importOriginal) => {
  const real = await importOriginal<typeof import("./fidelidade")>();
  return {
    ...real,
    creditarFidelidadePedido: vi.fn(async () => undefined),
    creditarPontosPedidoEntregue: vi.fn(async () => undefined),
    reverterResgateConfirmado: vi.fn(async () => undefined),
  };
});

// rankingIndicacaoConversao.ts fica REAL — é o próprio mecanismo sob teste —
// exceto registrarConversaoIndicacao (o breadcrumb), que precisa ser
// interceptável para simular o crash "depois do +6, antes da confirmação".
vi.mock("./rankingIndicacaoConversao", async (importOriginal) => {
  const real = await importOriginal<typeof import("./rankingIndicacaoConversao")>();
  return { ...real, registrarConversaoIndicacao: vi.fn(real.registrarConversaoIndicacao) };
});

import { processarEfeitosPedidoEntregue, processarEfeitosPedidoCancelado, type PedidoParaEfeitosFidelidade } from "./fidelidadeEfeitos";
import { obterConversaoAtivaIndicado, registrarConversaoIndicacao } from "./rankingIndicacaoConversao";
import { derivarClienteIdPorTelefone, obterExtratoPontos } from "./fidelidade";
import { registrarRelacaoIndicacao } from "./indicacaoToken";

const registrarConversaoIndicacaoMock = vi.mocked(registrarConversaoIndicacao);

const INDICADOR_ID = "cli_indicador_real_integracao";
const TELEFONE_INDICADO = "86988880001";
const TELEFONE_INDICADO_2 = "86988880002";

function pedido(id: string, telefone: string, overrides: Partial<PedidoParaEfeitosFidelidade> = {}): PedidoParaEfeitosFidelidade {
  return {
    id,
    status: "entregue",
    telefone,
    total: 40,
    tenantId: "default",
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  registrarConversaoIndicacaoMock.mockClear();
  // Sistema de Estrelas (V1) ativo — condição real exigida por
  // creditarEstrelasIndicacaoValida (estrelasV1Ativa), sem a qual todo
  // crédito de indicação seria "nao_elegivel".
  store.set("config:fidelidade:pontos", { ativo: true, regraVersao: "estrelas-faixas-v1", metaEstrelas: 50 });
});

describe("BLOCKER (reserva durável) — crash entre o +6 e a confirmação, com ledger e reserva REAIS", () => {
  test("A reserva e credita +6, crash antes da confirmação; B chega ANTES do retry e não recebe nada; retry de A confirma sem duplicar", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO)!;
    await registrarRelacaoIndicacao(indicadoId, INDICADOR_ID);

    // 1) Pedido A: credita de verdade (+6), mas "crasha" exatamente antes do
    // breadcrumb (que antecede a confirmação da reserva como "ativa").
    registrarConversaoIndicacaoMock.mockRejectedValueOnce(new Error("crash simulado antes da confirmação"));
    await expect(processarEfeitosPedidoEntregue(pedido("pedido-A", TELEFONE_INDICADO))).rejects.toThrow(
      "crash simulado antes da confirmação",
    );

    const extratoAposA = await obterExtratoPontos(INDICADOR_ID);
    expect(extratoAposA.filter((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-A`)).toHaveLength(1);
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "processando", indicadorId: INDICADOR_ID, pedidoId: "pedido-A" });

    // 2) Pedido B do MESMO indicado chega ANTES do retry de A: nunca credita
    // nada, nunca vira apoio recorrente "de brinde" por ter perdido a
    // disputa — a reserva de A ainda está "processando".
    await expect(processarEfeitosPedidoEntregue(pedido("pedido-B", TELEFONE_INDICADO))).rejects.toThrow(
      "ranking_indicacao_conversao_em_processamento",
    );

    const extratoAposB = await obterExtratoPontos(INDICADOR_ID);
    expect(extratoAposB).toHaveLength(1); // nenhum crédito novo (nem +6, nem +1 de apoio)
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "processando", indicadorId: INDICADOR_ID, pedidoId: "pedido-A" });

    // 3) Retry de A (o breadcrumb agora funciona normalmente — a rejeição
    // era "once"): o ledger real devolve "ja_creditado" para o mesmo
    // eventoId, e todos os efeitos auxiliares que faltavam são completados.
    await processarEfeitosPedidoEntregue(pedido("pedido-A", TELEFONE_INDICADO));

    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-A" });
    const extratoFinal = await obterExtratoPontos(INDICADOR_ID);
    expect(extratoFinal.filter((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-A`)).toHaveLength(1); // nunca duplicado
  });

  test("A reserva e credita +6, crash antes da confirmação; cancelamento de A (sem retry) estorna e libera a reserva; C (nova conversão válida) credita normalmente", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO_2)!;
    await registrarRelacaoIndicacao(indicadoId, INDICADOR_ID);

    registrarConversaoIndicacaoMock.mockRejectedValueOnce(new Error("crash simulado"));
    await expect(processarEfeitosPedidoEntregue(pedido("pedido-A2", TELEFONE_INDICADO_2))).rejects.toThrow("crash simulado");
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "processando", indicadorId: INDICADOR_ID, pedidoId: "pedido-A2" });

    // Cancelamento chega ANTES de qualquer retry — sem o breadcrumb (nunca
    // foi escrito), o efeito precisa descobrir a conversão pelo estado
    // durável e estornar o +6 já creditado de verdade.
    await processarEfeitosPedidoCancelado({
      ...pedido("pedido-A2", TELEFONE_INDICADO_2),
      status: "cancelado",
      statusAnterior: "entregue",
    });

    expect(await obterConversaoAtivaIndicado(indicadoId)).toBeNull();
    const extratoAposCancelamento = await obterExtratoPontos(INDICADOR_ID);
    const eventoOriginal = `indicacao:${indicadoId}:primeira-compra:pedido-A2`;
    expect(extratoAposCancelamento.some((m) => m.eventoId === eventoOriginal && m.tipo === "confirmado")).toBe(true);
    expect(extratoAposCancelamento.some((m) => m.eventoId === `estorno:${eventoOriginal}` && m.tipo === "estornado")).toBe(true);

    // Uma nova compra comercial válida (pedido C) do MESMO indicado agora
    // pode ser a conversão principal, do zero.
    await processarEfeitosPedidoEntregue(pedido("pedido-C", TELEFONE_INDICADO_2));

    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-C" });
    const extratoFinal = await obterExtratoPontos(INDICADOR_ID);
    expect(extratoFinal.some((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-C` && m.tipo === "confirmado")).toBe(true);
  });
});
