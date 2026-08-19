export type PlanoAssinaturaId = "basic" | "plus" | "pro";

export type PlanoAssinatura = {
  id: PlanoAssinaturaId;
  nome: string;
  valorCentavos: number;
  creditosEvolucaoMensais: number;
};

// Mesmos planos e regras comerciais atualmente usados no piloto da São Francisco.
// Valores ficam exclusivamente no servidor em centavos inteiros.
export const PLANOS_ASSINATURA_CHEFEBOT: Record<PlanoAssinaturaId, PlanoAssinatura> = {
  basic: { id: "basic", nome: "Básico", valorCentavos: 24999, creditosEvolucaoMensais: 0 },
  plus: { id: "plus", nome: "Plus", valorCentavos: 38747, creditosEvolucaoMensais: 5 },
  pro: { id: "pro", nome: "Pro", valorCentavos: 51399, creditosEvolucaoMensais: 10 },
};

export const ASSINATURA_CHEFEBOT_DIA_VENCIMENTO = 20;
export const ASSINATURA_CHEFEBOT_PRIMEIRO_VENCIMENTO = "2026-08-20";
export const ASSINATURA_CHEFEBOT_COBRANCA_INICIAL_IMEDIATA_EM = "2026-08-19";
export const ASSINATURA_CHEFEBOT_DIAS_AVISO = 3;
export const ASSINATURA_CHEFEBOT_DIAS_CARENCIA = 2;
export const ASSINATURA_CHEFEBOT_FUSO = "America/Sao_Paulo";

export type EstadoAssinaturaChefeBot = {
  activePlanId: PlanoAssinaturaId;
  nextDueDate: string;
  paidThroughDate?: string | null;
  pendingDowngradePlanId?: PlanoAssinaturaId | null;
  updatedAt?: string;
};

export type StatusAssinaturaChefeBot = "regular" | "warning" | "due" | "grace" | "blocked";

export type AvaliacaoAssinaturaChefeBot = {
  status: StatusAssinaturaChefeBot;
  blocked: boolean;
  daysUntilDue: number;
  daysLate: number;
  currentPlan: PlanoAssinatura;
  nextPlan: PlanoAssinatura | null;
  dueDate: string;
};

export type CalculoMudancaPlano =
  | { kind: "same"; amountCentavos: 0 }
  | { kind: "downgrade"; amountCentavos: 0; effectiveOn: string }
  | {
      kind: "upgrade";
      amountCentavos: number;
      differenceCentavos: number;
      remainingDays: number;
      cycleDays: number;
    };

export function estadoInicialAssinaturaChefeBot(): EstadoAssinaturaChefeBot {
  return {
    activePlanId: "basic",
    nextDueDate: ASSINATURA_CHEFEBOT_PRIMEIRO_VENCIMENTO,
    paidThroughDate: null,
    pendingDowngradePlanId: null,
  };
}

export function planoAssinaturaChefeBot(value: unknown): PlanoAssinatura | null {
  if (typeof value !== "string") return null;
  return PLANOS_ASSINATURA_CHEFEBOT[value as PlanoAssinaturaId] ?? null;
}

