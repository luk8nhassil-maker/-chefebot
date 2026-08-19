import { redis } from "./redis";
import {
  PLANOS_ASSINATURA_CHEFEBOT,
  avaliarAssinaturaChefeBot,
  calcularMudancaPlanoChefeBot,
  estadoInicialAssinaturaChefeBot,
  formatarDataLocalChefeBot,
  planoAssinaturaChefeBot,
  primeiraCobrancaImediataPendente,
  proximoVencimento,
  type EstadoAssinaturaChefeBot,
  type PlanoAssinaturaId,
} from "./assinaturaChefeBot";

// Namespace exclusivo do ChefeBot. Nunca reutiliza chaves/dados da São Francisco.
const STATE_KEY = "assinatura:chefebot:v1:state";
const INVOICE_PREFIX = "assinatura:chefebot:v1:invoice:";
const TRANSACTION_PREFIX = "assinatura:chefebot:v1:transaction:";
const SETTLEMENT_PREFIX = "assinatura:chefebot:v1:settlement:";

export type TipoFaturaAssinatura = "monthly" | "upgrade";

export type FaturaAssinaturaChefeBot = {
  orderNsu: string;
  type: TipoFaturaAssinatura;
  targetPlanId: PlanoAssinaturaId;
  amountCentavos: number;
  dueDate: string;
  status: "pending" | "paid";
  checkoutUrl?: string;
  createdAt: string;
  paidAt?: string;
  transactionNsu?: string;
  captureMethod?: "pix" | "credit_card" | string;
  invoiceSlug?: string;
  calculation?: {
    differenceCentavos: number;
    remainingDays: number;
    cycleDays: number;
  };
};

export function assinaturaInfinitePayConfigurada(): boolean {
  return Boolean(process.env.INFINITEPAY_HANDLE?.trim());
}

export async function lerEstadoAssinaturaChefeBot(): Promise<EstadoAssinaturaChefeBot> {
  const salvo = await redis.get<EstadoAssinaturaChefeBot>(STATE_KEY).catch(() => null);
  const plano = planoAssinaturaChefeBot(salvo?.activePlanId);
  if (!salvo || !plano || !/^\d{4}-\d{2}-\d{2}$/.test(salvo.nextDueDate || "")) {
    return estadoInicialAssinaturaChefeBot();
  }
  return {
    ...salvo,
    activePlanId: plano.id,
    pendingDowngradePlanId: planoAssinaturaChefeBot(salvo.pendingDowngradePlanId)?.id ?? null,
  };
}

export async function salvarEstadoAssinaturaChefeBot(estado: EstadoAssinaturaChefeBot): Promise<void> {
  await redis.set(STATE_KEY, { ...estado, updatedAt: new Date().toISOString() });
}

export async function statusAssinaturaChefeBot(hoje = formatarDataLocalChefeBot()) {
  const estado = await lerEstadoAssinaturaChefeBot();
  const avaliacao = avaliarAssinaturaChefeBot(estado, hoje);
  const configured = assinaturaInfinitePayConfigurada();
  return {
    estado,
    avaliacao: {
      ...avaliacao,
      // Fail-open operacional: sem a credencial própria do ChefeBot não há lockout.
      blocked: configured && avaliacao.blocked,
    },
    configured,
    plans: Object.values(PLANOS_ASSINATURA_CHEFEBOT),
  };
}

export async function assinaturaBloqueiaOperacao(): Promise<boolean> {
  if (!assinaturaInfinitePayConfigurada()) return false;
  const { avaliacao } = await statusAssinaturaChefeBot();
  return avaliacao.blocked;
}

function invoiceKey(orderNsu: string) {
  return `${INVOICE_PREFIX}${orderNsu}`;
}

export async function lerFaturaAssinaturaChefeBot(orderNsu: string): Promise<FaturaAssinaturaChefeBot | null> {
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(orderNsu)) return null;
  return redis.get<FaturaAssinaturaChefeBot>(invoiceKey(orderNsu)).catch(() => null);
}

