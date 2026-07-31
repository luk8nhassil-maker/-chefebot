// Limpeza operacional de pedidos — lógica pura, sem I/O.
//
// Problema que este módulo resolve: pedidos que ficam parados numa etapa e
// nunca chegam a um estado terminal. Eles não somem sozinhos do painel, não
// aparecem em nenhum relatório e vão empilhando ruído até a equipe deixar de
// confiar na lista. A rede final é classificar essa parada, apresentar uma
// decisão por vez e registrar no próprio pedido POR QUE ela foi resolvida.
//
// Direção do erro escolhida de propósito: quando não dá para determinar a
// idade da etapa, a idade é 0 e o pedido NÃO gera pendência. Um falso negativo
// é silencioso; um falso positivo entulharia o painel com alarme falso durante
// o horário de pico, que é exatamente quando ninguém tem tempo de conferir.
//
// Os limiares abaixo são política operacional do ChefeBot — constantes
// nomeadas e exportadas para poderem ser ajustadas e testadas em um lugar só.

/** Pix pendente há mais que isto num pedido ainda não aceito. */
export const LIMIAR_PIX_PENDENTE_MIN = 20;
/** Pedido novo sem aceite da loja há mais que isto. */
export const LIMIAR_NOVO_SEM_ACEITE_MIN = 15;
/** Pedido em preparo há mais que isto. */
export const LIMIAR_PREPARO_MIN = 75;
/** Pedido que saiu para entrega há mais que isto. */
export const LIMIAR_ENTREGA_MIN = 60;

/** Fuso fixo do estabelecimento: comparação de "mesmo dia" e reconstrução de
 * horários "HH:MM" nunca dependem do fuso do navegador de quem abriu o painel. */
export const FUSO_OPERACIONAL = "America/Sao_Paulo";

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 24 * 60 * MS_POR_MINUTO;
/** Folga para divergência de relógio antes de considerar um horário "no futuro". */
const TOLERANCIA_FUTURO_MS = 2 * MS_POR_MINUTO;

const STATUS_TERMINAIS = ["entregue", "cancelado"] as const;

export type MotivoPendencia =
  | "pagamento_pix_pendente"
  | "novo_sem_aceite"
  | "preparo_longo"
  | "entrega_longa";

export type AcaoLimpeza = "avancou" | "cancelou" | "verificou_pagamento";

/** Registro durável gravado no próprio pedido quando a pendência é resolvida. */
export type RegistroLimpeza = {
  motivo: MotivoPendencia;
  acao: AcaoLimpeza;
  resolvidoEm: string;
  resolvidoPor?: string;
};

/** Forma mínima do pedido que este módulo precisa — deliberadamente estreita,
 * para que a classificação possa ser testada sem montar um pedido inteiro. */
export type PedidoLimpeza = {
  id?: string;
  numero?: number;
  cliente?: string;
  status?: string;
  isArchived?: boolean;
  /** "HH:MM" no fuso do estabelecimento (criação). */
  horario?: string;
  /** "HH:MM" no fuso do estabelecimento (entrada em preparo). */
  horarioInicio?: string;
  /** ISO 8601 da última mudança de status. */
  statusAtualizadoEm?: string;
  pagamento?: string;
  pixConfirmado?: boolean;
  pix?: { status?: string; criadoEm?: string; confirmadoEm?: string } | null;
  limpezaOperacional?: RegistroLimpeza | null;
};

export type Pendencia = {
  pedidoId: string;
  numero?: number;
  cliente?: string;
  status: string;
  motivo: MotivoPendencia;
  idadeMinutos: number;
  /** Texto já redigido — a interface não monta mensagem. */
  titulo: string;
  descricao: string;
};

// ---------------------------------------------------------------------------
// Tempo no fuso do estabelecimento
// ---------------------------------------------------------------------------

type PartesData = { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number };

function partesNoFuso(ms: number): PartesData | null {
  if (!Number.isFinite(ms)) return null;
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO_OPERACIONAL,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));

    const pegar = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
    const resultado: PartesData = {
      ano: pegar("year"), mes: pegar("month"), dia: pegar("day"),
      // hourCycle h23 pode devolver "24" para meia-noite em alguns runtimes.
      hora: pegar("hour") % 24, minuto: pegar("minute"), segundo: pegar("second"),
    };
    return Object.values(resultado).every(Number.isFinite) ? resultado : null;
  } catch {
    // Runtime sem base de fusos: sem reconstrução de horário, a idade cai
    // para 0 e nenhuma pendência é acusada (direção segura do erro).
    return null;
  }
}

