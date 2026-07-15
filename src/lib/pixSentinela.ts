import { redis } from "./redis";
import {
  calcularIntervaloPorIdade,
  PIX_GUARDIAO_IDADE_MAXIMA_MS,
  PIX_SENTINELA_LOCK_TTL_SEGUNDOS,
  PIX_SENTINELA_ESTADO_TTL_SEGUNDOS,
  PIX_SENTINELA_BACKOFF_MULTIPLICADOR,
  PIX_SENTINELA_BACKOFF_MAX_MULTIPLICADOR,
  PIX_SENTINELA_COOLDOWN_RATE_LIMIT_SEGUNDOS,
} from "./pixAutoCheckConfig";
import { reconciliarPixMercadoPago, type ResumoReconciliacaoPix } from "./mercadoPagoReconciliacao";
import { incrementarContadorPix, registrarEventoObservabilidadePix, type EventoObservabilidadePix } from "./pixMetricas";
import type { PedidoComPix } from "./pix";

// Sentinela Pix (Nível 6.9) — camada determinística de COORDENAÇÃO de
// consultas ao Mercado Pago. NUNCA decide se um pagamento foi confirmado —
// isso continua vindo exclusivamente de reconciliarPixMercadoPago (que por
// sua vez só confirma com base na resposta autoritativa do Mercado Pago),
// do webhook (/api/pix/webhook) ou da confirmação manual protegida por
// senha (/api/orders/confirmar-pix-manual). O Sentinela só decide QUANDO
// uma consulta oficial pode acontecer: cadência, deduplicação de mensagens
// antigas, single-flight por pagamento e encerramento operacional da
// cadeia. Não é uma nova fonte da verdade financeira — é coordenação.

export type OrigemConsultaPix = "webhook" | "guardiao_qstash" | "painel" | "conciliador" | "manual";

export type PixSentinelaEstadoOperacional =
  | "ativo"
  | "confirmado"
  | "cancelado"
  | "expirado"
  | "encerrado_erro";

export type PixSentinelaEstado = {
  pedidoId: string;
  paymentId?: string;
  provider?: string;
  geracao: number;
  estadoOperacional: PixSentinelaEstadoOperacional;
  criadoEm: number;
  ultimaConsultaMercadoPagoEm?: number;
  proximaConsultaMercadoPagoEm?: number;
  ultimoResultadoOficial?: string;
  ultimaOrigemDaConsulta?: OrigemConsultaPix;
  ultimaAtividadeWebhookEm?: number;
  falhasConsecutivas: number;
  cooldownAte?: number;
  tentativaAtual: number;
  confirmadoEm?: number;
  encerradoEm?: number;
};

const ESTADO_PREFIXO = "pix:sentinela:estado:";
const LOCK_PREFIXO = "pix:sentinela:lock:";

function chaveEstado(pedidoId: string): string {
  return `${ESTADO_PREFIXO}${pedidoId}`;
}

function chaveLock(chaveConsulta: string): string {
  return `${LOCK_PREFIXO}${chaveConsulta}`;
}

export async function carregarEstadoSentinela(pedidoId: string): Promise<PixSentinelaEstado | null> {
  return (await redis.get<PixSentinelaEstado>(chaveEstado(pedidoId))) || null;
}

async function salvarEstadoSentinela(estado: PixSentinelaEstado): Promise<void> {
  await redis.set(chaveEstado(estado.pedidoId), estado, { ex: PIX_SENTINELA_ESTADO_TTL_SEGUNDOS });
}

// Cria (ou reaproveita, se já existir) o estado operacional inicial de um
// pedido — chamado uma única vez pelo início da cadeia server-side
// (iniciarCadeiaGuardiaoPix). Se um estado já existir para este pedidoId
// (ex.: chamada repetida), devolve a geração já existente em vez de
// reiniciar do zero, para nunca invalidar silenciosamente uma cadeia já em
// andamento.
export async function iniciarEstadoSentinela(input: {
  pedidoId: string;
  paymentId?: string;
  provider?: string;
  agora: number;
}): Promise<PixSentinelaEstado> {
  const existente = await carregarEstadoSentinela(input.pedidoId);
  if (existente) return existente;

  const estado: PixSentinelaEstado = {
    pedidoId: input.pedidoId,
    paymentId: input.paymentId,
    provider: input.provider,
    geracao: 1,
    estadoOperacional: "ativo",
    criadoEm: input.agora,
    falhasConsecutivas: 0,
    tentativaAtual: 0,
    proximaConsultaMercadoPagoEm: input.agora,
  };
  await salvarEstadoSentinela(estado);
  return estado;
}