export async function prepararMudancaPlanoChefeBot(targetPlanId: PlanoAssinaturaId, hoje = formatarDataLocalChefeBot()) {
  const target = PLANOS_ASSINATURA_CHEFEBOT[targetPlanId];
  const estado = await lerEstadoAssinaturaChefeBot();
  const current = PLANOS_ASSINATURA_CHEFEBOT[estado.activePlanId];
  const cicloAtualPago = Boolean(estado.paidThroughDate && estado.paidThroughDate > hoje);
  const mensalidadeVencida = hoje > estado.nextDueDate;
  const cobrancaInicialImediata = primeiraCobrancaImediataPendente(estado, hoje);
  const pagamentoDoCicloObrigatorio = mensalidadeVencida || cobrancaInicialImediata;

  // A dívida do ciclo fica congelada no plano que a originou.
  if (!cicloAtualPago && pagamentoDoCicloObrigatorio && targetPlanId !== current.id) {
    return {
      kind: "payment_required_before_change" as const,
      estado,
      currentPlanId: current.id,
      amountCentavos: current.valorCentavos,
      dueDate: estado.nextDueDate,
    };
  }

  if (!cicloAtualPago) {
    return {
      kind: "monthly" as const,
      estado,
      amountCentavos: target.valorCentavos,
      targetPlanId,
      dueDate: estado.nextDueDate,
    };
  }

  const change = calcularMudancaPlanoChefeBot({
    currentPlanId: current.id,
    targetPlanId,
    nextDueDate: estado.nextDueDate,
    today: hoje,
  });

  if (change.kind === "downgrade") {
    const atualizado: EstadoAssinaturaChefeBot = {
      ...estado,
      pendingDowngradePlanId: targetPlanId,
    };
    await salvarEstadoAssinaturaChefeBot(atualizado);
    return { kind: "downgrade" as const, estado: atualizado, effectiveOn: change.effectiveOn };
  }

  if (change.kind === "same") return { kind: "same" as const, estado };

  if (change.amountCentavos <= 0) {
    const atualizado = { ...estado, activePlanId: targetPlanId, pendingDowngradePlanId: null };
    await salvarEstadoAssinaturaChefeBot(atualizado);
    return { kind: "same" as const, estado: atualizado };
  }

  return {
    kind: "upgrade" as const,
    estado,
    amountCentavos: change.amountCentavos,
    targetPlanId,
    dueDate: estado.nextDueDate,
    calculation: {
      differenceCentavos: change.differenceCentavos,
      remainingDays: change.remainingDays,
      cycleDays: change.cycleDays,
    },
  };
}

export function orderNsuAssinatura(params: {
  type: TipoFaturaAssinatura;
  targetPlanId: PlanoAssinaturaId;
  dueDate: string;
  today: string;
}) {
  const due = params.dueDate.replaceAll("-", "");
  const today = params.today.replaceAll("-", "");
  return `chefebot-${params.type}-${params.targetPlanId}-${due}-${today}`;
}

export async function salvarFaturaAssinaturaChefeBot(fatura: FaturaAssinaturaChefeBot): Promise<void> {
  await redis.set(invoiceKey(fatura.orderNsu), fatura);
}

async function reservarChaveExclusiva(prefix: string, ownerId: string, resourceId: string): Promise<boolean> {
  const key = `${prefix}${resourceId}`;
  const owner = await redis.get<string>(key).catch(() => null);
  if (owner) return owner === ownerId;

  const claim = await redis.set(key, ownerId, { nx: true });
  if (claim) return true;

  const winner = await redis.get<string>(key).catch(() => null);
  return winner === ownerId;
}

export async function confirmarPagamentoAssinaturaChefeBot(params: {
  orderNsu: string;
  transactionNsu: string;
  amountCentavos: number;
  captureMethod?: string;
  invoiceSlug?: string;
}): Promise<{ ok: true; alreadyApplied: boolean } | { ok: false; reason: string }> {
  if (!params.transactionNsu || params.transactionNsu.length > 200) return { ok: false, reason: "invalid_transaction" };
  const fatura = await lerFaturaAssinaturaChefeBot(params.orderNsu);
  if (!fatura) return { ok: false, reason: "invoice_not_found" };
  if (params.amountCentavos !== fatura.amountCentavos) return { ok: false, reason: "amount_mismatch" };

  if (fatura.status === "paid") {
    if (fatura.transactionNsu === params.transactionNsu) return { ok: true, alreadyApplied: true };
    return { ok: false, reason: "invoice_already_paid" };
  }

  if (!(await reservarChaveExclusiva(TRANSACTION_PREFIX, fatura.orderNsu, params.transactionNsu))) {
    return { ok: false, reason: "transaction_reused" };
  }
  if (!(await reservarChaveExclusiva(SETTLEMENT_PREFIX, params.transactionNsu, fatura.orderNsu))) {
    return { ok: false, reason: "invoice_settlement_conflict" };
  }

  const estado = await lerEstadoAssinaturaChefeBot();
  const agoraIso = new Date().toISOString();
  let atualizado: EstadoAssinaturaChefeBot;

  if (fatura.type === "monthly") {
    const nextDue = proximoVencimento(fatura.dueDate);
    atualizado = {
      ...estado,
      activePlanId: fatura.targetPlanId,
      pendingDowngradePlanId: null,
      nextDueDate: nextDue,
      paidThroughDate: nextDue,
    };
  } else {
    atualizado = {
      ...estado,
      activePlanId: fatura.targetPlanId,
      pendingDowngradePlanId: null,
    };
  }

  const paga: FaturaAssinaturaChefeBot = {
    ...fatura,
    status: "paid",
    paidAt: agoraIso,
    transactionNsu: params.transactionNsu,
    captureMethod: params.captureMethod,
    invoiceSlug: params.invoiceSlug,
  };

  // Ordem recuperável e idempotente: retry da mesma transação pode reaplicar o estado determinístico.
  await salvarEstadoAssinaturaChefeBot(atualizado);
  await salvarFaturaAssinaturaChefeBot(paga);
  return { ok: true, alreadyApplied: false };
}
