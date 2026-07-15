import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PIX_GUARDIAO_IDADE_MAXIMA_MS, PIX_SENTINELA_COOLDOWN_RATE_LIMIT_SEGUNDOS } from "./pixAutoCheckConfig";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      const existia = store.delete(key);
      return existia ? 1 : 0;
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

type ResumoReconciliacaoMock = {
  verificados: number;
  confirmados: number;
  pendentes: number;
  ignorados: number;
  erros: number;
  detalhes: { pedidoId: string; outcome: "pendente" | "confirmado" | "ignorado" | "erro"; motivo?: string }[];
  rateLimited?: boolean;
  locked?: boolean;
  limitados?: number;
};

const { reconciliarMock } = vi.hoisted(() => ({
  reconciliarMock: vi.fn<() => Promise<ResumoReconciliacaoMock>>(async () => ({ verificados: 1, confirmados: 0, pendentes: 1, ignorados: 0, erros: 0, detalhes: [{ pedidoId: "p1", outcome: "pendente" }] })),
}));

vi.mock("./mercadoPagoReconciliacao", () => ({
  reconciliarPixMercadoPago: reconciliarMock,
}));

import {
  avaliarDecisaoSentinela,
  solicitarVerificacaoOficialPix,
  encerrarSentinela,
  carregarEstadoSentinela,
  iniciarEstadoSentinela,
  registrarAtividadeWebhookSentinela,
  type PixSentinelaEstado,
} from "./pixSentinela";

function estadoBase(overrides: Partial<PixSentinelaEstado> = {}): PixSentinelaEstado {
  return {
    pedidoId: "p1",
    geracao: 1,
    estadoOperacional: "ativo",
    criadoEm: Date.now() - 60_000,
    falhasConsecutivas: 0,
    tentativaAtual: 1,
    ...overrides,
  };
}

const pedidoAtivo = { existe: true, provider: "mercadopago", pixStatus: "pendente", pixConfirmado: false, statusPedido: "novo", criadoEm: Date.now() - 60_000 };

