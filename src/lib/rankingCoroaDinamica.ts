// Coroa dinâmica do Ranking do Chefe.
//
// Regra de produto:
// - a ameaça não usa um número fixo de Estrelas;
// - usa o ticket MÉDIO ELEGÍVEL da semana operacional anterior completa;
// - converte esse ticket pela MESMA regra oficial de Estrelas;
// - o resultado é apenas um limiar de competição do Ranking;
// - não credita Estrelas, não altera saldo de fidelidade e não muda prêmio.
//
// Semana operacional: segunda a domingo, usando a mesma chave de expediente
// da pizzaria (virada às 03:00 no fuso operacional). Isso evita misturar o
// movimento parcial da semana atual e mantém a referência estável durante a
// semana inteira.

import "server-only";

import { chaveExpedienteOperacional } from "./expedienteOperacional";
import {
  consultarEventosPorPeriodo,
  type EventoAnalitico,
} from "./historicoAnalitico";
import { calcularEstrelasPorValorElegivel } from "./estrelas";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export type JanelaSemanaAnteriorOperacional = {
  inicioExpedienteId: string;
  fimExpedienteId: string;
  consultaInicioMs: number;
  consultaFimMs: number;
};

export type ReferenciaCoroaDinamica = {
  inicioExpedienteId: string;
  fimExpedienteId: string;
  pedidosValidos: number;
  ticketMedioElegivelCents: number;
  maxGapEstrelas: number;
};

function chaveDataUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseChaveData(chave: string): number {
  const [ano, mes, dia] = chave.split("-").map(Number);
  if (![ano, mes, dia].every(Number.isFinite)) {
    throw new Error("Chave de expediente inválida");
  }
  return Date.UTC(ano, mes - 1, dia);
}

/**
 * Retorna a semana operacional ANTERIOR completa (segunda..domingo).
 *
 * A consulta ao índice usa uma margem até o fim da segunda-feira UTC seguinte,
 * e depois filtra pelos próprios expedienteIds. A margem evita acoplamento a
 * offset/DST: quem decide a semana de verdade é a chave operacional já gravada
 * no evento, não o relógio UTC.
 */
export function calcularJanelaSemanaAnteriorOperacional(
  agoraMs: number = Date.now(),
): JanelaSemanaAnteriorOperacional {
  const chaveHojeOperacional = chaveExpedienteOperacional(agoraMs);
  const hojeOperacionalUtc = parseChaveData(chaveHojeOperacional);
  const diaSemana = new Date(hojeOperacionalUtc).getUTCDay(); // 0=dom, 1=seg
  const diasDesdeSegunda = (diaSemana + 6) % 7;
  const segundaAtualUtc = hojeOperacionalUtc - diasDesdeSegunda * MS_POR_DIA;
  const segundaAnteriorUtc = segundaAtualUtc - 7 * MS_POR_DIA;
  const domingoAnteriorUtc = segundaAtualUtc - MS_POR_DIA;

  return {
    inicioExpedienteId: chaveDataUtc(segundaAnteriorUtc),
    fimExpedienteId: chaveDataUtc(domingoAnteriorUtc),
    consultaInicioMs: segundaAnteriorUtc,
    // A margem de 1 dia captura pedidos do domingo operacional que terminam
    // depois da meia-noite civil; o filtro por expedienteId remove a semana atual.
    consultaFimMs: segundaAtualUtc + MS_POR_DIA - 1,
  };
}

export function calcularReferenciaCoroaDosEventos(
  eventos: readonly EventoAnalitico[],
  janela: Pick<JanelaSemanaAnteriorOperacional, "inicioExpedienteId" | "fimExpedienteId">,
): ReferenciaCoroaDinamica | null {
  const validos = eventos.filter((evento) =>
    evento.statusAnalitico === "entregue"
    && Number.isFinite(evento.valorElegivelCents)
    && evento.valorElegivelCents > 0
    && evento.expedienteId >= janela.inicioExpedienteId
    && evento.expedienteId <= janela.fimExpedienteId
  );

  if (validos.length === 0) return null;

  const receitaElegivelCents = validos.reduce(
    (total, evento) => total + evento.valorElegivelCents,
    0,
  );
  const ticketMedioElegivelCents = Math.round(receitaElegivelCents / validos.length);
  const maxGapEstrelas = calcularEstrelasPorValorElegivel(ticketMedioElegivelCents);

  if (maxGapEstrelas <= 0) return null;

  return {
    inicioExpedienteId: janela.inicioExpedienteId,
    fimExpedienteId: janela.fimExpedienteId,
    pedidosValidos: validos.length,
    ticketMedioElegivelCents,
    maxGapEstrelas,
  };
}

export async function obterReferenciaCoroaDinamica(
  tenantId: string,
  agoraMs: number = Date.now(),
): Promise<ReferenciaCoroaDinamica | null> {
  const janela = calcularJanelaSemanaAnteriorOperacional(agoraMs);
  const eventos = await consultarEventosPorPeriodo(
    tenantId,
    janela.consultaInicioMs,
    janela.consultaFimMs,
  );
  return calcularReferenciaCoroaDosEventos(eventos, janela);
}
