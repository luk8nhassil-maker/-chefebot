import type { EventoAnalitico } from "./historicoAnalitico";
import { calcularRitmoCompraCliente, type ConfiancaRitmoCompra } from "./purchaseTiming";

export type AcaoRadarVendas = "meta_ticket" | "lembrar" | "reativar" | "aguardar";

export type OportunidadeRadarVendas = {
  clienteRef: string;
  score: number;
  confianca: ConfiancaRitmoCompra;
  faseMes: string;
  faseMesLabel: string;
  janelaProvavel: { inicioDia: number; fimDia: number } | null;
  diasAteJanela: number | null;
  emJanelaAgora: boolean;
  diaSemanaMaisForte: string | null;
  horarioMaisForte: { inicioHora: number; fimHora: number } | null;
  pedidosAnalisados: number;
  ticketMedioCents: number;
  metaTicketCents: number;
  incrementoTicketPotencialCents: number;
  ultimaCompraEmMs: number | null;
  diasDesdeUltimaCompra: number | null;
  intervaloMedianoDias: number | null;
  acao: AcaoRadarVendas;
  acaoLabel: string;
  acaoDescricao: string;
};

export type ResumoRadarVendas = {
  schemaVersion: 2;
  mode: "sales_radar_read_only";
  janelaAnaliseDias: number;
  clientesAnalisados: number;
  clientesComPadrao: number;
  altaConfianca: number;
  emJanelaAgora: number;
  oportunidadesAtivas: number;
  oportunidadesMetaTicket: number;
  ticketMedioBaseCents: number;
  potencialTicketAdicionalCents: number;
};

export type ResultadoRadarVendas = {
  resumo: ResumoRadarVendas;
  oportunidades: OportunidadeRadarVendas[];
};

const TIME_ZONE = "America/Fortaleza";
const DIA_MS = 86_400_000;
const TIMESTAMP_MIN_VALIDO = Date.UTC(2020, 0, 1);
const TIMESTAMP_MAX_VALIDO = Date.UTC(2100, 0, 1);

function timestampCompra(evento: EventoAnalitico): number {
  if (/^\d{13}$/.test(evento.pedidoId)) {
    const candidato = Number(evento.pedidoId);
    if (candidato >= TIMESTAMP_MIN_VALIDO && candidato < TIMESTAMP_MAX_VALIDO) return candidato;
  }
  return evento.criadoEmMs;
}

function partesDataLocal(ms: number): { ano: number; mes: number; dia: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (tipo: string) => Number(parts.find((p) => p.type === tipo)?.value);
  return { ano: get("year"), mes: get("month"), dia: get("day") };
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function diasAteJanela(agoraMs: number, janela: { inicioDia: number; fimDia: number } | null): number | null {
  if (!janela) return null;
  const atual = partesDataLocal(agoraMs);
  if (atual.dia >= janela.inicioDia && atual.dia <= janela.fimDia) return 0;
  if (atual.dia < janela.inicioDia) return janela.inicioDia - atual.dia;
  return diasNoMes(atual.ano, atual.mes) - atual.dia + janela.inicioDia;
}

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const sorted = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const valor = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(valor * 10) / 10;
}

function intervaloMedianoDias(eventos: EventoAnalitico[]): number | null {
  const tempos = eventos
    .filter((e) => e.statusAnalitico === "entregue")
    .map(timestampCompra)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < tempos.length; i++) {
    const gap = (tempos[i]! - tempos[i - 1]!) / DIA_MS;
    if (gap > 0) gaps.push(gap);
  }
  return mediana(gaps);
}

function referenciaMascarada(clienteId: string): string {
  const digitos = clienteId.replace(/\D/g, "");
  return digitos.length >= 4 ? `•••• ${digitos.slice(-4)}` : "Cliente";
}

function mediaInteira(valores: number[]): number {
  if (!valores.length) return 0;
  return Math.round(valores.reduce((s, v) => s + v, 0) / valores.length);
}

function arredondarMetaTicket(ticketMedioCents: number): number {
  if (ticketMedioCents <= 0) return 0;
  const alvo = Math.max(ticketMedioCents + 500, Math.round(ticketMedioCents * 1.1));
  return Math.ceil(alvo / 500) * 500;
}

function pesoConfianca(confianca: ConfiancaRitmoCompra): number {
  if (confianca === "alta") return 35;
  if (confianca === "media") return 25;
  if (confianca === "baixa") return 12;
  return 0;
}

function escolherAcao(params: {
  confianca: ConfiancaRitmoCompra;
  diasAte: number | null;
  diasDesdeUltima: number | null;
  intervaloMediano: number | null;
  metaTicketCents: number;
}): Pick<OportunidadeRadarVendas, "acao" | "acaoLabel" | "acaoDescricao"> {
  const emJanela = params.diasAte === 0;
  const atrasado = params.intervaloMediano !== null
    && params.diasDesdeUltima !== null
    && params.diasDesdeUltima >= Math.max(params.intervaloMediano * 1.35, params.intervaloMediano + 7);

  if (emJanela && (params.confianca === "alta" || params.confianca === "media")) {
    const meta = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(params.metaTicketCents / 100);
    return {
      acao: "meta_ticket",
      acaoLabel: "Meta de ticket",
      acaoDescricao: `Alta chance de compra. Evite desconto direto; use uma missão acima de ${meta} com benefício de baixo custo.`,
    };
  }
  if (atrasado) {
    return {
      acao: "reativar",
      acaoLabel: "Reativar",
      acaoDescricao: "Passou do ritmo normal de recompra. Considere um incentivo controlado; nenhum cupom é enviado automaticamente.",
    };
  }
  if (params.diasAte !== null && params.diasAte <= 3 && params.confianca !== "insuficiente") {
    return {
      acao: "lembrar",
      acaoLabel: "Aparecer antes",
      acaoDescricao: "A janela de compra está próxima. Priorize lembrança ou missão sem sacrificar margem.",
    };
  }
  return {
    acao: "aguardar",
    acaoLabel: "Aguardar",
    acaoDescricao: "Ainda não há sinal forte o bastante. Não desperdice cupom nem mensagem agora.",
  };
}