describe("avaliarDecisaoSentinela — decisão pura, sem Redis (as 12 checagens do Sentinela)", () => {
  test("pedido inexistente encerra a cadeia", () => {
    const r = avaliarDecisaoSentinela({ agora: Date.now(), estado: null, pedido: { existe: false }, origem: "guardiao_qstash", lockAtivo: false, cooldownGlobalAtivo: false });
    expect(r.podeConsultar).toBe(false);
    expect(r.encerrar).toBe(true);
    expect(r.motivoEncerramento).toBe("pedido_inexistente");
  });

  test("Pix manual por chave (provider !== mercadopago, === 'manual') não entra no fluxo — encerra com motivo pix_manual", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: null,
      pedido: { ...pedidoAtivo, provider: "manual" },
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.encerrar).toBe(true);
    expect(r.motivoEncerramento).toBe("pix_manual");
  });

  test("provider diferente/ausente (não Mercado Pago, não manual) encerra com motivo nao_mercadopago", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: null,
      pedido: { ...pedidoAtivo, provider: undefined },
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.encerrar).toBe(true);
    expect(r.motivoEncerramento).toBe("nao_mercadopago");
  });

  test("mensagem com geração antiga (diferente da geração atual do estado) é ignorada sem encerrar a cadeia inteira", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: estadoBase({ geracao: 3 }),
      pedido: pedidoAtivo,
      geracaoMensagem: 2,
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.podeConsultar).toBe(false);
    expect(r.motivo).toBe("geracao_antiga");
    expect(r.encerrar).toBe(false);
  });

  test("mensagem com a geração atual não é tratada como antiga", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: estadoBase({ geracao: 3, proximaConsultaMercadoPagoEm: Date.now() - 1 }),
      pedido: pedidoAtivo,
      geracaoMensagem: 3,
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.motivo).not.toBe("geracao_antiga");
  });

  test("pedido cancelado encerra a cadeia", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: estadoBase(),
      pedido: { ...pedidoAtivo, statusPedido: "cancelado" },
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.encerrar).toBe(true);
    expect(r.motivoEncerramento).toBe("cancelado");
  });

  test("pagamento já confirmado encerra a cadeia", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: estadoBase(),
      pedido: { ...pedidoAtivo, pixConfirmado: true },
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.encerrar).toBe(true);
    expect(r.motivoEncerramento).toBe("confirmado");
  });

  test("mesmo em plena consulta (lock ativo), um pedido já confirmado encerra a cadeia sem depender do lock — checagem 4 vem antes da 6", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: estadoBase(),
      pedido: { ...pedidoAtivo, pixStatus: "confirmado" },
      origem: "guardiao_qstash",
      lockAtivo: true,
      cooldownGlobalAtivo: false,
    });
    expect(r.encerrar).toBe(true);
    expect(r.motivoEncerramento).toBe("confirmado");
  });

  test("idade >= idade máxima operacional encerra a cadeia (expirado)", () => {
    const agora = Date.now();
    const r = avaliarDecisaoSentinela({
      agora,
      estado: estadoBase(),
      pedido: { ...pedidoAtivo, criadoEm: agora - PIX_GUARDIAO_IDADE_MAXIMA_MS },
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.encerrar).toBe(true);
    expect(r.motivoEncerramento).toBe("expirado");
  });

  test("confirmação manual (origem 'manual') nunca é bloqueada pelas checagens de cadência/lock/cooldown", () => {
    const agora = Date.now();
    const r = avaliarDecisaoSentinela({
      agora,
      estado: estadoBase({ proximaConsultaMercadoPagoEm: agora + 999_999, cooldownAte: agora + 999_999 }),
      pedido: pedidoAtivo,
      origem: "manual",
      lockAtivo: true,
      cooldownGlobalAtivo: true,
    });
    expect(r.podeConsultar).toBe(true);
    expect(r.encerrar).toBe(false);
  });

  test("lock ativo (consulta em andamento) impede nova consulta, sem encerrar a cadeia", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: estadoBase(),
      pedido: pedidoAtivo,
      origem: "guardiao_qstash",
      lockAtivo: true,
      cooldownGlobalAtivo: false,
    });
    expect(r.podeConsultar).toBe(false);
    expect(r.motivo).toBe("lock_ativo");
    expect(r.encerrar).toBe(false);
  });

  test("cooldown específico do pagamento ativo impede consulta", () => {
    const agora = Date.now();
    const r = avaliarDecisaoSentinela({
      agora,
      estado: estadoBase({ cooldownAte: agora + 10_000 }),
      pedido: pedidoAtivo,
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.podeConsultar).toBe(false);
    expect(r.motivo).toBe("cooldown_ativo");
  });

  test("rate limit global ativo impede consulta", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: estadoBase(),
      pedido: pedidoAtivo,
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: true,
    });
    expect(r.podeConsultar).toBe(false);
    expect(r.motivo).toBe("rate_limit_global");
  });

  test("antes da próxima consulta agendada (proximaConsultaMercadoPagoEm no futuro): não consulta", () => {
    const agora = Date.now();
    const r = avaliarDecisaoSentinela({
      agora,
      estado: estadoBase({ proximaConsultaMercadoPagoEm: agora + 5_000 }),
      pedido: pedidoAtivo,
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.podeConsultar).toBe(false);
    expect(r.motivo).toBe("antes_da_janela");
  });

  test("webhook ignora a janela de cadência (evento-driven) mesmo com proximaConsultaMercadoPagoEm no futuro", () => {
    const agora = Date.now();
    const r = avaliarDecisaoSentinela({
      agora,
      estado: estadoBase({ proximaConsultaMercadoPagoEm: agora + 999_999 }),
      pedido: pedidoAtivo,
      origem: "webhook",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.podeConsultar).toBe(true);
  });

  test("na hora certa (agora >= proximaConsultaMercadoPagoEm) e sem nenhum bloqueio: autoriza a consulta", () => {
    const agora = Date.now();
    const r = avaliarDecisaoSentinela({
      agora,
      estado: estadoBase({ proximaConsultaMercadoPagoEm: agora - 1 }),
      pedido: pedidoAtivo,
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.podeConsultar).toBe(true);
    expect(r.encerrar).toBe(false);
  });

  test("sem estado ainda (primeira avaliação, sem proximaConsultaMercadoPagoEm): autoriza a consulta", () => {
    const r = avaliarDecisaoSentinela({
      agora: Date.now(),
      estado: null,
      pedido: pedidoAtivo,
      origem: "guardiao_qstash",
      lockAtivo: false,
      cooldownGlobalAtivo: false,
    });
    expect(r.podeConsultar).toBe(true);
  });
});

describe("solicitarVerificacaoOficialPix — orquestração (Redis + conciliador mockados)", () => {
  beforeEach(() => {
    store.clear();
    reconciliarMock.mockClear();
    reconciliarMock.mockResolvedValue({ verificados: 1, confirmados: 0, pendentes: 1, ignorados: 0, erros: 0, detalhes: [{ pedidoId: "p1", outcome: "pendente" }] });
  });
  afterEach(() => vi.useRealTimers());

  function seedPedido(overrides: Record<string, unknown> = {}) {
    store.set("pedidos", [{ id: "p1", status: "novo", pixConfirmado: false, pix: { provider: "mercadopago", status: "pendente", criadoEm: new Date(Date.now() - 60_000).toISOString(), providerPaymentId: "MP-1" }, ...overrides }]);
  }

  test("consulta autorizada chama reconciliarPixMercadoPago restrito a este pedido e atualiza o estado", async () => {
    seedPedido();
    const r = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(reconciliarMock).toHaveBeenCalledWith({ apenasPedidoIds: ["p1"] });
    expect(r.consultou).toBe(true);
    expect(r.encerrado).toBe(false);
    const estado = await carregarEstadoSentinela("p1");
    expect(estado?.ultimaOrigemDaConsulta).toBe("guardiao_qstash");
    expect(typeof estado?.proximaConsultaMercadoPagoEm).toBe("number");
  });

  test("pagamento já confirmado no Redis encerra sem chamar o conciliador (webhook chegou antes do tick)", async () => {
    seedPedido({ pixConfirmado: true, pix: { provider: "mercadopago", status: "confirmado", criadoEm: new Date().toISOString() } });
    const r = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(reconciliarMock).not.toHaveBeenCalled();
    expect(r.encerrado).toBe(true);
    expect(r.motivoEncerramento).toBe("confirmado");
  });

  test("pedido inexistente encerra sem chamar o conciliador", async () => {
    store.set("pedidos", []);
    const r = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(reconciliarMock).not.toHaveBeenCalled();
    expect(r.encerrado).toBe(true);
    expect(r.motivoEncerramento).toBe("pedido_inexistente");
  });

  test("dois workers simultâneos disputando o mesmo pagamento: só um consulta o Mercado Pago, o outro é coalescido", async () => {
    seedPedido();
    const [a, b] = await Promise.all([
      solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" }),
      solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "painel" }),
    ]);
    expect(reconciliarMock).toHaveBeenCalledTimes(1);
    const consultaram = [a, b].filter((r) => r.consultou);
    const coalescidos = [a, b].filter((r) => !r.consultou && !r.encerrado);
    expect(consultaram.length).toBe(1);
    expect(coalescidos.length).toBe(1);
  });

  test("lock liberado após a consulta terminar permite nova consulta assim que a janela de cadência abrir de novo", async () => {
    seedPedido();
    await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(reconciliarMock).toHaveBeenCalledTimes(1);

    // O lock já foi liberado no `finally` da chamada acima (comportamento
    // real, não simulado). Só reabre a janela de cadência para a próxima
    // consulta poder acontecer imediatamente, em vez de esperar o intervalo
    // normal — equivalente a um novo tick após o tempo ter passado.
    const estado = await carregarEstadoSentinela("p1");
    expect(estado).not.toBeNull();
    await redisMock.set("pix:sentinela:estado:p1", { ...(estado as NonNullable<typeof estado>), proximaConsultaMercadoPagoEm: Date.now() - 1 });

    const r2 = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(r2.consultou).toBe(true);
    expect(reconciliarMock).toHaveBeenCalledTimes(2);
  });

  test("rate limit do Mercado Pago aplica cooldown e não permite nova consulta imediata", async () => {
    seedPedido();
    reconciliarMock.mockResolvedValueOnce({ verificados: 0, confirmados: 0, pendentes: 0, ignorados: 0, erros: 1, detalhes: [], rateLimited: true });
    const r = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(r.motivo).toBe("rate_limited");
    expect(r.encerrado).toBe(false);
    const agora = Date.now();
    expect(r.proximaConsultaMercadoPagoEm).toBeGreaterThanOrEqual(agora + PIX_SENTINELA_COOLDOWN_RATE_LIMIT_SEGUNDOS * 1000 - 100);

    // Nova tentativa imediata: bloqueada pelo cooldown específico do pagamento.
    const r2 = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(r2.consultou).toBe(false);
    expect(r2.motivo).toBe("cooldown_ativo");
    expect(reconciliarMock).toHaveBeenCalledTimes(1);
  });

  test("erro transitório (timeout) aplica backoff — próxima consulta mais distante que o intervalo normal", async () => {
    seedPedido();
    reconciliarMock.mockResolvedValueOnce({ verificados: 1, confirmados: 0, pendentes: 0, ignorados: 0, erros: 1, detalhes: [{ pedidoId: "p1", outcome: "erro", motivo: "timeout" }] });
    const antes = Date.now();
    const r = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash", agora: antes });
    expect(r.encerrado).toBe(false);
    const estado = await carregarEstadoSentinela("p1");
    expect(estado?.falhasConsecutivas).toBe(1);
    // Backoff multiplica o intervalo normal (2^falhas) — deve ser
    // estritamente maior que um próximo tick "normal" de 5s.
    expect((estado?.proximaConsultaMercadoPagoEm || 0) - antes).toBeGreaterThan(5_000);
  });

  test("confirmação encontrada nesta rodada encerra a cadeia (não reagenda)", async () => {
    seedPedido();
    reconciliarMock.mockResolvedValueOnce({ verificados: 1, confirmados: 1, pendentes: 0, ignorados: 0, erros: 0, detalhes: [{ pedidoId: "p1", outcome: "confirmado" }] });
    const r = await solicitarVerificacaoOficialPix({ pedidoId: "p1", origem: "guardiao_qstash" });
    expect(r.encerrado).toBe(true);
    expect(r.motivoEncerramento).toBe("confirmado");
    const estado = await carregarEstadoSentinela("p1");
    expect(estado?.estadoOperacional).toBe("confirmado");
  });
});