type EncerramentoMotivo =
  | "confirmado"
  | "confirmado_manual"
  | "cancelado"
  | "expirado"
  | "pedido_inexistente"
  | "nao_mercadopago"
  | "pix_manual"
  | "falhas_excessivas";

// Encerra a cadeia operacional deste pedido: marca o estado como resolvido e
// incrementa a geração, fazendo qualquer tick QStash já agendado (com a
// geração anterior) virar no-op assim que chegar — sem precisar cancelar a
// mensagem no QStash em si. Idempotente: chamar mais de uma vez é seguro.
export async function encerrarSentinela(
  pedidoId: string,
  motivo: EncerramentoMotivo,
  agora: number = Date.now()
): Promise<void> {
  const estado = (await carregarEstadoSentinela(pedidoId)) || {
    pedidoId,
    geracao: 0,
    estadoOperacional: "ativo" as const,
    criadoEm: agora,
    falhasConsecutivas: 0,
    tentativaAtual: 0,
  };

  const estadoOperacional: PixSentinelaEstadoOperacional =
    motivo === "confirmado" || motivo === "confirmado_manual"
      ? "confirmado"
      : motivo === "cancelado"
        ? "cancelado"
        : motivo === "expirado"
          ? "expirado"
          : "encerrado_erro";

  await salvarEstadoSentinela({
    ...estado,
    geracao: estado.geracao + 1,
    estadoOperacional,
    confirmadoEm: estadoOperacional === "confirmado" ? agora : estado.confirmadoEm,
    encerradoEm: agora,
  });
}

// Chamado pelo webhook (/api/pix/webhook) após processar uma notificação —
// best-effort, nunca lança. Não substitui a confirmação do webhook (que
// continua gravando o pedido do jeito que já fazia); só atualiza a
// observabilidade do Sentinela e, quando o pagamento foi de fato confirmado
// nessa passagem, encerra a cadeia (mensagens QStash antigas viram no-op).
export async function registrarAtividadeWebhookSentinela(
  pedidoId: string,
  resultado: { confirmado: boolean },
  agora: number = Date.now()
): Promise<void> {
  try {
    if (resultado.confirmado) {
      await encerrarSentinela(pedidoId, "confirmado", agora);
      return;
    }
    const estado = await carregarEstadoSentinela(pedidoId);
    if (!estado) return;
    await salvarEstadoSentinela({ ...estado, ultimaAtividadeWebhookEm: agora });
  } catch {
    // Observabilidade nunca pode afetar o webhook — a confirmação já foi
    // persistida (ou não) antes desta chamada, independente do resultado aqui.
  }
}

export type DecisaoSentinela = {
  podeConsultar: boolean;
  motivo: string;
  encerrar: boolean;
  motivoEncerramento?: EncerramentoMotivo;
};

export type PedidoParaSentinela = {
  existe: boolean;
  provider?: string;
  pixStatus?: string;
  pixConfirmado?: boolean;
  statusPedido?: string;
  criadoEm?: number;
};