export function calcularRadarVendas(
  eventos: EventoAnalitico[],
  agoraMs = Date.now(),
  janelaAnaliseDias = 180,
): ResultadoRadarVendas {
  const validos = eventos.filter((evento) =>
    evento.statusAnalitico === "entregue"
    && Number.isFinite(evento.criadoEmMs)
    && evento.valorElegivelCents > 0
  );
  const porCliente = new Map<string, EventoAnalitico[]>();
  for (const evento of validos) {
    const lista = porCliente.get(evento.clienteId) ?? [];
    lista.push(evento);
    porCliente.set(evento.clienteId, lista);
  }

  const oportunidades: OportunidadeRadarVendas[] = [];
  for (const [clienteId, lista] of porCliente) {
    const timing = calcularRitmoCompraCliente(lista, janelaAnaliseDias);
    if (timing.pedidosAnalisados < 3) continue;

    const datas = lista.map(timestampCompra).sort((a, b) => a - b);
    const ultimaCompraEmMs = datas[datas.length - 1] ?? null;
    const diasDesdeUltimaCompra = ultimaCompraEmMs === null
      ? null
      : Math.max(0, Math.floor((agoraMs - ultimaCompraEmMs) / DIA_MS));
    const intervalo = intervaloMedianoDias(lista);
    const ticketMedioCents = mediaInteira(lista.map((e) => e.valorElegivelCents));
    const metaTicketCents = arredondarMetaTicket(ticketMedioCents);
    const ateJanela = diasAteJanela(agoraMs, timing.janelaProvavel);
    const emJanelaAgora = ateJanela === 0;

    let score = pesoConfianca(timing.confianca);
    if (ateJanela === 0) score += 35;
    else if (ateJanela !== null && ateJanela <= 2) score += 25;
    else if (ateJanela !== null && ateJanela <= 5) score += 15;
    score += Math.min(15, Math.max(0, timing.pedidosAnalisados - 2) * 3);
    if (intervalo !== null && diasDesdeUltimaCompra !== null && diasDesdeUltimaCompra >= intervalo) score += 10;
    score = Math.min(100, score);

    const acao = escolherAcao({
      confianca: timing.confianca,
      diasAte: ateJanela,
      diasDesdeUltima: diasDesdeUltimaCompra,
      intervaloMediano: intervalo,
      metaTicketCents,
    });

    oportunidades.push({
      clienteRef: referenciaMascarada(clienteId),
      score,
      confianca: timing.confianca,
      faseMes: timing.faseMes,
      faseMesLabel: timing.faseMesLabel,
      janelaProvavel: timing.janelaProvavel,
      diasAteJanela: ateJanela,
      emJanelaAgora,
      diaSemanaMaisForte: timing.diaSemanaMaisForte?.label ?? null,
      horarioMaisForte: timing.horarioMaisForte
        ? { inicioHora: timing.horarioMaisForte.inicioHora, fimHora: timing.horarioMaisForte.fimHora }
        : null,
      pedidosAnalisados: timing.pedidosAnalisados,
      ticketMedioCents,
      metaTicketCents,
      incrementoTicketPotencialCents: Math.max(0, metaTicketCents - ticketMedioCents),
      ultimaCompraEmMs,
      diasDesdeUltimaCompra,
      intervaloMedianoDias: intervalo,
      ...acao,
    });
  }

  oportunidades.sort((a, b) => b.score - a.score || b.pedidosAnalisados - a.pedidosAnalisados);
  const clientesComPadrao = oportunidades.filter((o) => o.faseMes !== "distribuido" && o.faseMes !== "insuficiente").length;
  const oportunidadesAtivas = oportunidades.filter((o) => o.acao !== "aguardar");
  const oportunidadesMetaTicket = oportunidadesAtivas.filter((o) => o.acao === "meta_ticket");
  const resumo: ResumoRadarVendas = {
    schemaVersion: 2,
    mode: "sales_radar_read_only",
    janelaAnaliseDias,
    clientesAnalisados: porCliente.size,
    clientesComPadrao,
    altaConfianca: oportunidades.filter((o) => o.confianca === "alta").length,
    emJanelaAgora: oportunidades.filter((o) => o.emJanelaAgora).length,
    oportunidadesAtivas: oportunidadesAtivas.length,
    oportunidadesMetaTicket: oportunidadesMetaTicket.length,
    ticketMedioBaseCents: mediaInteira(validos.map((e) => e.valorElegivelCents)),
    potencialTicketAdicionalCents: oportunidadesMetaTicket.reduce(
      (total, oportunidade) => total + oportunidade.incrementoTicketPotencialCents,
      0,
    ),
  };

  return { resumo, oportunidades };
}
