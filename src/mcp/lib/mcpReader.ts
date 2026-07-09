// mcpReader.ts — leitura exclusivamente via roRedis (sem escrita).
// Usado pelo painel dev /dev/mcp para acompanhar Fase 1 do MCP Observador.
// Não importa nem chama nenhum módulo de bot, claude, ou fluxo de cliente.

import { roRedis } from './readOnlyRedis';
import type { McpLogEntryObs, McpLogEntryErro, PadraoObservado } from '../types';

const CHAVE_FILA = 'mcp:fila:eventos';
const CHAVE_OBS = 'mcp:log:obs';
const CHAVE_ERROS = 'mcp:log:erros';
const CHAVE_CRON_META = 'mcp:meta:cron:ultima';

// Limites seguros de leitura — nunca lrange sem limite
const MAX_OBS_LEITURA = 500;
const MAX_ERROS_LEITURA = 100;
const MAX_FILA_LEITURA = 999; // fila é limitada a 1000 pelo eventTap

export interface ScoreMaturidade {
  total: number;      // 0–100
  volume: number;     // 0–30
  qualidade: number;  // 0–30
  diversidade: number;// 0–20
  saude: number;      // 0–20
}

export interface GargaloStep {
  step: string;
  totalEventos: number;
  problemasCount: number;
  taxaProblema: number;
}

export interface CronMeta {
  startedAt: number;
  finishedAt: number;
  processed: number;
  errors: number;
  mode: string;
  durationMs: number;
}

export interface PiiCheck {
  ok: boolean;
  phoneHashOk: boolean;
  semDadosCrus: boolean;
  semValorMonetario: boolean;
}

export interface DadosMcp {
  filaCount: number;
  obsCount: number;
  errosCount: number;
  scoreMaturidade: ScoreMaturidade;
  padraoDistribuicao: Partial<Record<PadraoObservado, number>>;
  gargalos: GargaloStep[];
  ultimosErros: McpLogEntryErro[];
  ultimasObs: McpLogEntryObs[];
  cronMeta: CronMeta | null;
  piiCheck: PiiCheck;
  prontoParaFase2: boolean;
}

function parseEntry<T>(raw: unknown): T | null {
  try {
    if (typeof raw === 'string') return JSON.parse(raw) as T;
    if (typeof raw === 'object' && raw !== null) return raw as T;
    return null;
  } catch {
    return null;
  }
}

export function calcularScore(
  obs: McpLogEntryObs[],
  erros: McpLogEntryErro[],
): ScoreMaturidade {
  const n = obs.length;

  // Volume: 30pts ao atingir >= 200 observações
  const volume = Math.min(n / 200, 1.0) * 30;

  // Qualidade: média de confiancaEstrutura × 30
  const qualidade = n > 0
    ? (obs.reduce((s, e) => s + (e.confiancaEstrutura ?? 0), 0) / n) * 30
    : 0;

  // Diversidade: padrões distintos observados / 7
  const uniquePadroes = new Set(obs.map(e => e.padraoObservado)).size;
  const diversidade = (uniquePadroes / 7) * 20;

  // Saúde: taxa de erro como penalidade; sem dados de ambos os lados → 0
  const taxaErro = n > 0 ? Math.min(erros.length / n, 1.0) : 0;
  const saude = n === 0 && erros.length === 0
    ? 0
    : Math.max(0, 1 - taxaErro) * 20;

  return {
    total: Math.min(100, Math.round(volume + qualidade + diversidade + saude)),
    volume: Math.round(volume),
    qualidade: Math.round(qualidade),
    diversidade: Math.round(diversidade),
    saude: Math.round(saude),
  };
}

export function agruparGargalos(obs: McpLogEntryObs[]): GargaloStep[] {
  const mapa = new Map<string, { total: number; problemas: number }>();

  for (const e of obs) {
    const step = e.stepAntes || 'desconhecido';
    const atual = mapa.get(step) ?? { total: 0, problemas: 0 };
    atual.total++;
    if (e.escalou || e.foiFallbackSeco) atual.problemas++;
    mapa.set(step, atual);
  }

  return Array.from(mapa.entries())
    .map(([step, { total, problemas }]) => ({
      step,
      totalEventos: total,
      problemasCount: problemas,
      taxaProblema: total > 0 ? problemas / total : 0,
    }))
    .filter(g => g.totalEventos >= 3)
    .sort((a, b) => b.taxaProblema - a.taxaProblema)
    .slice(0, 10);
}

export function verificarPii(
  obs: McpLogEntryObs[],
  erros: McpLogEntryErro[],
): PiiCheck {
  // phoneHash deve começar com *** (sem dígito cru)
  const phoneHashOk = obs.every(
    e => !e.phoneHash || e.phoneHash.startsWith('***'),
  );

  // stepAntes/stepDepois nunca devem ter strings longas de dígitos
  const stepComDigito = obs.some(
    e => /\d{8,}/.test(e.stepAntes ?? '') || /\d{8,}/.test(e.stepDepois ?? ''),
  );

  // Erros já passaram por sanitizarMensagemErro, mas verificamos como trava
  const erroComTelefone = erros.some(e => /\d{10,}/.test(e.mensagem ?? ''));

  const semDadosCrus = !stepComDigito && !erroComTelefone;

  const erroComValor = erros.some(e => /r\$\s*\d/i.test(e.mensagem ?? ''));
  const semValorMonetario = !erroComValor;

  return {
    ok: phoneHashOk && semDadosCrus && semValorMonetario,
    phoneHashOk,
    semDadosCrus,
    semValorMonetario,
  };
}

export async function lerDadosMcp(): Promise<DadosMcp> {
  const [rawObs, rawErros, rawFila, cronMeta] = await Promise.all([
    roRedis.lrange<unknown>(CHAVE_OBS, -MAX_OBS_LEITURA, -1),
    roRedis.lrange<unknown>(CHAVE_ERROS, -MAX_ERROS_LEITURA, -1),
    roRedis.lrange<unknown>(CHAVE_FILA, 0, MAX_FILA_LEITURA),
    roRedis.get<CronMeta>(CHAVE_CRON_META),
  ]);

  const obs = rawObs
    .map(r => parseEntry<McpLogEntryObs>(r))
    .filter((e): e is McpLogEntryObs => e !== null);

  const erros = rawErros
    .map(r => parseEntry<McpLogEntryErro>(r))
    .filter((e): e is McpLogEntryErro => e !== null);

  const padraoDistribuicao = obs.reduce(
    (acc, e) => {
      acc[e.padraoObservado] = (acc[e.padraoObservado] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<PadraoObservado, number>>,
  );

  const score = calcularScore(obs, erros);
  const piiCheck = verificarPii(obs, erros);

  // Pronto para Fase 2 = score alto + volume mínimo + saúde mínima + sem PII
  const prontoParaFase2 =
    piiCheck.ok &&
    score.total >= 70 &&
    score.volume >= 22 &&  // ~145 obs
    score.saude >= 18;     // taxa de erro < 10%

  return {
    filaCount: rawFila.length,
    obsCount: obs.length,
    errosCount: erros.length,
    scoreMaturidade: score,
    padraoDistribuicao,
    gargalos: agruparGargalos(obs),
    ultimosErros: erros.slice(-20).reverse(),
    ultimasObs: obs.slice(-50).reverse(),
    cronMeta,
    piiCheck,
    prontoParaFase2,
  };
}
