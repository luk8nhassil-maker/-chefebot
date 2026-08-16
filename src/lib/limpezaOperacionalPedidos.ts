// Acompanhamento operacional de pedidos — lógica pura, sem I/O.
//
// O objetivo é impedir que um pedido fique esquecido no meio do processo.
// Cada etapa tem um prazo; ao estourar, o painel apresenta uma decisão
// obrigatória. A interface nunca decide o que aconteceu sozinha, mas também
// não permite que a equipe ignore indefinidamente um pedido atrasado.

/** Pix pendente há mais que isto num pedido ainda não aceito. */
export const LIMIAR_PIX_PENDENTE_MIN = 20;
/** Pedido novo sem aceite da loja há mais que isto. */
export const LIMIAR_NOVO_SEM_ACEITE_MIN = 15;
/** Pedido em preparo há mais que isto. */
export const LIMIAR_PREPARO_MIN = 75;
/** Pedido que saiu para entrega há mais que isto. */
export const LIMIAR_ENTREGA_MIN = 60;
/** Depois de confirmar que a cozinha ainda está fazendo, cobrar de novo. */
export const LIMIAR_REAVISO_PREPARO_MIN = 5;

/** Fuso fixo do estabelecimento: nunca depende do fuso do navegador. */
export const FUSO_OPERACIONAL = "America/Sao_Paulo";

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 24 * 60 * MS_POR_MINUTO;
const TOLERANCIA_FUTURO_MS = 2 * MS_POR_MINUTO;

const STATUS_TERMINAIS = ["entregue", "cancelado"] as const;

export type MotivoPendencia =
  | "pagamento_pix_pendente"
  | "novo_sem_aceite"
  | "preparo_longo"
  | "entrega_longa";

export type AcaoLimpeza = "avancou" | "cancelou" | "verificou_pagamento" | "adiou";

/**
 * Última decisão operacional registrada no pedido. Continua sendo um campo
 * único e retrocompatível: cada nova decisão substitui a anterior, enquanto
 * statusAtualizadoEm marca o início do novo ciclo de cobrança.
 */
export type RegistroLimpeza = {
  motivo: MotivoPendencia;
  acao: AcaoLimpeza;
  resolvidoEm: string;
  resolvidoPor?: string;
};

export type PedidoLimpeza = {
  id?: string;
  numero?: number;
  cliente?: string;
  status?: string;
  isArchived?: boolean;
  horario?: string;
  horarioInicio?: string;
  statusAtualizadoEm?: string;
  pagamento?: string;
  pixConfirmado?: boolean;
  pix?: { status?: string; criadoEm?: string; confirmadoEm?: string } | null;
  limpezaOperacional?: RegistroLimpeza | null;
  tipoEntrega?: string;
  endereco?: string;
};

export type Pendencia = {
  pedidoId: string;
  numero?: number;
  cliente?: string;
  status: string;
  motivo: MotivoPendencia;
  idadeMinutos: number;
  titulo: string;
  descricao: string;
  tipoEntrega?: string;
  endereco?: string;
};

// ---------------------------------------------------------------------------
// Tempo no fuso do estabelecimento
// ---------------------------------------------------------------------------

type PartesData = {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
};

function partesNoFuso(ms: number): PartesData | null {
  if (!Number.isFinite(ms)) return null;
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO_OPERACIONAL,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));

    const pegar = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
    const resultado: PartesData = {
      ano: pegar("year"),
      mes: pegar("month"),
      dia: pegar("day"),
      hora: pegar("hour") % 24,
      minuto: pegar("minute"),
      segundo: pegar("second"),
    };
    return Object.values(resultado).every(Number.isFinite) ? resultado : null;
  } catch {
    return null;
  }
}

function deslocamentoFusoMs(ms: number): number | null {
  const p = partesNoFuso(ms);
  if (!p) return null;
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - (ms - (ms % 1000));
}

/**
 * Converte HH:MM para o timestamp local mais recente. Se o horário parecer
 * estar no futuro, ele pertence ao dia anterior, cobrindo a virada da noite.
 */
