// mcpReader.ts — leitura exclusivamente via roRedis (sem escrita).
// Usado pelo painel dev /dev/mcp para acompanhar Fase 1 do MCP Observador.
// Não importa nem chama nenhum módulo de bot, claude, ou fluxo de cliente.

import { roRedis } from './readOnlyRedis';
import { estaNoPeriodoDePico } from './janelaPico';
import { MAX_FILA } from '../eventTap';
import type { McpLogEntryObs, McpLogEntryErro, PadraoObservado } from '../types';

const CHAVE_FILA = 'mcp:fila:eventos';
const CHAVE_OBS = 'mcp:log:obs';
const CHAVE_ERROS = 'mcp:log:erros';
const CHAVE_CRON_META = 'mcp:meta:cron:ultima';
const CHAVE_DESCARTADOS = 'mcp:meta:fila:descartados';
const CHAVE_PICO = 'mcp:meta:fila:pico';
const CHAVE_HISTORICO = 'mcp:meta:cron:historico';
const CHAVE_FDS_HISTORICO = 'mcp:meta:fds:historico';
const CHAVE_TOTAL_PROCESSADOS = 'mcp:meta:processados:total';

// Limites seguros de leitura — nunca lrange sem limite
const MAX_OBS_LEITURA = 500;
const MAX_ERROS_LEITURA = 100;
const MAX_HISTORICO_LEITURA = 300;

// Thresholds de alerta/status — ver docs/architecture/MCP_OBSERVADOR_CAPACIDADE.md
const LIMIAR_ATENCAO_FILA = 500;
const LIMIAR_ATENCAO_IDADE_MIN = 20;
const LIMIAR_CRITICO_FILA = 2000;
const LIMIAR_CRITICO_IDADE_MIN = 60;
const LIMIAR_SATURADO_RATIO = 0.9;
const LIMIAR_AUSENCIA_EXECUCAO_MIN = 20;
const JANELA_24H_MS = 24 * 60 * 60 * 1000;

// Critérios de elegibilidade — ver item 6 do plano de capacidade.
const MIN_FDS_MOVIMENTADOS = 3;
const MIN_EVENTOS_PROCESSADOS_TOTAL = 500;
const MIN_COBERTURA = 0.95;
const MAX_TAXA_ERRO = 0.01;

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
  reason?: string;
}

export interface PiiCheck {
  ok: boolean;
  phoneHashOk: boolean;
  semDadosCrus: boolean;
  semValorMonetario: boolean;
}

export type StatusMcp = 'saudavel' | 'atrasado' | 'saturado' | 'indisponivel';

export interface AlertaMcp {
  nivel: 'atencao' | 'critico' | 'saturado' | 'ausencia_execucao';
  mensagem: string;
}

export interface CapacidadeMcp {
  filaAtual: number;
  maiorFilaRegistrada: number;
  idadeEventoMaisAntigoMin: number | null;
  processadosUltimaExecucao: number;
  processados24h: number;
  erros24h: number;
  eventosDescartados: number;
  coberturaEstimada: number | null;
  status: StatusMcp;
  alertas: AlertaMcp[];
}

export interface CriterioElegibilidade {
  chave: string;
  descricao: string;
  ok: boolean;
}

