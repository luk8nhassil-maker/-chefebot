// observador.ts — processador do Modo Observador (Fase 1).
// Recebe um McpEventoFila já anonimizado, classifica o padrão estrutural
// de forma determinística (sem IA, sem API externa) e persiste a observação.
// Não altera sessão, pedido, resposta ou qualquer estado do bot.

import type { McpEventoFila, McpLogEntryObs, PadraoObservado } from '../types';
import { logObservacaoMcp, logObservacoesEmLoteMcp, logErroMcp } from '../logger/mcpLogger';

const CONFIANCA: Record<PadraoObservado, number> = {
  confusao_com_escalacao: 1.0,
  escalacao_direta:        0.9,
  avanco_normal:           0.9,
  confusao_simples:        0.85,
  interpretacao_ok:        0.8,
  sem_mudanca:             0.7,
  desconhecido:            0.0,
};

export function classificarPadrao(evento: McpEventoFila): PadraoObservado {
  const { houveMudancaStep, precisouIA, escalou, foiFallbackSeco } = evento;

  if (escalou && foiFallbackSeco)                               return 'confusao_com_escalacao';
  if (escalou && !foiFallbackSeco)                              return 'escalacao_direta';
  if (foiFallbackSeco && !escalou)                              return 'confusao_simples';
  if (houveMudancaStep && precisouIA)                           return 'interpretacao_ok';
  if (houveMudancaStep && !foiFallbackSeco)                     return 'avanco_normal';
  // IA foi chamada mas nenhum progresso visível e nenhum sinal de erro — estado ambíguo.
  if (!houveMudancaStep && precisouIA && !foiFallbackSeco && !escalou) return 'desconhecido';
  if (!houveMudancaStep && !foiFallbackSeco && !escalou)        return 'sem_mudanca';
  return 'desconhecido';
}

function construirEntrada(evento: McpEventoFila): McpLogEntryObs {
  const padraoObservado = classificarPadrao(evento);
  return {
    ts: evento.timestamp,
    phoneHash: evento.phoneHash,
    stepAntes: evento.stepAntes,
    stepDepois: evento.stepDepois,
    houveMudancaStep: evento.houveMudancaStep,
    cartLength: evento.cartLength,
    deliveryType: evento.deliveryType,
    precisouIA: evento.precisouIA,
    escalou: evento.escalou,
    foiFallbackSeco: evento.foiFallbackSeco,
    padraoObservado,
    confiancaEstrutura: CONFIANCA[padraoObservado],
  };
}

export async function processarEventoObservador(evento: McpEventoFila): Promise<void> {
  try {
    await logObservacaoMcp(construirEntrada(evento));
  } catch (err) {
    await logErroMcp('processarEventoObservador', err);
  }
}

// Classificação pura, sem I/O — usada pelo processamento em lote do cron
// para separar "decidir o padrão de cada evento" (memória, barato, nunca
// falha) de "persistir o lote" (1 round-trip Redis para o lote inteiro).
export function classificarLote(eventos: McpEventoFila[]): McpLogEntryObs[] {
  return eventos.map(construirEntrada);
}

export type ResultadoLoteObservador =
  | { sucesso: true; quantidade: number }
  | { sucesso: false; quantidade: 0 };

// Processa um lote inteiro com um único round-trip de persistência. Se a
// persistência falhar, NADA do lote é considerado processado — o chamador
// (cron) não deve remover esses eventos da fila, para tentar de novo depois.
export async function processarLoteObservador(eventos: McpEventoFila[]): Promise<ResultadoLoteObservador> {
  if (eventos.length === 0) return { sucesso: true, quantidade: 0 };
  try {
    const entradas = classificarLote(eventos);
    await logObservacoesEmLoteMcp(entradas);
    return { sucesso: true, quantidade: eventos.length };
  } catch (err) {
    await logErroMcp('processarLoteObservador', err);
    return { sucesso: false, quantidade: 0 };
  }
}
