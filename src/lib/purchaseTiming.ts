import type { EventoAnalitico } from "./historicoAnalitico";

export type FaseCompraMes = "inicio" | "meio" | "fim" | "distribuido" | "insuficiente";
export type ConfiancaRitmoCompra = "alta" | "media" | "baixa" | "insuficiente";

export type RitmoCompraCliente = {
  schemaVersion: 1;
  mode: "purchase_timing_read_only";
  janelaAnaliseDias: number;
  pedidosAnalisados: number;
  primeiraCompraEmMs: number | null;
  ultimaCompraEmMs: number | null;
  faseMes: FaseCompraMes;
  faseMesLabel: string;
  concentracaoPercentual: number;
  confianca: ConfiancaRitmoCompra;
  janelaProvavel: { inicioDia: number; fimDia: number } | null;
  diaCentralProvavel: number | null;
  diaSemanaMaisForte: { indice: number; label: string; percentual: number } | null;
  horarioMaisForte: { inicioHora: number; fimHora: number; percentual: number } | null;
  distribuicaoMes: {
    inicio: number;
    meio: number;
    fim: number;
  };
};

const TIME_ZONE = "America/Fortaleza";
const DIAS_SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;
const TIMESTAMP_MIN_VALIDO = Date.UTC(2020, 0, 1);
const TIMESTAMP_MAX_VALIDO = Date.UTC(2100, 0, 1);

function timestampCompra(evento: EventoAnalitico): number {
  if (/^\d{13}$/.test(evento.pedidoId)) {
    const candidato = Number(evento.pedidoId);
    if (candidato >= TIMESTAMP_MIN_VALIDO && candidato < TIMESTAMP_MAX_VALIDO) return candidato;
  }
  return evento.criadoEmMs;
}

type PartesLocais = { diaMes: number; diaSemana: number; hora: number };

function partesLocais(ms: number): PartesLocais | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const diaMes = Number(parts.find((p) => p.type === "day")?.value);
  const hora = Number(parts.find((p) => p.type === "hour")?.value);
  const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase();
  const mapaSemana: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const diaSemana = weekday ? mapaSemana[weekday.slice(0, 3)] : undefined;

  if (!Number.isInteger(diaMes) || diaMes < 1 || diaMes > 31) return null;
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) return null;
  if (diaSemana === undefined) return null;
  return { diaMes, diaSemana, hora };
}

