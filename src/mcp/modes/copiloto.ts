// copiloto.ts — Fase 2A: agregador determinístico do Modo Copiloto.
// Lê mcp:log:obs, agrega padrões por step e gera sugestões candidatas.
// Escreve somente em mcp:sugestoes:candidatas e mcp:log:erros.
// Não chama Claude, OpenAI, Ollama ou qualquer API externa.
// Não altera sessão, pedido, resposta ao cliente ou qualquer estado do bot.

import { redis } from '@/lib/redis';
import { logErroMcp } from '../logger/mcpLogger';
import type {
  McpLogEntryObs,
  McpPeriodo,
  McpSugestaoCandidata,
  McpSugestaoEvidencia,
  PadraoObservado,
  SeveridadeSugestao,
  TipoSugestao,
} from '../types';

const CHAVE_OBS          = 'mcp:log:obs';
const CHAVE_CANDIDATAS   = 'mcp:sugestoes:candidatas';
const TTL_SUGESTOES_S    = 7 * 24 * 60 * 60;
const MAX_CANDIDATAS     = 100;

const CONFIANCA_MIN      = 0.75;
const TOTAL_EVENTOS_MIN  = 20;
const PROBLEMAS_MIN      = 3;

const PADROES_CONFUSAO: PadraoObservado[]  = ['confusao_simples', 'confusao_com_escalacao'];
const PADROES_ESCALACAO: PadraoObservado[] = ['escalacao_direta', 'confusao_com_escalacao'];
const PADROES_IA: PadraoObservado[]        = ['interpretacao_ok'];

// ── Tipos internos ──────────────────────────────────────────────────────────

export interface AgregadoStep {
  step: string;
  totalEventos: number;
  entradas: McpLogEntryObs[];
}

// ── Funções puras (exportadas para teste) ───────────────────────────────────

const PERIODO_MS: Record<McpPeriodo, number> = {
  '24h': 24 * 3600 * 1000,
  '7d':   7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};

export function filtrarPorPeriodo(
  entradas: McpLogEntryObs[],
  periodo: McpPeriodo,
  agora = Date.now(),
): McpLogEntryObs[] {
  const limite = PERIODO_MS[periodo];
  return entradas.filter(e => agora - e.ts <= limite);
}

export function agregarPorStep(entradas: McpLogEntryObs[]): Map<string, AgregadoStep> {
  const mapa = new Map<string, AgregadoStep>();
  for (const entrada of entradas) {
    const step = entrada.stepAntes;
    if (!mapa.has(step)) {
      mapa.set(step, { step, totalEventos: 0, entradas: [] });
    }
    const agg = mapa.get(step)!;
    agg.totalEventos++;
    agg.entradas.push(entrada);
  }
  return mapa;
}

function calcularSeveridade(taxaProblema: number): SeveridadeSugestao {
  if (taxaProblema > 0.5)  return 'alta';
  if (taxaProblema > 0.25) return 'media';
  return 'baixa';
}