export interface ElegibilidadeSugestoes {
  criterios: CriterioElegibilidade[];
  elegivel: boolean;
  fimDeSemanaMovimentados: number;
  eventosProcessadosTotal: number;
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
  capacidade: CapacidadeMcp;
  elegibilidade: ElegibilidadeSugestoes;
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

type RegistroHistorico = { ts: number; processed: number; errors: number };

export function calcularStatusEAlertas(params: {
  filaAtual: number;
  idadeEventoMaisAntigoMin: number | null;
  ultimaExecucaoFinishedAt: number | null;
  agora: number;
  dentroPeriodoPico: boolean;
}): { status: StatusMcp; alertas: AlertaMcp[] } {
  const { filaAtual, idadeEventoMaisAntigoMin, ultimaExecucaoFinishedAt, agora, dentroPeriodoPico } = params;
  const alertas: AlertaMcp[] = [];

  const idade = idadeEventoMaisAntigoMin ?? 0;
  const saturado = filaAtual >= MAX_FILA * LIMIAR_SATURADO_RATIO;
  const critico = filaAtual > LIMIAR_CRITICO_FILA || idade > LIMIAR_CRITICO_IDADE_MIN;
  const atencao = !critico && (filaAtual > LIMIAR_ATENCAO_FILA || idade > LIMIAR_ATENCAO_IDADE_MIN);

  const minutosDesdeUltimaExecucao = ultimaExecucaoFinishedAt !== null
    ? (agora - ultimaExecucaoFinishedAt) / 60_000
    : null;
  const ausenciaExecucao = dentroPeriodoPico
    && (minutosDesdeUltimaExecucao === null || minutosDesdeUltimaExecucao > LIMIAR_AUSENCIA_EXECUCAO_MIN);

  if (saturado) {
    alertas.push({ nivel: 'saturado', mensagem: `Fila em ${filaAtual} eventos — próxima do limite de ${MAX_FILA}.` });
  }
  if (critico) {
    alertas.push({
      nivel: 'critico',
      mensagem: `Fila com ${filaAtual} eventos ou evento mais antigo esperando ${Math.round(idade)}min — acima do limite crítico.`,
    });
  } else if (atencao) {
    alertas.push({
      nivel: 'atencao',
      mensagem: `Fila com ${filaAtual} eventos ou evento mais antigo esperando ${Math.round(idade)}min — acima do limite de atenção.`,
    });
  }
  if (ausenciaExecucao) {
    alertas.push({
      nivel: 'ausencia_execucao',
      mensagem: 'Nenhuma execução do cron nos últimos 20min durante o período operacional de pico.',
    });
  }

  const status: StatusMcp = saturado ? 'saturado' : (critico || atencao || ausenciaExecucao) ? 'atrasado' : 'saudavel';
  return { status, alertas };
}

function estadoVazio(): DadosMcp {
  const scoreZero: ScoreMaturidade = { total: 0, volume: 0, qualidade: 0, diversidade: 0, saude: 0 };
  return {
    filaCount: 0,
    obsCount: 0,
    errosCount: 0,
    scoreMaturidade: scoreZero,
    padraoDistribuicao: {},
    gargalos: [],
    ultimosErros: [],
    ultimasObs: [],
    cronMeta: null,
    piiCheck: { ok: true, phoneHashOk: true, semDadosCrus: true, semValorMonetario: true },
    prontoParaFase2: false,
    capacidade: {
      filaAtual: 0,
      maiorFilaRegistrada: 0,
      idadeEventoMaisAntigoMin: null,
      processadosUltimaExecucao: 0,
      processados24h: 0,
      erros24h: 0,
      eventosDescartados: 0,
      coberturaEstimada: null,
      status: 'indisponivel',
      alertas: [],
    },
    elegibilidade: {
      criterios: [],
      elegivel: false,
      fimDeSemanaMovimentados: 0,
      eventosProcessadosTotal: 0,
    },
  };
}

export async function lerDadosMcp(): Promise<DadosMcp> {
  // Redis indisponível (env ausente, timeout, credenciais inválidas etc.) não
  // pode derrubar o painel — cai para estado vazio seguro.
  let rawObs: unknown[];
  let rawErros: unknown[];
  let filaAtual: number;
  let eventoMaisAntigoRaw: unknown[];
  let cronMeta: CronMeta | null;
  let maiorFilaRegistrada: number | null;
  let eventosDescartados: number | null;
  let rawHistorico: unknown[];
  let fdsHistorico: string[] | null;
  let eventosProcessadosTotal: number | null;

  try {
    [
      rawObs, rawErros, filaAtual, eventoMaisAntigoRaw, cronMeta,
      maiorFilaRegistrada, eventosDescartados, rawHistorico, fdsHistorico, eventosProcessadosTotal,
    ] = await Promise.all([
      roRedis.lrange<unknown>(CHAVE_OBS, -MAX_OBS_LEITURA, -1),
      roRedis.lrange<unknown>(CHAVE_ERROS, -MAX_ERROS_LEITURA, -1),
      roRedis.llen(CHAVE_FILA),
      roRedis.lrange<unknown>(CHAVE_FILA, 0, 0),
      roRedis.get<CronMeta>(CHAVE_CRON_META),
      roRedis.get<number>(CHAVE_PICO),
      roRedis.get<number>(CHAVE_DESCARTADOS),
      roRedis.lrange<unknown>(CHAVE_HISTORICO, 0, MAX_HISTORICO_LEITURA - 1),
      roRedis.get<string[]>(CHAVE_FDS_HISTORICO),
      roRedis.get<number>(CHAVE_TOTAL_PROCESSADOS),
    ]);
  } catch (err) {
    console.error('[mcpReader] Redis indisponível, retornando estado vazio:', err);
    return estadoVazio();
  }

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

  // --- Capacidade (evolução Fase 1 — noites movimentadas) ---
  const agora = Date.now();
  const eventoMaisAntigo = eventoMaisAntigoRaw
    .map(r => parseEntry<{ timestamp: number }>(r))
    .find((e): e is { timestamp: number } => e !== null && typeof e.timestamp === 'number');
  const idadeEventoMaisAntigoMin = eventoMaisAntigo ? (agora - eventoMaisAntigo.timestamp) / 60_000 : null;

  const historico = rawHistorico
    .map(r => parseEntry<RegistroHistorico>(r))
    .filter((e): e is RegistroHistorico => e !== null);
  const historico24h = historico.filter(h => agora - h.ts <= JANELA_24H_MS);
  const processados24h = historico24h.reduce((s, h) => s + (h.processed ?? 0), 0);
  const erros24h = historico24h.reduce((s, h) => s + (h.errors ?? 0), 0);

  const totalDescartadosOuProcessados = processados24h + (eventosDescartados ?? 0);
  const coberturaEstimada = totalDescartadosOuProcessados > 0
    ? processados24h / totalDescartadosOuProcessados
    : (processados24h === 0 && (eventosDescartados ?? 0) === 0 ? null : 1);

  const { status, alertas } = calcularStatusEAlertas({
    filaAtual,
    idadeEventoMaisAntigoMin,
    ultimaExecucaoFinishedAt: cronMeta?.finishedAt ?? null,
    agora,
    dentroPeriodoPico: estaNoPeriodoDePico(new Date(agora)),
  });

  const capacidade: CapacidadeMcp = {
    filaAtual,
    maiorFilaRegistrada: maiorFilaRegistrada ?? 0,
    idadeEventoMaisAntigoMin,
    processadosUltimaExecucao: cronMeta?.processed ?? 0,
    processados24h,
    erros24h,
    eventosDescartados: eventosDescartados ?? 0,
    coberturaEstimada,
    status,
    alertas,
  };

  // --- Elegibilidade para Modo de Sugestões (item 6) ---
  const fimDeSemanaMovimentados = Array.isArray(fdsHistorico) ? fdsHistorico.length : 0;
  const totalProcessado = eventosProcessadosTotal ?? 0;
  const taxaErro = processados24h + erros24h > 0 ? erros24h / (processados24h + erros24h) : 0;

  const criterios: CriterioElegibilidade[] = [
    {
      chave: 'fins_de_semana',
      descricao: `Pelo menos ${MIN_FDS_MOVIMENTADOS} fins de semana movimentados (${fimDeSemanaMovimentados} até agora)`,
      ok: fimDeSemanaMovimentados >= MIN_FDS_MOVIMENTADOS,
    },
    {
      chave: 'volume_total',
      descricao: `Pelo menos ${MIN_EVENTOS_PROCESSADOS_TOTAL} eventos reais processados (${totalProcessado} até agora)`,
      ok: totalProcessado >= MIN_EVENTOS_PROCESSADOS_TOTAL,
    },
    {
      chave: 'cobertura',
      descricao: `Cobertura estimada mínima de ${Math.round(MIN_COBERTURA * 100)}%`,
      ok: coberturaEstimada !== null && coberturaEstimada >= MIN_COBERTURA,
    },
    {
      chave: 'fila_normalizada',
      descricao: 'Fila voltando a zero ou nível normal depois dos picos',
      ok: filaAtual < LIMIAR_ATENCAO_FILA,
    },
    {
      chave: 'sem_pii',
      descricao: 'Nenhum vazamento de PII detectado nos logs',
      ok: piiCheck.ok,
    },
    {
      chave: 'sem_impacto_operacional',
      descricao: 'Nenhum impacto nos fluxos operacionais (garantido pela arquitetura fail-open — eventTap/cron nunca escrevem fora de mcp:* nem propagam erro ao webhook)',
      ok: true,
    },
    {
      chave: 'taxa_erro',
      descricao: `Erros abaixo de ${Math.round(MAX_TAXA_ERRO * 100)}%`,
      ok: taxaErro < MAX_TAXA_ERRO,
    },
  ];

  const elegibilidade: ElegibilidadeSugestoes = {
    criterios,
    elegivel: criterios.every(c => c.ok),
    fimDeSemanaMovimentados,
    eventosProcessadosTotal: totalProcessado,
  };

  return {
    filaCount: filaAtual,
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
    capacidade,
    elegibilidade,
  };
}