function faseDoDia(dia: number): "inicio" | "meio" | "fim" {
  if (dia <= 10) return "inicio";
  if (dia <= 20) return "meio";
  return "fim";
}

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const sorted = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function percentual(parte: number, total: number): number {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

function confiancaPara(pedidos: number, concentracao: number): ConfiancaRitmoCompra {
  if (pedidos < 3) return "insuficiente";
  if (pedidos >= 6 && concentracao >= 67) return "alta";
  if (pedidos >= 4 && concentracao >= 60) return "media";
  return "baixa";
}

function labelFase(fase: FaseCompraMes): string {
  if (fase === "inicio") return "Comeco do mes";
  if (fase === "meio") return "Meio do mes";
  if (fase === "fim") return "Fim do mes";
  if (fase === "distribuido") return "Sem fase dominante";
  return "Dados insuficientes";
}

export function calcularRitmoCompraCliente(
  eventos: EventoAnalitico[],
  janelaAnaliseDias = 180,
): RitmoCompraCliente {
  const validos = eventos
    .filter((evento) => evento.statusAnalitico === "entregue" && Number.isFinite(evento.criadoEmMs))
    .map((evento) => ({ evento, compraEmMs: timestampCompra(evento) }))
    .sort((a, b) => a.compraEmMs - b.compraEmMs);

  const distribuicaoMes = { inicio: 0, meio: 0, fim: 0 };
  const partes = validos
    .map(({ evento, compraEmMs }) => ({ evento, compraEmMs, local: partesLocais(compraEmMs) }))
    .filter((item): item is { evento: EventoAnalitico; compraEmMs: number; local: PartesLocais } => item.local !== null);

  for (const item of partes) distribuicaoMes[faseDoDia(item.local.diaMes)] += 1;

  const pedidosAnalisados = partes.length;
  const base: RitmoCompraCliente = {
    schemaVersion: 1,
    mode: "purchase_timing_read_only",
    janelaAnaliseDias,
    pedidosAnalisados,
    primeiraCompraEmMs: validos[0]?.compraEmMs ?? null,
    ultimaCompraEmMs: validos[validos.length - 1]?.compraEmMs ?? null,
    faseMes: "insuficiente",
    faseMesLabel: "Dados insuficientes",
    concentracaoPercentual: 0,
    confianca: "insuficiente",
    janelaProvavel: null,
    diaCentralProvavel: null,
    diaSemanaMaisForte: null,
    horarioMaisForte: null,
    distribuicaoMes,
  };

  if (pedidosAnalisados < 3) return base;

  const fases = Object.entries(distribuicaoMes) as Array<["inicio" | "meio" | "fim", number]>;
  fases.sort((a, b) => b[1] - a[1]);
  const [faseDominante, totalDominante] = fases[0]!;
  const concentracao = percentual(totalDominante, pedidosAnalisados);
  const empate = fases[1]?.[1] === totalDominante;
  const faseMes: FaseCompraMes = empate || concentracao < 50 ? "distribuido" : faseDominante;
  const confianca = faseMes === "distribuido" ? "baixa" : confiancaPara(pedidosAnalisados, concentracao);

  const partesDominantes = faseMes === "inicio" || faseMes === "meio" || faseMes === "fim"
    ? partes.filter((item) => faseDoDia(item.local.diaMes) === faseMes)
    : partes;

  const centro = mediana(partesDominantes.map((item) => item.local.diaMes));
  const limites = faseMes === "inicio"
    ? { min: 1, max: 10 }
    : faseMes === "meio"
      ? { min: 11, max: 20 }
      : faseMes === "fim"
        ? { min: 21, max: 31 }
        : { min: 1, max: 31 };

  const janelaProvavel = centro === null ? null : {
    inicioDia: Math.max(limites.min, centro - 2),
    fimDia: Math.min(limites.max, centro + 2),
  };

  const porSemana = new Map<number, number>();
  for (const item of partesDominantes) {
    porSemana.set(item.local.diaSemana, (porSemana.get(item.local.diaSemana) ?? 0) + 1);
  }
  const semanaOrdenada = [...porSemana.entries()].sort((a, b) => b[1] - a[1]);
  const semanaTop = semanaOrdenada[0];
  const diaSemanaMaisForte = semanaTop
    ? { indice: semanaTop[0], label: DIAS_SEMANA[semanaTop[0]]!, percentual: percentual(semanaTop[1], partesDominantes.length) }
    : null;

  const porHorario = new Map<number, number>();
  for (const item of partesDominantes) {
    const inicioHora = Math.floor(item.local.hora / 3) * 3;
    porHorario.set(inicioHora, (porHorario.get(inicioHora) ?? 0) + 1);
  }
  const horarioOrdenado = [...porHorario.entries()].sort((a, b) => b[1] - a[1]);
  const horarioTop = horarioOrdenado[0];
  const horarioMaisForte = horarioTop
    ? {
        inicioHora: horarioTop[0],
        fimHora: Math.min(horarioTop[0] + 3, 24),
        percentual: percentual(horarioTop[1], partesDominantes.length),
      }
    : null;

  return {
    ...base,
    faseMes,
    faseMesLabel: labelFase(faseMes),
    concentracaoPercentual: concentracao,
    confianca,
    janelaProvavel,
    diaCentralProvavel: centro,
    diaSemanaMaisForte,
    horarioMaisForte,
  };
}