/** Quanto o relógio do fuso está deslocado em relação ao UTC neste instante. */
function deslocamentoFusoMs(ms: number): number | null {
  const p = partesNoFuso(ms);
  if (!p) return null;
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // O milissegundo é descartado pelo formatador; reintroduzido para não gerar
  // um deslocamento com sobra de até 999ms.
  return comoUtc - (ms - (ms % 1000));
}

/**
 * Converte um horário "HH:MM" do fuso do estabelecimento no timestamp mais
 * recente que não esteja no futuro em relação a `agora`. Um pedido feito às
 * 23:50 e consultado às 00:10 pertence ao dia anterior — sem esse ajuste a
 * idade viraria negativa (ou ~24h) exatamente na virada do dia.
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
 * Timestamp de criação do pedido, por cadeia de fallback: o próprio ID (que é
 * um `Date.now()` de 13 dígitos, ver POST /api/orders e /api/pedido-app),
 * depois os carimbos do Pix, depois o horário "HH:MM" da criação.
 * Cada etapa valida antes de aceitar; `null` quando nada resolve.
 */
export function timestampPedido(pedido: PedidoLimpeza, agora: number): number | null {
  const id = pedido.id;
  if (typeof id === "string" && /^\d{13}$/.test(id)) {
    const ts = Number(id);
    if (Number.isFinite(ts)) return ts;
  }

  const doPix = parseIso(pedido.pix?.confirmadoEm) ?? parseIso(pedido.pix?.criadoEm);
  if (doPix !== null) return doPix;

  return timestampDeHoraLocal(pedido.horario, agora);
}

/**
 * Timestamp de entrada na ETAPA ATUAL — não da criação do pedido. Um pedido
 * criado há 3 horas mas que entrou em preparo há 5 minutos não está parado.
 */
export function timestampDaEtapa(pedido: PedidoLimpeza, agora: number): number | null {
  const status = pedido.status || "";

  if (status && status !== "novo") {
    const carimbo = parseIso(pedido.statusAtualizadoEm);
    if (carimbo !== null) return carimbo;
  }
  if (status === "em_preparo") {
    const inicio = timestampDeHoraLocal(pedido.horarioInicio, agora);
    if (inicio !== null) return inicio;
  }
  return timestampPedido(pedido, agora);
}

/** Idade da etapa atual em minutos inteiros. `0` quando indeterminada. */
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

// Mesma definição de "tem Pix" usada por temPixNoPagamento em src/lib/bot.ts.
// Repetida aqui de propósito: este módulo é importado pelo painel no cliente e
// não deve arrastar o motor de conversa inteiro para o bundle.
function temPix(pagamento: string | undefined): boolean {
  return !!pagamento && /\bpix\b/i.test(pagamento);
}

function pixAindaPendente(pedido: PedidoLimpeza): boolean {
  if (!temPix(pedido.pagamento)) return false;
  if (pedido.pixConfirmado === true) return false;
  const status = pedido.pix?.status;
  return status !== "confirmado";
}

function textoIdade(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;
}

/**
 * Classifica um pedido em NO MÁXIMO uma pendência. A avaliação é em cascata,
 * do motivo mais crítico para o menos: um pedido produz um motivo, nunca uma
 * lista — a equipe decide uma coisa de cada vez.
 */
