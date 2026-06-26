// observador.ts — processador do Modo Observador (Fase 1).
// Recebe um McpEventoFila já anonimizado, classifica o padrão estrutural
// de forma determinística (sem IA, sem API externa) e persiste a observação.
// Não altera sessão, pedido, resposta ou qualquer estado do bot.

import type { McpEventoFila, McpLogEntryObs, PadraoObservado } from '../types';
import { logObservacaoMcp, logErroMcp } from '../logger/mcpLogger';

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

export async function processarEventoObservador(evento: McpEventoFila): Promise<void> {
  try {
    const padraoObservado = classificarPadrao(evento);

    const entrada: McpLogEntryObs = {
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

    await logObservacaoMcp(entrada);
  } catch (err) {
    await logErroMcp('processarEventoObservador', err);
  }
}