export function timestampDeHoraLocal(hhmm: string | undefined, agora: number): number | null {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;

  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (!Number.isFinite(hora) || !Number.isFinite(minuto)) return null;
  if (hora > 23 || minuto > 59) return null;

  const partes = partesNoFuso(agora);
  const deslocamento = deslocamentoFusoMs(agora);
  if (!partes || deslocamento === null) return null;

  let ts = Date.UTC(partes.ano, partes.mes - 1, partes.dia, hora, minuto, 0) - deslocamento;
  if (ts > agora + TOLERANCIA_FUTURO_MS) ts -= MS_POR_DIA;
  return Number.isFinite(ts) ? ts : null;
}

function parseIso(valor: string | undefined | null): number | null {
  if (!valor || typeof valor !== "string") return null;
  const ts = Date.parse(valor);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Timestamp de criação do pedido. IDs oficiais usam Date.now(); em uma rara
 * colisão recebem dígitos extras, portanto os 13 primeiros continuam sendo o
 * timestamp original. Depois caímos para Pix e HH:MM dos pedidos legados.
 */
export function timestampPedido(pedido: PedidoLimpeza, agora: number): number | null {
  const id = pedido.id;
  if (typeof id === "string" && /^\d{13,15}$/.test(id)) {
    const ts = Number(id.slice(0, 13));
    if (Number.isFinite(ts)) return ts;
  }

  const doPix = parseIso(pedido.pix?.criadoEm) ?? parseIso(pedido.pix?.confirmadoEm);
  if (doPix !== null) return doPix;

  return timestampDeHoraLocal(pedido.horario, agora);
}

function registroEhAdiamentoDaEtapa(pedido: PedidoLimpeza, motivo: MotivoPendencia): boolean {
  return pedido.limpezaOperacional?.acao === "adiou" && pedido.limpezaOperacional.motivo === motivo;
}

/** Timestamp de entrada no ciclo atual da etapa, nunca a idade total do pedido. */
export function timestampDaEtapa(pedido: PedidoLimpeza, agora: number): number | null {
  const status = pedido.status || "";

  if (status !== "novo") {
    const carimbo = parseIso(pedido.statusAtualizadoEm);
    if (carimbo !== null) return carimbo;
  }

  // Novo normalmente mede desde a criação. Só passa a usar o carimbo do
  // próprio status quando o atendente escolheu explicitamente "aguardar".
  if (
    status === "novo" &&
    (registroEhAdiamentoDaEtapa(pedido, "novo_sem_aceite") ||
      registroEhAdiamentoDaEtapa(pedido, "pagamento_pix_pendente"))
  ) {
    const carimbo = parseIso(pedido.statusAtualizadoEm) ?? parseIso(pedido.limpezaOperacional?.resolvidoEm);
    if (carimbo !== null) return carimbo;
  }

  if (status === "em_preparo") {
    const inicio = timestampDeHoraLocal(pedido.horarioInicio, agora);
    if (inicio !== null) return inicio;
  }

  return timestampPedido(pedido, agora);
}

export function idadeDaEtapaMinutos(pedido: PedidoLimpeza, agora: number): number {
  const inicio = timestampDaEtapa(pedido, agora);
  if (inicio === null) return 0;
  const decorrido = agora - inicio;
  if (!Number.isFinite(decorrido) || decorrido <= 0) return 0;
  return Math.floor(decorrido / MS_POR_MINUTO);
}

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

function temPix(pagamento: string | undefined): boolean {
  return !!pagamento && /\bpix\b/i.test(pagamento);
}

function pixAindaPendente(pedido: PedidoLimpeza): boolean {
  if (!temPix(pedido.pagamento)) return false;
  if (pedido.pixConfirmado === true) return false;
  return pedido.pix?.status !== "confirmado";
}

function textoIdade(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;
}

function limiarDaPendencia(pedido: PedidoLimpeza, motivo: MotivoPendencia): number {
  if (!registroEhAdiamentoDaEtapa(pedido, motivo)) {
    if (motivo === "pagamento_pix_pendente") return LIMIAR_PIX_PENDENTE_MIN;
    if (motivo === "novo_sem_aceite") return LIMIAR_NOVO_SEM_ACEITE_MIN;
    if (motivo === "preparo_longo") return LIMIAR_PREPARO_MIN;
    return LIMIAR_ENTREGA_MIN;
  }

  // Regras confirmadas do fluxo:
  // - NOVO espera novamente o mesmo tempo inicial;
  // - cozinha atrasada volta em 5 min;
  // - NA RUA usa novamente o limite já existente, sem inventar novo prazo.
  if (motivo === "preparo_longo") return LIMIAR_REAVISO_PREPARO_MIN;
  if (motivo === "novo_sem_aceite") return LIMIAR_NOVO_SEM_ACEITE_MIN;
  if (motivo === "pagamento_pix_pendente") return LIMIAR_PIX_PENDENTE_MIN;
  return LIMIAR_ENTREGA_MIN;
}

/** Um pedido produz no máximo uma decisão obrigatória por vez. */
export function classificarPendencia(pedido: PedidoLimpeza, agora: number): Pendencia | null {
  if (!pedido || typeof pedido.id !== "string" || !pedido.id) return null;
  if (pedido.isArchived) return null;

  const status = pedido.status || "";
  if ((STATUS_TERMINAIS as readonly string[]).includes(status)) return null;

  const idadeMinutos = idadeDaEtapaMinutos(pedido, agora);
  const idade = textoIdade(idadeMinutos);
  const base = {
    pedidoId: pedido.id,
    numero: pedido.numero,
    cliente: pedido.cliente,
    status,
    idadeMinutos,
    tipoEntrega: pedido.tipoEntrega,
    endereco: pedido.endereco,
  };

  // Pix continua protegido. Enquanto o dinheiro não estiver confirmado, não
  // mostramos a ação normal de mandar para a cozinha. O primeiro alerta de
  // Pix respeita seu limiar já existente de 20 min.
  if (status === "novo" && pixAindaPendente(pedido)) {
    if (idadeMinutos < limiarDaPendencia(pedido, "pagamento_pix_pendente")) return null;
    return {
      ...base,
      motivo: "pagamento_pix_pendente",
      titulo: `Pix não confirmado há ${idade}`,
      descricao:
        "O pagamento ainda não foi confirmado. Verifique no Mercado Pago antes de liberar este pedido para a cozinha.",
    };
  }

  if (status === "novo" && idadeMinutos >= limiarDaPendencia(pedido, "novo_sem_aceite")) {
    return {
      ...base,
      motivo: "novo_sem_aceite",
      titulo: `Pedido aguardando há ${idade}`,
      descricao:
        "O pedido chegou e ainda não foi iniciado. Escolha o que está acontecendo para ele não ficar esquecido.",
    };
  }

  if (status === "em_preparo" && idadeMinutos >= limiarDaPendencia(pedido, "preparo_longo")) {
    return {
      ...base,
      motivo: "preparo_longo",
      titulo: `Pedido atrasado na cozinha · ${idade}`,
      descricao:
        "O tempo previsto da cozinha estourou. Confirme se o pedido já avançou ou se ainda está sendo preparado.",
    };
  }

  if (status === "saiu_entrega" && idadeMinutos >= limiarDaPendencia(pedido, "entrega_longa")) {
    return {
      ...base,
      motivo: "entrega_longa",
      titulo: `Pedido ainda não finalizado · ${idade}`,
      descricao:
        "Este pedido continua na etapa de saída. Confirme a conclusão ou informe que ele ainda está nessa etapa.",
    };
  }

  return null;
}

const PRIORIDADE: Record<MotivoPendencia, number> = {
  pagamento_pix_pendente: 0,
  entrega_longa: 1,
  preparo_longo: 2,
  novo_sem_aceite: 3,
};

export function listarPendencias(pedidos: readonly PedidoLimpeza[], agora: number): Pendencia[] {
  if (!Array.isArray(pedidos)) return [];
  return pedidos
    .map((pedido) => classificarPendencia(pedido, agora))
    .filter((p): p is Pendencia => p !== null)
    .sort((a, b) => {
      const porPrioridade = PRIORIDADE[a.motivo] - PRIORIDADE[b.motivo];
      return porPrioridade !== 0 ? porPrioridade : b.idadeMinutos - a.idadeMinutos;
    });
}

// ---------------------------------------------------------------------------
// Ações oferecidas
// ---------------------------------------------------------------------------

export type OpcaoResolucao = {
  label: string;
  acao: AcaoLimpeza;
  status?: string;
  tom?: "principal" | "secundario" | "perigo";
};

type ClassificacaoEntrega = "delivery" | "retirada" | "dine_in";

function classificarEntrega(pendencia: Pendencia): ClassificacaoEntrega {
  if (pendencia.tipoEntrega === "dine_in" || pendencia.endereco === "Consumo no local") return "dine_in";
  if (
    pendencia.tipoEntrega === "retirada" ||
    pendencia.tipoEntrega === "pickup" ||
    pendencia.endereco === "Retirada na loja"
  ) {
    return "retirada";
  }
  return "delivery";
}

export function acaoPrincipal(pendencia: Pendencia): OpcaoResolucao {
  if (pendencia.motivo === "pagamento_pix_pendente") {
    return {
      label: "VERIFICAR PAGAMENTO NO MERCADO PAGO",
      acao: "verificou_pagamento",
      tom: "principal",
    };
  }

  if (pendencia.status === "novo") {
    return { label: "COMEÇAR A FAZER", acao: "avancou", status: "em_preparo", tom: "principal" };
  }

  if (pendencia.status === "em_preparo") {
    const entrega = classificarEntrega(pendencia);
    if (entrega === "dine_in") {
      return { label: "PEDIDO PRONTO", acao: "avancou", status: "entregue", tom: "principal" };
    }
    if (entrega === "retirada") {
      return {
        label: "PRONTO PARA RETIRADA",
        acao: "avancou",
        status: "saiu_entrega",
        tom: "principal",
      };
    }
    return {
      label: "SAIU PARA ENTREGA",
      acao: "avancou",
      status: "saiu_entrega",
      tom: "principal",
    };
  }

  if (pendencia.status === "saiu_entrega") {
    const entrega = classificarEntrega(pendencia);
    return {
      label: entrega === "retirada" ? "FINALIZAR RETIRADA" : "CONFIRMAR ENTREGA",
      acao: "avancou",
      status: "entregue",
      tom: "principal",
    };
  }

  return { label: "CANCELAR PEDIDO", acao: "cancelou", status: "cancelado", tom: "perigo" };
}

export function acaoSecundaria(pendencia: Pendencia): OpcaoResolucao {
  if (pendencia.motivo === "pagamento_pix_pendente") {
    return {
      label: `AGUARDAR MAIS ${LIMIAR_PIX_PENDENTE_MIN} MIN`,
      acao: "adiou",
      status: "novo",
      tom: "secundario",
    };
  }

  if (pendencia.status === "novo") {
    return {
      label: `AGUARDAR MAIS ${LIMIAR_NOVO_SEM_ACEITE_MIN} MIN`,
      acao: "adiou",
      status: "novo",
      tom: "secundario",
    };
  }

  if (pendencia.status === "em_preparo") {
    return {
      label: `AINDA ESTÁ FAZENDO · LEMBRAR EM ${LIMIAR_REAVISO_PREPARO_MIN} MIN`,
      acao: "adiou",
      status: "em_preparo",
      tom: "secundario",
    };
  }

  if (pendencia.status === "saiu_entrega") {
    const entrega = classificarEntrega(pendencia);
    return {
      label: entrega === "retirada" ? "AINDA AGUARDANDO RETIRADA" : "AINDA ESTÁ NA RUA",
      acao: "adiou",
      status: "saiu_entrega",
      tom: "secundario",
    };
  }

  return { label: "CANCELAR PEDIDO", acao: "cancelou", status: "cancelado", tom: "perigo" };
}

/**
 * A terceira ação só existe no estado NOVO/Pix. Nas etapas seguintes o usuário
 * pediu decisão binária: avançou ou ainda está naquela etapa.
 */
export function acaoTerciaria(pendencia: Pendencia): OpcaoResolucao | null {
  if (pendencia.status !== "novo") return null;
  return { label: "Cancelar pedido", acao: "cancelou", status: "cancelado", tom: "perigo" };
}

const MOTIVOS: readonly MotivoPendencia[] = [
  "pagamento_pix_pendente",
  "novo_sem_aceite",
  "preparo_longo",
  "entrega_longa",
];
const ACOES: readonly AcaoLimpeza[] = ["avancou", "cancelou", "verificou_pagamento", "adiou"];

export function sanitizarEntradaLimpeza(
  valor: unknown
): { motivo: MotivoPendencia; acao: AcaoLimpeza } | null {
  if (!valor || typeof valor !== "object") return null;
  const bruto = valor as { motivo?: unknown; acao?: unknown };
  const motivo = MOTIVOS.find((m) => m === bruto.motivo);
  const acao = ACOES.find((a) => a === bruto.acao);
  if (!motivo || !acao) return null;
  return { motivo, acao };
}

export function registrarResolucao(
  motivo: MotivoPendencia,
  acao: AcaoLimpeza,
  agora: number,
  resolvidoPor?: string
): RegistroLimpeza {
  return {
    motivo,
    acao,
    resolvidoEm: new Date(agora).toISOString(),
    ...(resolvidoPor ? { resolvidoPor } : {}),
  };
}

// ---------------------------------------------------------------------------
// Análise do período
// ---------------------------------------------------------------------------

export type AnaliseOperacional = {
  totalResolvidas: number;
  resolvidasHoje: number;
  porMotivo: Record<MotivoPendencia, number>;
  taxaAbandono: number;
  pendentesAgora: number;
};

function mesmoDiaNoFuso(a: number, b: number): boolean {
  const pa = partesNoFuso(a);
  const pb = partesNoFuso(b);
  if (!pa || !pb) return false;
  return pa.ano === pb.ano && pa.mes === pb.mes && pa.dia === pb.dia;
}

const MOTIVO_ZERADO: Record<MotivoPendencia, number> = {
  pagamento_pix_pendente: 0,
  novo_sem_aceite: 0,
  preparo_longo: 0,
  entrega_longa: 0,
};

export function calcularAnaliseOperacional(
  pedidos: readonly PedidoLimpeza[],
  agora: number
): AnaliseOperacional {
  const porMotivo = { ...MOTIVO_ZERADO };
  let totalResolvidas = 0;
  let resolvidasHoje = 0;
  let cancelamentos = 0;

  for (const pedido of Array.isArray(pedidos) ? pedidos : []) {
    const registro = pedido?.limpezaOperacional;
    const motivo = registro ? MOTIVOS.find((m) => m === registro.motivo) : undefined;
    // "Aguardar" é uma confirmação de acompanhamento, não uma resolução.
    if (!registro || !motivo || registro.acao === "adiou") continue;

    totalResolvidas += 1;
    porMotivo[motivo] += 1;
    if (registro.acao === "cancelou") cancelamentos += 1;

    const quando = parseIso(registro.resolvidoEm);
    if (quando !== null && mesmoDiaNoFuso(quando, agora)) resolvidasHoje += 1;
  }

  return {
    totalResolvidas,
    resolvidasHoje,
    porMotivo,
    taxaAbandono: totalResolvidas === 0 ? 0 : cancelamentos / totalResolvidas,
    pendentesAgora: listarPendencias(pedidos, agora).length,
  };
}