export function classificarPendencia(pedido: PedidoLimpeza, agora: number): Pendencia | null {
  if (!pedido || typeof pedido.id !== "string" || !pedido.id) return null;
  // Arquivado ou terminal nunca gera pendência — checado antes de qualquer
  // cálculo de idade, que é a parte cara e a que pode errar.
  if (pedido.isArchived) return null;
  const status = pedido.status || "";
  if ((STATUS_TERMINAIS as readonly string[]).includes(status)) return null;
  // Já resolvido: o registro durável é o que impede a pendência de voltar.
  if (pedido.limpezaOperacional) return null;

  const idadeMinutos = idadeDaEtapaMinutos(pedido, agora);
  const idade = textoIdade(idadeMinutos);
  const base = {
    pedidoId: pedido.id,
    numero: pedido.numero,
    cliente: pedido.cliente,
    status,
    idadeMinutos,
  };

  if (status === "novo" && pixAindaPendente(pedido) && idadeMinutos >= LIMIAR_PIX_PENDENTE_MIN) {
    return {
      ...base,
      motivo: "pagamento_pix_pendente",
      titulo: `Pix não confirmado há ${idade}`,
      descricao:
        "O cliente escolheu Pix e o pagamento não entrou. Verifique no Mercado Pago antes de decidir — se o Pix tiver caído, o pedido sai desta lista sozinho.",
    };
  }

  if (status === "novo" && idadeMinutos >= LIMIAR_NOVO_SEM_ACEITE_MIN) {
    return {
      ...base,
      motivo: "novo_sem_aceite",
      titulo: `Aguardando aceite há ${idade}`,
      descricao:
        "O pedido chegou e ninguém aceitou. Coloque em preparo se a cozinha vai fazer, ou cancele avisando o cliente.",
    };
  }

  if (status === "em_preparo" && idadeMinutos >= LIMIAR_PREPARO_MIN) {
    return {
      ...base,
      motivo: "preparo_longo",
      titulo: `Em preparo há ${idade}`,
      descricao:
        "Tempo de preparo muito acima do normal. Confirme se o pedido já saiu — se saiu, marque a saída para o cliente parar de esperar.",
    };
  }

  if (status === "saiu_entrega" && idadeMinutos >= LIMIAR_ENTREGA_MIN) {
    return {
      ...base,
      motivo: "entrega_longa",
      titulo: `Na rua há ${idade}`,
      descricao:
        "O pedido saiu para entrega e não foi finalizado. Confirme com o entregador e marque como entregue, ou cancele se não foi entregue.",
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

/** Pendências ordenadas por prioridade do motivo, desempatando pela mais antiga. */
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
  /** Status para o qual o pedido avança. Ausente quando a ação não muda o status. */
  status?: string;
};

const AVANCO_POR_STATUS: Record<string, { label: string; status: string }> = {
  novo: { label: "Colocar em preparo", status: "em_preparo" },
  em_preparo: { label: "Marcar como saiu para entrega", status: "saiu_entrega" },
  saiu_entrega: { label: "Marcar como entregue", status: "entregue" },
};

/**
 * Ação primária da pendência. Para Pix pendente ela NÃO é o avanço nem o
 * cancelamento: é conferir o provedor antes de decidir — cancelar um pedido
 * efetivamente pago é o erro caro deste fluxo.
 */
export function acaoPrincipal(pendencia: Pendencia): OpcaoResolucao {
  if (pendencia.motivo === "pagamento_pix_pendente") {
    return { label: "Verificar pagamento no Mercado Pago", acao: "verificou_pagamento" };
  }
  const avanco = AVANCO_POR_STATUS[pendencia.status];
  return avanco
    ? { label: avanco.label, acao: "avancou", status: avanco.status }
    : { label: "Cancelar pedido", acao: "cancelou", status: "cancelado" };
}

/** Sempre há uma segunda saída: nenhuma pendência pode ficar sem resolução. */
export function acaoSecundaria(pendencia: Pendencia): OpcaoResolucao {
  if (pendencia.motivo === "pagamento_pix_pendente") {
    return { label: "Cancelar pedido", acao: "cancelou", status: "cancelado" };
  }
  return { label: "Cancelar pedido", acao: "cancelou", status: "cancelado" };
}

const MOTIVOS: readonly MotivoPendencia[] = [
  "pagamento_pix_pendente",
  "novo_sem_aceite",
  "preparo_longo",
  "entrega_longa",
];
const ACOES: readonly AcaoLimpeza[] = ["avancou", "cancelou", "verificou_pagamento"];

/**
 * Predicado de fronteira: valida o que chega do painel antes de virar registro
 * gravado. Nunca lança e nunca faz cast — devolve `null` para qualquer forma
 * inesperada, e quem chama decide (aqui: ignora a limpeza e só muda o status).
 */
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

/** Monta o registro durável que fecha a pendência no próprio pedido. */
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
  /** Fração das resoluções que terminaram em cancelamento (0..1). */
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

/**
 * Métricas do período a partir do MESMO campo que fecha a pendência — não há
 * uma segunda fonte de verdade a manter em sincronia. A comparação de "hoje"
 * usa o fuso do estabelecimento, nunca o do navegador.
 */
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
    // Um registro gravado por uma versão futura, com um motivo que esta ainda
    // não conhece, é ignorado — nunca vira uma chave solta na métrica.
    const motivo = registro ? MOTIVOS.find((m) => m === registro.motivo) : undefined;
    if (!registro || !motivo) continue;

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