// Decisão pura — não lê nem escreve Redis, 100% testável sem mocks de
// infraestrutura. Implementa as 12 verificações do Sentinela na ordem.
export function avaliarDecisaoSentinela(input: {
  agora: number;
  estado: PixSentinelaEstado | null;
  pedido: PedidoParaSentinela;
  geracaoMensagem?: number;
  origem: OrigemConsultaPix;
  lockAtivo: boolean;
  cooldownGlobalAtivo: boolean;
}): DecisaoSentinela {
  const { agora, estado, pedido, geracaoMensagem, origem, lockAtivo, cooldownGlobalAtivo } = input;

  // 1. o pedido existe?
  if (!pedido.existe) {
    return { podeConsultar: false, motivo: "pedido_inexistente", encerrar: true, motivoEncerramento: "pedido_inexistente" };
  }

  // 2. o provider é Mercado Pago? (Pix manual por chave nunca entra no fluxo)
  if (pedido.provider !== "mercadopago") {
    const motivoEncerramento: EncerramentoMotivo = pedido.provider === "manual" ? "pix_manual" : "nao_mercadopago";
    return { podeConsultar: false, motivo: motivoEncerramento, encerrar: true, motivoEncerramento };
  }

  // 3. a geração da mensagem ainda é a geração atual? (mensagem antiga —
  // não encerra a cadeia inteira, só esta mensagem específica vira no-op;
  // a cadeia vigente (geração atual) segue seu próprio curso.)
  if (estado && geracaoMensagem !== undefined && geracaoMensagem !== estado.geracao) {
    return { podeConsultar: false, motivo: "geracao_antiga", encerrar: false };
  }

  // 4. pedido cancelado / já confirmado / expirado?
  if (pedido.statusPedido === "cancelado") {
    return { podeConsultar: false, motivo: "cancelado", encerrar: true, motivoEncerramento: "cancelado" };
  }
  if (pedido.pixConfirmado === true || pedido.pixStatus === "confirmado") {
    return { podeConsultar: false, motivo: "confirmado", encerrar: true, motivoEncerramento: "confirmado" };
  }
  const idadeMs = typeof pedido.criadoEm === "number" ? agora - pedido.criadoEm : 0;
  if (idadeMs >= PIX_GUARDIAO_IDADE_MAXIMA_MS) {
    return { podeConsultar: false, motivo: "expirado", encerrar: true, motivoEncerramento: "expirado" };
  }

  // Origem manual: confirmação manual não passa por aqui para consultar o
  // Mercado Pago (ela já confirma direto, sem precisar de consulta) — mas se
  // chegar, nunca é bloqueada pelas próximas checagens de cadência.
  if (origem === "manual") {
    return { podeConsultar: true, motivo: "manual_sem_gating", encerrar: false };
  }

  // 5/6. existe consulta em andamento (lock ativo)?
  if (lockAtivo) {
    return { podeConsultar: false, motivo: "lock_ativo", encerrar: false };
  }

  // 7. cooldown específico deste pagamento ativo?
  if (estado?.cooldownAte !== undefined && agora < estado.cooldownAte) {
    return { podeConsultar: false, motivo: "cooldown_ativo", encerrar: false };
  }

  // 8/11. rate limit global ativo?
  if (cooldownGlobalAtivo) {
    return { podeConsultar: false, motivo: "rate_limit_global", encerrar: false };
  }

  // 9. já passou da próxima consulta agendada? Webhook é evento-driven e
  // ignora esta checagem de cadência (mas ainda respeita lock/cooldown
  // acima) — ele só chega aqui via origem === "webhook".
  if (origem !== "webhook" && estado?.proximaConsultaMercadoPagoEm !== undefined && agora < estado.proximaConsultaMercadoPagoEm) {
    return { podeConsultar: false, motivo: "antes_da_janela", encerrar: false };
  }

  // 12. tudo permite — consulta autorizada.
  return { podeConsultar: true, motivo: "autorizado", encerrar: false };
}

export type ResultadoSolicitacaoPix = {
  consultou: boolean;
  motivo: string;
  encerrado: boolean;
  motivoEncerramento?: EncerramentoMotivo;
  proximaConsultaMercadoPagoEm?: number;
  resumoReconciliacao?: ResumoReconciliacaoPix;
};

function backoffMs(intervaloBaseMs: number, falhasConsecutivas: number): number {
  const multiplicador = Math.min(
    PIX_SENTINELA_BACKOFF_MAX_MULTIPLICADOR,
    Math.pow(PIX_SENTINELA_BACKOFF_MULTIPLICADOR, Math.max(0, falhasConsecutivas))
  );
  return Math.round(intervaloBaseMs * Math.max(1, multiplicador));
}

