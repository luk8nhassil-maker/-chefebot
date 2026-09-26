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
    // BLOCKER 8: agora também cobre a variante compare-and-delete-ESTADO
    // (2 keys — lock + estado — mas só 1 arg, o token): apaga keys[1] em vez
    // de keys[0], usada por apagarConversaoSeDono em rankingIndicacaoConversao.ts.
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      if (keys.length >= 2 && args.length >= 2) {
        store.set(keys[1], args[1]);
        return 1;
      }
      if (keys.length >= 2) {
        return store.delete(keys[1]) ? 1 : 0;
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
// exceto registrarConversaoIndicacao (o breadcrumb), reservarOuIdentificarConversao
// (a reserva em si) e marcarConversaoAtivaIndicado (a confirmação), que
// precisam ser interceptáveis para simular o crash "depois do +6, antes da
// confirmação" e a corrida real do BLOCKER 3 (A pausa entre confirmar a
// relação e reservar), além do worker atrasado do BLOCKER 4.
vi.mock("./rankingIndicacaoConversao", async (importOriginal) => {
  const real = await importOriginal<typeof import("./rankingIndicacaoConversao")>();
  return {
    ...real,
    registrarConversaoIndicacao: vi.fn(real.registrarConversaoIndicacao),
    reservarOuIdentificarConversao: vi.fn(real.reservarOuIdentificarConversao),
    marcarConversaoAtivaIndicado: vi.fn(real.marcarConversaoAtivaIndicado),
  };
});

// indicacaoToken.ts fica REAL — só obterRelacaoIndicacao precisa ser
// interceptável para simular a corrida real do BLOCKER 1 (B lê "sem
// relação" e pausa ANTES de A confirmar e crashar).
vi.mock("./indicacaoToken", async (importOriginal) => {
  const real = await importOriginal<typeof import("./indicacaoToken")>();
  return {
    ...real,
    obterRelacaoIndicacao: vi.fn(real.obterRelacaoIndicacao),
  };
});

import { processarEfeitosPedidoEntregue, processarEfeitosPedidoCancelado, obterPendenciasEfeitosFidelidade, type PedidoParaEfeitosFidelidade } from "./fidelidadeEfeitos";
import { obterConversaoAtivaIndicado, registrarConversaoIndicacao, reservarOuIdentificarConversao, marcarConversaoAtivaIndicado } from "./rankingIndicacaoConversao";
import { derivarClienteIdPorTelefone, obterExtratoPontos } from "./fidelidade";
import { registrarRelacaoIndicacao, salvarCandidaturaIndicacao, obterRelacaoIndicacao } from "./indicacaoToken";
import type { PedidoRedis } from "@/types/pedidoRedis";

const registrarConversaoIndicacaoMock = vi.mocked(registrarConversaoIndicacao);
const reservarOuIdentificarConversaoMock = vi.mocked(reservarOuIdentificarConversao);
const marcarConversaoAtivaIndicadoMock = vi.mocked(marcarConversaoAtivaIndicado);
const obterRelacaoIndicacaoMock = vi.mocked(obterRelacaoIndicacao);

const INDICADOR_ID = "cli_indicador_real_integracao";
const TELEFONE_INDICADO = "86988880001";
const TELEFONE_INDICADO_2 = "86988880002";
const TELEFONE_INDICADO_3 = "86988880003";
const TELEFONE_INDICADO_4 = "86988880004";
const TELEFONE_INDICADO_5 = "86988880005";
const TELEFONE_INDICADO_6 = "86988880006";
const TELEFONE_INDICADO_7 = "86988880007";
const TELEFONE_INDICADO_9 = "86988880009";

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

// BLOCKER 5 — helpers só para os testes de reconciliação de reserva órfã:
// gravam o pedido REAL na chave "pedidos" (a mesma que reconciliarReservaOrfaIndicacao
// e reprocessarPendenciaEfeitosFidelidade já leem) e envelhecem `reservadaEm`
// de uma reserva existente, simulando um processo que morreu de verdade (sem
// nenhum catch/finally rodando) há mais tempo que o limiar técnico.
function definirPedidoReal(pedido: Pick<PedidoRedis, "id" | "status" | "telefone">) {
  const pedidos = (store.get("pedidos") as PedidoRedis[] | undefined) ?? [];
  store.set("pedidos", [...pedidos.filter((p) => p.id !== pedido.id), pedido as PedidoRedis]);
}
function envelheceReserva(indicadoId: string, minutosAtras: number) {
  const chave = `estrelasIndicacao:conversaoAtiva:${indicadoId}`;
  // BLOCKER 8: agora a reserva é gravada via CAS (eval), então o valor bruto
  // no Map pode ser uma STRING JSON (nunca mais assumir que é sempre um
  // objeto já desserializado — mesmo cuidado do `get` mock acima).
  const bruto = store.get(chave);
  const atual = (typeof bruto === "string" ? JSON.parse(bruto) : bruto) as { estado: string; indicadorId: string; pedidoId: string; reservadaEm?: string };
  store.set(chave, { ...atual, reservadaEm: new Date(Date.now() - minutosAtras * 60 * 1000).toISOString() });
}

beforeEach(() => {
  store.clear();
  registrarConversaoIndicacaoMock.mockClear();
  reservarOuIdentificarConversaoMock.mockClear();
  marcarConversaoAtivaIndicadoMock.mockClear();
  obterRelacaoIndicacaoMock.mockClear();
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
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "processando", indicadorId: INDICADOR_ID, pedidoId: "pedido-A" }));

    // 2) Pedido B do MESMO indicado chega ANTES do retry de A: nunca credita
    // nada, nunca vira apoio recorrente "de brinde" por ter perdido a
    // disputa — a reserva de A ainda está "processando".
    await expect(processarEfeitosPedidoEntregue(pedido("pedido-B", TELEFONE_INDICADO))).rejects.toThrow(
      "ranking_indicacao_conversao_em_processamento",
    );

    const extratoAposB = await obterExtratoPontos(INDICADOR_ID);
    expect(extratoAposB).toHaveLength(1); // nenhum crédito novo (nem +6, nem +1 de apoio)
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "processando", indicadorId: INDICADOR_ID, pedidoId: "pedido-A" }));

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
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "processando", indicadorId: INDICADOR_ID, pedidoId: "pedido-A2" }));

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

  test("BLOCKER 3: A cria a relação (via candidatura) e pausa ANTES de reservar; B, que já enxerga a relação recém-criada, reserva e conclui a conversão ativa primeiro; A retoma e NUNCA credita uma segunda vez", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO_3)!;
    await salvarCandidaturaIndicacao(indicadoId, INDICADOR_ID);

    // Captura a implementação REAL (não mockada) antes de sobrepor a
    // chamada de A, para poder repassar a chamada de A a ela depois da
    // pausa — nunca simula a decisão, só atrasa a chamada real.
    const reservarReal = reservarOuIdentificarConversaoMock.getMockImplementation()!;
    let liberarA!: () => void;
    const pausaA = new Promise<void>((resolve) => {
      liberarA = resolve;
    });
    reservarOuIdentificarConversaoMock.mockImplementationOnce(async (...args) => {
      await pausaA;
      return reservarReal(...args);
    });

    // A começa: confirma a relação permanente (registrarRelacaoIndicacao,
    // "registrado") e PAUSA exatamente antes de reservar — a relação já
    // está visível para qualquer outro pedido a partir deste ponto.
    const promessaA = processarEfeitosPedidoEntregue(pedido("pedido-A3", TELEFONE_INDICADO_3));

    // Dá tempo real de event loop para A avançar até a pausa (confirmar a
    // relação) antes de B começar — sem isto B não veria a relação ainda.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await obterRelacaoIndicacao(indicadoId)).toEqual(expect.objectContaining({ indicadorId: INDICADOR_ID }));

    // B chega DEPOIS: já enxerga a relação criada por A, reserva sem
    // disputa (A ainda não reservou) e conclui a conversão principal.
    await processarEfeitosPedidoEntregue(pedido("pedido-B3", TELEFONE_INDICADO_3));
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-B3" });

    // A retoma: reservarOuIdentificarConversao real agora devolve
    // "ativa_outro_pedido" (B já confirmou) — A nunca pode cair de volta
    // em registrarConversaoPrincipal.
    liberarA();
    await promessaA;

    const extratoFinal = await obterExtratoPontos(INDICADOR_ID);
    const creditosPrincipais = extratoFinal.filter(
      (m) => m.tipo === "confirmado" && m.eventoId?.startsWith(`indicacao:${indicadoId}:primeira-compra:`),
    );
    // Exatamente UM +6 no total, nunca dois, mesmo com a corrida real.
    expect(creditosPrincipais).toHaveLength(1);
    expect(creditosPrincipais[0].eventoId).toBe(`indicacao:${indicadoId}:primeira-compra:pedido-B3`);
    // A conversão ativa continua sendo a de B — A nunca sobrescreve.
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-B3" });
  });

  test("BLOCKER 1: A e B leem 'sem relação' quase juntos; A vence a confirmação da relação mas crasha exatamente ANTES de reservar; B recebe 'ja_existe' de verdade, relê a relação CANÔNICA e garante a conversão — exatamente um +6", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO_9)!;
    await salvarCandidaturaIndicacao(indicadoId, INDICADOR_ID);

    // B começa primeiro: lê "sem relação" (de verdade, ainda é null nesse
    // instante) e PAUSA logo em seguida — antes de sequer olhar a
    // candidatura. Só a PRIMEIRA chamada a obterRelacaoIndicacao (a de B)
    // é interceptada; a de A, que só ocorre depois, usa a implementação
    // real sem pausa.
    const obterRelacaoReal = obterRelacaoIndicacaoMock.getMockImplementation()!;
    let liberarB!: () => void;
    const pausaB = new Promise<void>((resolve) => {
      liberarB = resolve;
    });
    obterRelacaoIndicacaoMock.mockImplementationOnce(async (...args: Parameters<typeof obterRelacaoIndicacao>) => {
      const resultado = await obterRelacaoReal(...args);
      await pausaB;
      return resultado;
    });

    const promessaB = processarEfeitosPedidoEntregue(pedido("pedido-B9", TELEFONE_INDICADO_9));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A processa por completo: também vê "sem relação", confirma a relação
    // (vence o SET NX de verdade — "registrado"), mas crasha exatamente ao
    // tentar reservar a conversão principal (simula o processo morrendo
    // ali, ANTES de qualquer +6).
    reservarOuIdentificarConversaoMock.mockRejectedValueOnce(new Error("crash simulado — A morre antes de reservar"));
    await expect(processarEfeitosPedidoEntregue(pedido("pedido-A9", TELEFONE_INDICADO_9))).rejects.toThrow(
      "crash simulado — A morre antes de reservar",
    );
    // A relação já está commitada de verdade — só falta alguém reservar.
    expect(await obterRelacaoIndicacao(indicadoId)).toEqual(expect.objectContaining({ indicadorId: INDICADOR_ID }));
    expect(await obterConversaoAtivaIndicado(indicadoId)).toBeNull();

    // B retoma: sua leitura antiga ("sem relação") já tinha acontecido;
    // agora tenta confirmar a candidatura e recebe "ja_existe" de verdade
    // (A já tinha confirmado). Com a correção, B relê a relação CANÔNICA
    // em vez de simplesmente desistir, e garante a conversão principal.
    liberarB();
    await promessaB;

    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(
      expect.objectContaining({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-B9" }),
    );
    const extratoFinal = await obterExtratoPontos(INDICADOR_ID);
    const creditosPrincipais = extratoFinal.filter(
      (m) => m.tipo === "confirmado" && m.eventoId?.startsWith(`indicacao:${indicadoId}:primeira-compra:`),
    );
    // Exatamente UM +6 — nunca zero (perdido pela corrida) nem dois.
    expect(creditosPrincipais).toHaveLength(1);
    expect(creditosPrincipais[0].eventoId).toBe(`indicacao:${indicadoId}:primeira-compra:pedido-B9`);
  });

  test("BLOCKER 4: A reserva, credita e grava o breadcrumb, mas 'crasha' exatamente antes de confirmar; um cancelamento real chega antes de qualquer retry e revoga a reserva; a confirmação atrasada do worker original de A NUNCA ressuscita A — e nunca toca uma conversão MAIS NOVA (C) que legitimamente ocupou o lugar depois", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO_4)!;
    await registrarRelacaoIndicacao(indicadoId, INDICADOR_ID);

    // A: reserva, credita de verdade (+6) e grava o breadcrumb — mas
    // "crasha" (lança) exatamente na própria confirmação, simulando o
    // processo morrendo depois do crédito e do breadcrumb, mas antes de
    // marcar a reserva como "ativa". O lock por pedido é liberado junto
    // (a chamada inteira lança), exatamente como um crash real faria.
    marcarConversaoAtivaIndicadoMock.mockRejectedValueOnce(new Error("crash simulado antes da confirmação"));
    await expect(processarEfeitosPedidoEntregue(pedido("pedido-A4", TELEFONE_INDICADO_4))).rejects.toThrow(
      "crash simulado antes da confirmação",
    );
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "processando", indicadorId: INDICADOR_ID, pedidoId: "pedido-A4" }));

    // Um cancelamento de A chega ANTES de qualquer retry: encontra o
    // breadcrumb (já gravado), estorna o +6 real e revoga a reserva.
    await processarEfeitosPedidoCancelado({
      ...pedido("pedido-A4", TELEFONE_INDICADO_4),
      status: "cancelado",
      statusAnterior: "entregue",
    });
    expect(await obterConversaoAtivaIndicado(indicadoId)).toBeNull();

    // O worker ORIGINAL de A — que já tinha passado da reserva/crédito/
    // breadcrumb e só não tinha chegado a confirmar — finalmente executa a
    // sua chamada de confirmação atrasada. Chama a função REAL diretamente
    // (o mockRejectedValueOnce já foi consumido), exatamente como o worker
    // antigo faria ao retomar de onde parou.
    const confirmacaoAtrasada = await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: INDICADOR_ID, pedidoId: "pedido-A4" });
    expect(confirmacaoAtrasada).toBe("reserva_perdida");
    expect(await obterConversaoAtivaIndicado(indicadoId)).toBeNull();

    const extratoAposConfirmacaoAtrasada = await obterExtratoPontos(INDICADOR_ID);
    const eventoOriginal = `indicacao:${indicadoId}:primeira-compra:pedido-A4`;
    // Exatamente um crédito e um estorno — a confirmação atrasada nunca cria
    // um terceiro lançamento fantasma.
    expect(extratoAposConfirmacaoAtrasada.filter((m) => m.eventoId === eventoOriginal)).toHaveLength(1);
    expect(extratoAposConfirmacaoAtrasada.filter((m) => m.eventoId === `estorno:${eventoOriginal}`)).toHaveLength(1);

    // Uma nova compra comercial válida (pedido C) do MESMO indicado agora
    // legitimamente ocupa o lugar, do zero.
    await processarEfeitosPedidoEntregue(pedido("pedido-C4", TELEFONE_INDICADO_4));
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-C4" });

    // O worker atrasado de A insiste (retry duplicado) DEPOIS de C já ter
    // assumido — continua "reserva_perdida" e a conversão de C NUNCA é
    // sobrescrita nem apagada.
    const segundaTentativaAtrasada = await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: INDICADOR_ID, pedidoId: "pedido-A4" });
    expect(segundaTentativaAtrasada).toBe("reserva_perdida");
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-C4" });
  });
});