describe("encerrarSentinela / iniciarEstadoSentinela / registrarAtividadeWebhookSentinela", () => {
  beforeEach(() => store.clear());

  test("iniciarEstadoSentinela cria geração 1 e reaproveita estado existente em chamadas repetidas", async () => {
    const agora = Date.now();
    const e1 = await iniciarEstadoSentinela({ pedidoId: "p1", agora });
    expect(e1.geracao).toBe(1);
    const e2 = await iniciarEstadoSentinela({ pedidoId: "p1", agora: agora + 1000 });
    expect(e2.geracao).toBe(1);
    expect(e2.criadoEm).toBe(e1.criadoEm);
  });

  test("encerrarSentinela('confirmado_manual') marca estado confirmado e incrementa a geração — invalida ticks QStash antigos", async () => {
    await iniciarEstadoSentinela({ pedidoId: "p1", agora: Date.now() });
    const antes = await carregarEstadoSentinela("p1");
    await encerrarSentinela("p1", "confirmado_manual");
    const depois = await carregarEstadoSentinela("p1");
    expect(depois?.estadoOperacional).toBe("confirmado");
    expect(depois?.geracao).toBe((antes?.geracao || 0) + 1);
    expect(depois?.confirmadoEm).toBeDefined();
  });

  test("encerrarSentinela é idempotente (chamar duas vezes não lança e mantém estado confirmado)", async () => {
    await iniciarEstadoSentinela({ pedidoId: "p1", agora: Date.now() });
    await encerrarSentinela("p1", "confirmado");
    await expect(encerrarSentinela("p1", "confirmado")).resolves.toBeUndefined();
    const estado = await carregarEstadoSentinela("p1");
    expect(estado?.estadoOperacional).toBe("confirmado");
  });

  test("registrarAtividadeWebhookSentinela({confirmado:true}) encerra a cadeia", async () => {
    await iniciarEstadoSentinela({ pedidoId: "p1", agora: Date.now() });
    await registrarAtividadeWebhookSentinela("p1", { confirmado: true });
    const estado = await carregarEstadoSentinela("p1");
    expect(estado?.estadoOperacional).toBe("confirmado");
  });

  test("registrarAtividadeWebhookSentinela({confirmado:false}) sem estado prévio é um no-op seguro (nunca lança)", async () => {
    await expect(registrarAtividadeWebhookSentinela("pedido-sem-cadeia", { confirmado: false })).resolves.toBeUndefined();
    expect(await carregarEstadoSentinela("pedido-sem-cadeia")).toBeNull();
  });
});