// Mapeia o motivo (já existente, produzido por avaliarDecisaoSentinela) para
// o evento específico de observabilidade adicional (Nível 6.10) — só
// telemetria, não influencia nenhuma decisão. motivos sem correspondência
// (ex.: "geracao_antiga", já coberto por sentinela_mensagem_antiga_ignorada
// no endpoint) retornam null e não geram evento extra.
function eventoObservabilidadeParaMotivo(motivo: string): EventoObservabilidadePix | null {
  switch (motivo) {
    case "lock_ativo":
      return "sentinela_bloqueio_lock";
    case "cooldown_ativo":
      return "sentinela_bloqueio_cooldown";
    case "rate_limit_global":
      return "sentinela_bloqueio_rate_limit";
    case "antes_da_janela":
      return "sentinela_bloqueio_proxima_consulta";
    default:
      return null;
  }
}

type PedidoSentinelaBruto = PedidoComPix & { pixConfirmado?: boolean; status?: string };

// Função central de coalescência — webhook, Guardião/QStash, painel e
// conciliador convergem aqui antes de qualquer consulta ao Mercado Pago.
// "Chamadas perdedoras" (lock já tomado, fora da janela, em cooldown etc.)
// retornam sucesso operacional SEM consultar o Mercado Pago — nunca é um
// erro, é o Sentinela fazendo seu trabalho de evitar consulta redundante.
export async function solicitarVerificacaoOficialPix(input: {
  pedidoId: string;
  origem: OrigemConsultaPix;
  geracaoMensagem?: number;
  agora?: number;
}): Promise<ResultadoSolicitacaoPix> {
  const agora = input.agora ?? Date.now();
  const pedidos = (await redis.get<PedidoSentinelaBruto[]>("pedidos")) || [];
  const pedidoBruto = pedidos.find((p) => p.id === input.pedidoId);

  const estado = await carregarEstadoSentinela(input.pedidoId);

  const pedidoParaSentinela: PedidoParaSentinela = {
    existe: !!pedidoBruto,
    provider: pedidoBruto?.pix?.provider,
    pixStatus: pedidoBruto?.pix?.status,
    pixConfirmado: pedidoBruto?.pixConfirmado,
    statusPedido: pedidoBruto?.status,
    criadoEm: pedidoBruto?.pix?.criadoEm ? new Date(pedidoBruto.pix.criadoEm).getTime() : undefined,
  };

  const chaveConsulta = pedidoBruto?.pix?.providerPaymentId?.trim() || input.pedidoId;

  // Lock de single-flight — verificado ANTES da decisão para refletir a
  // condição real no momento da avaliação (a decisão pura só recebe o
  // booleano já resolvido, mantendo avaliarDecisaoSentinela testável sem
  // Redis).
  const lockKey = chaveLock(chaveConsulta);
  const cooldownGlobalAtivo = !!(await redis.get("cooldown:mercadopago:reconciliacao"));

  const lockJaAtivo = !!(await redis.get(lockKey));
  const decisaoPreliminar = avaliarDecisaoSentinela({
    agora,
    estado,
    pedido: pedidoParaSentinela,
    geracaoMensagem: input.geracaoMensagem,
    origem: input.origem,
    lockAtivo: lockJaAtivo,
    cooldownGlobalAtivo,
  });

  if (decisaoPreliminar.encerrar) {
    await encerrarSentinela(input.pedidoId, decisaoPreliminar.motivoEncerramento || "cancelado", agora);
    await incrementarContadorPix("sentinela_cadeia_encerrada");
    return { consultou: false, motivo: decisaoPreliminar.motivo, encerrado: true, motivoEncerramento: decisaoPreliminar.motivoEncerramento };
  }

  if (!decisaoPreliminar.podeConsultar) {
    // Contador agregado existente — preservado exatamente como estava.
    await incrementarContadorPix("sentinela_consulta_evitada");
    // Observabilidade adicional (best-effort, nunca lança, nunca substitui
    // o contador agregado acima) — só quando o motivo mapeia para um dos
    // bloqueios específicos do painel /dev/pix.
    const eventoEspecifico = eventoObservabilidadeParaMotivo(decisaoPreliminar.motivo);
    if (eventoEspecifico) {
      await registrarEventoObservabilidadePix(eventoEspecifico, { agora }).catch(() => {});
    }
    return { consultou: false, motivo: decisaoPreliminar.motivo, encerrado: false };
  }

  // Adquire o lock (NX) — se outra execução venceu a corrida entre a
  // checagem acima e agora, esta chamada é a "perdedora": retorna sucesso
  // operacional sem consultar (coalescida).
  const lockAdquirido = await redis.set(lockKey, "1", { nx: true, ex: PIX_SENTINELA_LOCK_TTL_SEGUNDOS });
  if (!lockAdquirido) {
    await incrementarContadorPix("sentinela_consulta_coalescida");
    return { consultou: false, motivo: "coalescida", encerrado: false };
  }

  try {
    await incrementarContadorPix("sentinela_consulta_realizada");
    const resumo = await reconciliarPixMercadoPago({ apenasPedidoIds: [input.pedidoId] });
    const detalhe = resumo.detalhes.find((d) => d.pedidoId === input.pedidoId);

    const agoraPosConsulta = Date.now();
    const estadoAtual = (await carregarEstadoSentinela(input.pedidoId)) || estado;

    if (resumo.rateLimited) {
      const cooldownAte = agoraPosConsulta + PIX_SENTINELA_COOLDOWN_RATE_LIMIT_SEGUNDOS * 1000;
      await salvarEstadoSentinela({
        ...(estadoAtual as PixSentinelaEstado),
        pedidoId: input.pedidoId,
        ultimaConsultaMercadoPagoEm: agoraPosConsulta,
        ultimaOrigemDaConsulta: input.origem,
        ultimoResultadoOficial: "rate_limited",
        cooldownAte,
        tentativaAtual: (estadoAtual?.tentativaAtual || 0) + 1,
      });
      await incrementarContadorPix("rate_limited");
      return { consultou: true, motivo: "rate_limited", encerrado: false, proximaConsultaMercadoPagoEm: cooldownAte, resumoReconciliacao: resumo };
    }

    if (detalhe?.outcome === "confirmado" || resumo.confirmados > 0) {
      await encerrarSentinela(input.pedidoId, "confirmado", agoraPosConsulta);
      // Observabilidade adicional (best-effort, nunca lança, não afeta o
      // retorno abaixo, que já reflete a confirmação persistida acima).
      await registrarEventoObservabilidadePix("sentinela_confirmou", {
        ultimaConfirmacaoAutomatica: true,
        agora: agoraPosConsulta,
      }).catch(() => {});
      return { consultou: true, motivo: "confirmado", encerrado: true, motivoEncerramento: "confirmado", resumoReconciliacao: resumo };
    }

    const falhou = detalhe?.outcome === "erro";
    const falhasConsecutivas = falhou ? (estadoAtual?.falhasConsecutivas || 0) + 1 : 0;
    const idadeMs = pedidoParaSentinela.criadoEm ? agoraPosConsulta - pedidoParaSentinela.criadoEm : 0;
    const intervaloBase = calcularIntervaloPorIdade(idadeMs);
    const proximaConsultaMercadoPagoEm = agoraPosConsulta + (falhou ? backoffMs(intervaloBase, falhasConsecutivas) : intervaloBase);

    await salvarEstadoSentinela({
      ...(estadoAtual as PixSentinelaEstado),
      pedidoId: input.pedidoId,
      paymentId: pedidoBruto?.pix?.providerPaymentId,
      provider: pedidoBruto?.pix?.provider,
      ultimaConsultaMercadoPagoEm: agoraPosConsulta,
      ultimaOrigemDaConsulta: input.origem,
      ultimoResultadoOficial: detalhe?.outcome || "sem_resultado",
      falhasConsecutivas,
      proximaConsultaMercadoPagoEm,
      tentativaAtual: (estadoAtual?.tentativaAtual || 0) + 1,
    });

    return { consultou: true, motivo: detalhe?.outcome || "pendente", encerrado: false, proximaConsultaMercadoPagoEm, resumoReconciliacao: resumo };
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}