function gerarParaTipo(
  agregado: AgregadoStep,
  tipo: TipoSugestao,
  padroesProblema: PadraoObservado[],
  periodo: McpPeriodo,
): McpSugestaoCandidata | null {
  const { step, totalEventos, entradas } = agregado;

  if (totalEventos < TOTAL_EVENTOS_MIN) return null;

  const entradasProblema = entradas.filter(e => padroesProblema.includes(e.padraoObservado));
  const problemas = entradasProblema.length;

  if (problemas < PROBLEMAS_MIN) return null;

  const confiancaMedia =
    entradasProblema.reduce((acc, e) => acc + e.confiancaEstrutura, 0) / problemas;

  if (confiancaMedia < CONFIANCA_MIN) return null;

  const taxaProblema = problemas / totalEventos;

  const contagem = new Map<PadraoObservado, number>();
  for (const e of entradasProblema) {
    contagem.set(e.padraoObservado, (contagem.get(e.padraoObservado) ?? 0) + 1);
  }
  const padroesDominantes = [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  const pct = Math.round(taxaProblema * 100);
  const resumos: Record<TipoSugestao, string> = {
    confusao_recorrente:      `Step "${step}": ${problemas}/${totalEventos} eventos com confusão (${pct}%). Revisar mensagens neste step.`,
    escalacao_frequente:      `Step "${step}": ${problemas}/${totalEventos} eventos resultaram em escalação (${pct}%). Alto índice de handoff.`,
    necessidade_ia_frequente: `Step "${step}": IA necessária em ${problemas}/${totalEventos} eventos (${pct}%). Considerar melhorar respostas determinísticas.`,
  };

  const evidencia: McpSugestaoEvidencia = {
    totalEventos,
    problemas,
    taxaProblema:  Math.round(taxaProblema  * 1000) / 1000,
    confiancaMedia: Math.round(confiancaMedia * 1000) / 1000,
    padroesDominantes,
  };

  return {
    id:         `${step}:${tipo}:${periodo}:${Date.now()}`,
    ts:         Date.now(),
    periodo,
    step,
    tipo,
    severidade: calcularSeveridade(taxaProblema),
    confianca:  Math.round(confiancaMedia * 1000) / 1000,
    evidencia,
    resumo:     resumos[tipo],
  };
}

const TIPOS_E_PADROES: [TipoSugestao, PadraoObservado[]][] = [
  ['confusao_recorrente',      PADROES_CONFUSAO],
  ['escalacao_frequente',      PADROES_ESCALACAO],
  ['necessidade_ia_frequente', PADROES_IA],
];

const ORDEM_SEVERIDADE: Record<SeveridadeSugestao, number> = { alta: 0, media: 1, baixa: 2 };

export function gerarSugestoesCandidatas(
  agregados: Map<string, AgregadoStep>,
  periodo: McpPeriodo,
): McpSugestaoCandidata[] {
  const sugestoes: McpSugestaoCandidata[] = [];

  for (const agregado of agregados.values()) {
    for (const [tipo, padroes] of TIPOS_E_PADROES) {
      const s = gerarParaTipo(agregado, tipo, padroes, periodo);
      if (s) sugestoes.push(s);
    }
  }

  return sugestoes.sort(
    (a, b) =>
      ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade] ||
      b.confianca - a.confianca,
  );
}

// ── Processador principal (usa Redis) ───────────────────────────────────────

export async function processarCopilotoDeterministico(): Promise<McpSugestaoCandidata[]> {
  const raw = await redis.lrange<string>(CHAVE_OBS, 0, -1);
  const entradas: McpLogEntryObs[] = raw
    .map(item => (typeof item === 'string' ? JSON.parse(item) : item) as McpLogEntryObs)
    .filter(e => e && typeof e.ts === 'number');

  const todasSugestoes: McpSugestaoCandidata[] = [];

  for (const periodo of ['24h', '7d', '30d'] as McpPeriodo[]) {
    const filtradas  = filtrarPorPeriodo(entradas, periodo);
    const agregados  = agregarPorStep(filtradas);
    const sugestoes  = gerarSugestoesCandidatas(agregados, periodo);
    todasSugestoes.push(...sugestoes);
  }

  // Substitui lista completa a cada execução do cron
  await redis.del(CHAVE_CANDIDATAS);
  for (const s of todasSugestoes) {
    await redis.rpush(CHAVE_CANDIDATAS, JSON.stringify(s));
  }
  if (todasSugestoes.length > 0) {
    await redis.ltrim(CHAVE_CANDIDATAS, -MAX_CANDIDATAS, -1);
    await redis.expire(CHAVE_CANDIDATAS, TTL_SUGESTOES_S);
  }

  return todasSugestoes;
}

export async function executarCopiloto(): Promise<void> {
  try {
    await processarCopilotoDeterministico();
  } catch (err) {
    await logErroMcp('processarCopilotoDeterministico', err);
  }
}