function parseDateKey(dateKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("invalid_date_key");
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function formatarDataLocalChefeBot(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ASSINATURA_CHEFEBOT_FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function diferencaDias(dataInicial: string, dataFinal: string): number {
  return Math.round((parseDateKey(dataFinal).getTime() - parseDateKey(dataInicial).getTime()) / 86_400_000);
}

export function proximoVencimento(dataVencimento: string, diaVencimento = ASSINATURA_CHEFEBOT_DIA_VENCIMENTO): string {
  const atual = parseDateKey(dataVencimento);
  const ano = atual.getUTCFullYear();
  const mes = atual.getUTCMonth();
  const primeiroProximoMes = new Date(Date.UTC(ano, mes + 1, 1));
  const ultimoDiaProximoMes = new Date(Date.UTC(ano, mes + 2, 0)).getUTCDate();
  primeiroProximoMes.setUTCDate(Math.min(diaVencimento, ultimoDiaProximoMes));
  return primeiroProximoMes.toISOString().slice(0, 10);
}

export function vencimentoAnterior(dataVencimento: string, diaVencimento = ASSINATURA_CHEFEBOT_DIA_VENCIMENTO): string {
  const atual = parseDateKey(dataVencimento);
  const ano = atual.getUTCFullYear();
  const mes = atual.getUTCMonth();
  const primeiroMesAnterior = new Date(Date.UTC(ano, mes - 1, 1));
  const ultimoDiaMesAnterior = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  primeiroMesAnterior.setUTCDate(Math.min(diaVencimento, ultimoDiaMesAnterior));
  return primeiroMesAnterior.toISOString().slice(0, 10);
}

export function primeiraCobrancaImediataPendente(
  estado: EstadoAssinaturaChefeBot,
  hoje = formatarDataLocalChefeBot(),
): boolean {
  return estado.nextDueDate === ASSINATURA_CHEFEBOT_PRIMEIRO_VENCIMENTO
    && !estado.paidThroughDate
    && hoje >= ASSINATURA_CHEFEBOT_COBRANCA_INICIAL_IMEDIATA_EM;
}

export function avaliarAssinaturaChefeBot(
  estado: EstadoAssinaturaChefeBot,
  hoje = formatarDataLocalChefeBot(),
): AvaliacaoAssinaturaChefeBot {
  const daysUntilDue = diferencaDias(hoje, estado.nextDueDate);
  const daysLate = Math.max(0, -daysUntilDue);
  let status: StatusAssinaturaChefeBot = "regular";

  if (primeiraCobrancaImediataPendente(estado, hoje)) status = "blocked";
  else if (daysUntilDue > 0 && daysUntilDue <= ASSINATURA_CHEFEBOT_DIAS_AVISO) status = "warning";
  else if (daysUntilDue === 0) status = "due";
  else if (daysLate > 0 && daysLate <= ASSINATURA_CHEFEBOT_DIAS_CARENCIA) status = "grace";
  else if (daysLate > ASSINATURA_CHEFEBOT_DIAS_CARENCIA) status = "blocked";

  return {
    status,
    blocked: status === "blocked",
    daysUntilDue,
    daysLate,
    currentPlan: PLANOS_ASSINATURA_CHEFEBOT[estado.activePlanId],
    nextPlan: estado.pendingDowngradePlanId ? PLANOS_ASSINATURA_CHEFEBOT[estado.pendingDowngradePlanId] : null,
    dueDate: estado.nextDueDate,
  };
}

export function calcularMudancaPlanoChefeBot(params: {
  currentPlanId: PlanoAssinaturaId;
  targetPlanId: PlanoAssinaturaId;
  nextDueDate: string;
  today: string;
}): CalculoMudancaPlano {
  const atual = PLANOS_ASSINATURA_CHEFEBOT[params.currentPlanId];
  const alvo = PLANOS_ASSINATURA_CHEFEBOT[params.targetPlanId];

  if (atual.id === alvo.id) return { kind: "same", amountCentavos: 0 };
  if (alvo.valorCentavos < atual.valorCentavos) {
    return { kind: "downgrade", amountCentavos: 0, effectiveOn: params.nextDueDate };
  }

  const inicioCiclo = vencimentoAnterior(params.nextDueDate);
  const cycleDays = diferencaDias(inicioCiclo, params.nextDueDate);
  const remainingDays = Math.max(0, diferencaDias(params.today, params.nextDueDate));
  const differenceCentavos = alvo.valorCentavos - atual.valorCentavos;
  const amountCentavos = Math.round((differenceCentavos * remainingDays) / Math.max(1, cycleDays));

  return {
    kind: "upgrade",
    amountCentavos,
    differenceCentavos,
    remainingDays,
    cycleDays,
  };
}

export function formatarMoedaCentavos(valorCentavos: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valorCentavos / 100);
}