describe("BLOCKER 5 — reconciliação determinística de reserva órfã (processo morreu de verdade, sem catch/finally algum)", () => {
  test("A órfã + pedido REAL já 'cancelado': B, ao encontrar a reserva velha, reconcilia (estorna se preciso e libera) em vez de ficar bloqueado para sempre", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO_5)!;
    await registrarRelacaoIndicacao(indicadoId, INDICADOR_ID);

    // A "morre" logo depois de reservar — nem chega a creditar no ledger.
    await reservarOuIdentificarConversao(indicadoId, { indicadorId: INDICADOR_ID, pedidoId: "pedido-A5" });
    envelheceReserva(indicadoId, 10);
    // O pedido real (fora deste pipeline) foi cancelado.
    definirPedidoReal({ id: "pedido-A5", status: "cancelado", telefone: TELEFONE_INDICADO_5 });

    // B chega bem depois: encontra a reserva "ocupada", mas ela já é
    // candidata técnica a órfã — reconcilia o dono (A) antes de desistir.
    await processarEfeitosPedidoEntregue(pedido("pedido-B5", TELEFONE_INDICADO_5));

    // B nunca herdou nada de A "de graça": como A nunca chegou a creditar,
    // esta é a PRIMEIRA conversão principal legítima — B é quem a recebe.
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-B5" }));
    const extrato = await obterExtratoPontos(INDICADOR_ID);
    expect(extrato.some((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-B5` && m.tipo === "confirmado")).toBe(true);
  });

  test("A órfã + pedido REAL 'entregue' + crédito (+6) JÁ existe (só faltou o breadcrumb/confirmação): reconciliação retoma A e completa sozinha; B nunca credita — vira apoio", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO_6)!;
    await registrarRelacaoIndicacao(indicadoId, INDICADOR_ID);

    // A credita de verdade (+6), mas "morre" antes do breadcrumb — igual aos
    // testes de crash anteriores, só que desta vez NINGUÉM faz retry nem
    // cancela: a reserva fica genuinamente parada.
    registrarConversaoIndicacaoMock.mockRejectedValueOnce(new Error("crash simulado — processo morreu de verdade"));
    await expect(processarEfeitosPedidoEntregue(pedido("pedido-A6", TELEFONE_INDICADO_6))).rejects.toThrow();
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "processando", pedidoId: "pedido-A6" }));
    envelheceReserva(indicadoId, 10);
    definirPedidoReal({ id: "pedido-A6", status: "entregue", telefone: TELEFONE_INDICADO_6 });

    // B chega bem depois — a reconciliação retoma o PRÓPRIO pedido A (nunca
    // decide por conta própria): o ledger devolve "ja_creditado", e desta
    // vez o breadcrumb e a confirmação completam normalmente.
    await processarEfeitosPedidoEntregue(pedido("pedido-B6", TELEFONE_INDICADO_6));

    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-A6" }));
    const extrato = await obterExtratoPontos(INDICADOR_ID);
    // Exatamente um crédito principal — nunca dois.
    expect(extrato.filter((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-A6` && m.tipo === "confirmado")).toHaveLength(1);
    // B nunca virou uma segunda conversão principal — no máximo apoio.
    expect(extrato.some((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-B6`)).toBe(false);
  });

  test("A órfã + pedido REAL 'entregue' + crédito ainda NÃO existe: reconciliação retoma A com segurança (credita, confirma) — B NUNCA rouba a conversão", async () => {
    const indicadoId = derivarClienteIdPorTelefone(TELEFONE_INDICADO_7)!;
    await registrarRelacaoIndicacao(indicadoId, INDICADOR_ID);

    // A reserva e morre IMEDIATAMENTE depois — nem o crédito no ledger chegou
    // a rodar.
    await reservarOuIdentificarConversao(indicadoId, { indicadorId: INDICADOR_ID, pedidoId: "pedido-A7" });
    envelheceReserva(indicadoId, 10);
    definirPedidoReal({ id: "pedido-A7", status: "entregue", telefone: TELEFONE_INDICADO_7 });

    // B chega bem depois — a reconciliação retoma o pedido A do zero (a
    // reserva prova que A era o dono legítimo): A credita normalmente.
    await processarEfeitosPedidoEntregue(pedido("pedido-B7", TELEFONE_INDICADO_7));

    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "ativa", indicadorId: INDICADOR_ID, pedidoId: "pedido-A7" }));
    const extrato = await obterExtratoPontos(INDICADOR_ID);
    expect(extrato.some((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-A7` && m.tipo === "confirmado")).toBe(true);
    // B nunca recebeu a conversão principal (nem sequer tentou creditar
    // apoio antes de A confirmar — a mesma disputa "ocupada" original, só
    // resolvida pela reconciliação).
    expect(extrato.some((m) => m.eventoId === `indicacao:${indicadoId}:primeira-compra:pedido-B7`)).toBe(false);
  });

  test("A órfã cujo pedido REAL não existe (indeterminado): NUNCA rouba — registra pendência operacional e continua retryable para B", async () => {
    const indicadoId = derivarClienteIdPorTelefone("86988880008")!;
    await registrarRelacaoIndicacao(indicadoId, INDICADOR_ID);

    // Reserva "fantasma": nada em "pedidos" corresponde a este pedidoId (ex.:
    // um pedido de teste/rascunho que nunca existiu de verdade no sistema).
    await reservarOuIdentificarConversao(indicadoId, { indicadorId: INDICADOR_ID, pedidoId: "pedido-fantasma" });
    envelheceReserva(indicadoId, 10);
    // Nenhum definirPedidoReal() chamado — "pedidos" não tem esse id.

    await expect(processarEfeitosPedidoEntregue(pedido("pedido-B8", "86988880008"))).rejects.toThrow(
      "ranking_indicacao_conversao_em_processamento",
    );

    // Nunca rouba: a reserva "fantasma" continua exatamente como estava.
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "processando", pedidoId: "pedido-fantasma" }));
    // Uma pendência operacional explícita foi registrada — nunca um silêncio.
    const pendencias = await obterPendenciasEfeitosFidelidade("default");
    expect(pendencias.some((p) => p.pedidoId === "pedido-fantasma")).toBe(true);
  });
});
