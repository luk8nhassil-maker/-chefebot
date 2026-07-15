import { redis } from "./redis";
import { PIX_GUARDIAO_IDADE_MAXIMA_MS } from "./pixAutoCheckConfig";
import type { PixConfirmadoPor } from "./pix";
import {
  calcularLatenciasConfirmacaoPix,
  contarConfirmacoesPorOrigemPix,
  obterContadoresPix,
  obterUltimoEventoPix,
  obterUltimaConfirmacaoAutomaticaPix,
  calcularProporcaoConsultaPorMensagemQstash,
  chaveBucketHoraPix,
  chaveBucketDiaPix,
  type LatenciasConfirmacaoPix,
  type ConfirmacoesPorOrigemPix,
  type ContadorPixMetrica,
  type EventoObservabilidadePix,
  type UltimoEventoPix,
} from "./pixMetricas";

// Agregação SOMENTE LEITURA para o painel técnico /dev/pix (Nível 6.10).
// Este arquivo nunca escreve nada relacionado a Pix, nunca chama o Mercado
// Pago, nunca confirma nada — só lê o array "pedidos" (já lido hoje por
// pixMetricas.ts) e os contadores/buckets já gravados por
// registrarEventoObservabilidadePix. Nenhuma decisão do Sentinela, do
// webhook, do conciliador ou da confirmação manual passa por aqui.

type PedidoDashboard = {
  id?: string;
  pix?: {
    provider?: string;
    status?: string;
    confirmadoPor?: PixConfirmadoPor;
    confirmadoEm?: string;
    criadoEm?: string;
  };
  pixConfirmado?: boolean;
  status?: string;
};

export type ResumoPixDashboard = {
  encontrados: number;
  confirmados: number;
  pendentes: number;
  expirados: number;
  taxaConfirmacao: number | null; // 0..1, null se encontrados === 0
};

// Só considera Pix Mercado Pago (Pix manual por chave nunca entra aqui —
// mesmo filtro usado pelo Sentinela e pelo conciliador).
function pedidosMercadoPago(pedidos: PedidoDashboard[]): PedidoDashboard[] {
  return pedidos.filter((p) => p.pix?.provider === "mercadopago");
}

export function calcularResumoPixDashboard(pedidos: PedidoDashboard[], agora: number = Date.now()): ResumoPixDashboard {
  const mp = pedidosMercadoPago(pedidos);
  let confirmados = 0;
  let expirados = 0;
  let cancelados = 0;
  let pendentes = 0;

  for (const p of mp) {
    const confirmado = p.pixConfirmado === true || p.pix?.status === "confirmado";
    if (confirmado) {
      confirmados++;
      continue;
    }
    if (p.status === "cancelado") {
      cancelados++;
      continue;
    }
    const criadoEm = p.pix?.criadoEm ? new Date(p.pix.criadoEm).getTime() : NaN;
    if (Number.isFinite(criadoEm) && agora - criadoEm >= PIX_GUARDIAO_IDADE_MAXIMA_MS) {
      expirados++;
    } else {
      pendentes++;
    }
  }

  const encontrados = mp.length;
  void cancelados; // não exibido no resumo hoje — mantido explícito para não ser contado como pendente.

  return {
    encontrados,
    confirmados,
    pendentes,
    expirados,
    taxaConfirmacao: encontrados > 0 ? Math.round((confirmados / encontrados) * 1000) / 1000 : null,
  };
}

export type FaixaLatenciaPix = "ate5s" | "de5a10s" | "de10a30s" | "de30sa2min" | "acimaDe2min";

export type HistogramaLatenciaPix = LatenciasConfirmacaoPix & {
  faixas: Record<FaixaLatenciaPix, number>;
};

// Reaproveita calcularLatenciasConfirmacaoPix (já existente, inalterada)
// para média/p50/p95/p99, e adiciona só a contagem por faixa em cima da
// mesma amostra — nenhuma lógica financeira, só leitura de
// pix.criadoEm/pix.confirmadoEm já persistidos.
export function calcularHistogramaLatenciaPix(pedidos: PedidoDashboard[]): HistogramaLatenciaPix {
  const base = calcularLatenciasConfirmacaoPix(pedidos);
  const faixas: Record<FaixaLatenciaPix, number> = {
    ate5s: 0,
    de5a10s: 0,
    de10a30s: 0,
    de30sa2min: 0,
    acimaDe2min: 0,
  };

  for (const p of pedidos) {
    if (p.pix?.provider !== "mercadopago") continue;
    if (p.pix?.status !== "confirmado") continue;
    if (!p.pix.criadoEm || !p.pix.confirmadoEm) continue;
    const criado = new Date(p.pix.criadoEm).getTime();
    const confirmado = new Date(p.pix.confirmadoEm).getTime();
    if (!Number.isFinite(criado) || !Number.isFinite(confirmado)) continue;
    const latenciaMs = confirmado - criado;
    if (latenciaMs < 0) continue;

    if (latenciaMs <= 5_000) faixas.ate5s++;
    else if (latenciaMs <= 10_000) faixas.de5a10s++;
    else if (latenciaMs <= 30_000) faixas.de10a30s++;
    else if (latenciaMs <= 120_000) faixas.de30sa2min++;
    else faixas.acimaDe2min++;
  }

  return { ...base, faixas };
}

export type OrigemPixDashboard = ConfirmacoesPorOrigemPix & {
  // Soma dos buckets diários dos últimos 30 dias (janela móvel, não
  // cumulativa desde sempre) de confirmações que o Sentinela detectou
  // nesta própria consulta — subconjunto do total "conciliador_mercadopago"
  // acima (o mesmo confirmadoPor é gravado nos dois casos; este número é
  // aditivo, não substitui o total). Os buckets só existem a partir desta
  // implantação — ver `metricasTemporaisDesde` no painel.
  identificadasPeloSentinelaUltimos30Dias: number;
};

export type EficienciaPixDashboard = {
  mensagensQstashPublicadas: number;
  consultasRealizadas: number;
  consultasEvitadas: number;
  mensagensAntigasIgnoradas: number;
  mensagensDuplicadasIgnoradas: number;
  consultasCoalescidas: number;
  // Os 4 campos abaixo são soma dos buckets diários dos últimos 30 dias
  // (janela móvel) — não são contadores cumulativos desde sempre. Os
  // buckets só existem a partir desta implantação.
  bloqueiosCooldownUltimos30Dias: number;
  bloqueiosRateLimitUltimos30Dias: number;
  bloqueiosProximaConsultaUltimos30Dias: number;
  bloqueiosLockUltimos30Dias: number;
  proporcaoConsultaPorMensagem: number | null;
};

export type SaudePixDashboard = {
  timeout: number;
  rateLimited: number;
  locksRecuperados: number;
  ultimoEvento: UltimoEventoPix;
  ultimaConfirmacaoAutomatica: UltimoEventoPix;
};

export type PontoSeriePix = { rotulo: string; valor: number };
export type SerieMetricaPix = {
  nome: EventoObservabilidadePix;
  horas: PontoSeriePix[];
  dias: PontoSeriePix[];
  temDados: boolean;
};

const METRICAS_COM_SERIE: EventoObservabilidadePix[] = [
  "sentinela_confirmou",
  "sentinela_bloqueio_cooldown",
  "sentinela_bloqueio_rate_limit",
  "sentinela_bloqueio_proxima_consulta",
  "sentinela_bloqueio_lock",
];

function ultimasHoras(agora: number, quantidade: number): number[] {
  return Array.from({ length: quantidade }, (_, i) => agora - (quantidade - 1 - i) * 3_600_000);
}
function ultimosDias(agora: number, quantidade: number): number[] {
  return Array.from({ length: quantidade }, (_, i) => agora - (quantidade - 1 - i) * 86_400_000);
}

function rotuloHora(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}h`;
}
function rotuloDia(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type RedisPipelineLike = {
  get: (key: string) => RedisPipelineLike;
  exec: () => Promise<unknown[]>;
};

// Leitura em lote (pipeline quando disponível — 1 viagem de rede; sequencial
// como fallback) das séries horária (24h) e diária (30d) das métricas
// aditivas do Sentinela. Somente leitura; nunca lança — em qualquer falha
// devolve séries vazias (o painel mostra "sem dados" em vez de quebrar).
export async function obterSeriesTemporaisPix(agora: number = Date.now()): Promise<SerieMetricaPix[]> {
  try {
    const horasTs = ultimasHoras(agora, 24);
    const diasTs = ultimosDias(agora, 30);

    const chavesHoraPorMetrica = METRICAS_COM_SERIE.map((nome) => horasTs.map((t) => chaveBucketHoraPix(nome, t)));
    const chavesDiaPorMetrica = METRICAS_COM_SERIE.map((nome) => diasTs.map((t) => chaveBucketDiaPix(nome, t)));
    const todasChaves = [...chavesHoraPorMetrica.flat(), ...chavesDiaPorMetrica.flat()];

    let valores: (number | null)[];
    const clienteComPipeline = redis as unknown as { pipeline?: () => RedisPipelineLike };
    if (typeof clienteComPipeline.pipeline === "function") {
      const p = clienteComPipeline.pipeline();
      for (const chave of todasChaves) p.get(chave);
      const resultado = await p.exec();
      valores = resultado.map((v) => (typeof v === "number" ? v : null));
    } else {
      valores = await Promise.all(todasChaves.map((chave) => redis.get<number>(chave).catch(() => null)));
    }

    const totalHora = horasTs.length * METRICAS_COM_SERIE.length;
    const valoresHora = valores.slice(0, totalHora);
    const valoresDia = valores.slice(totalHora);

    return METRICAS_COM_SERIE.map((nome, idxMetrica) => {
      const horas: PontoSeriePix[] = horasTs.map((ts, idxHora) => ({
        rotulo: rotuloHora(ts),
        valor: valoresHora[idxMetrica * horasTs.length + idxHora] || 0,
      }));
      const dias: PontoSeriePix[] = diasTs.map((ts, idxDia) => ({
        rotulo: rotuloDia(ts),
        valor: valoresDia[idxMetrica * diasTs.length + idxDia] || 0,
      }));
      const temDados = horas.some((h) => h.valor > 0) || dias.some((d) => d.valor > 0);
      return { nome, horas, dias, temDados };
    });
  } catch {
    return METRICAS_COM_SERIE.map((nome) => ({ nome, horas: [], dias: [], temDados: false }));
  }
}

function somarSerie(pontos: PontoSeriePix[]): number {
  return pontos.reduce((acc, p) => acc + p.valor, 0);
}

export type PainelPixDashboard = {
  geradoEm: string;
  metricasTemporaisDesde: string; // aviso: buckets não têm reconstrução histórica
  resumo: ResumoPixDashboard;
  origem: OrigemPixDashboard;
  latencia: HistogramaLatenciaPix;
  eficiencia: EficienciaPixDashboard;
  saude: SaudePixDashboard;
  series: SerieMetricaPix[];
};

// Orquestração somente-leitura — uma única leitura de "pedidos", uma única
// leitura dos contadores cumulativos, uma leitura em lote dos buckets.
export async function montarPainelPixDashboard(agora: number = Date.now()): Promise<PainelPixDashboard> {
  const [pedidosBrutos, contadores, ultimoEvento, ultimaConfirmacaoAutomatica, series] = await Promise.all([
    redis.get<PedidoDashboard[]>("pedidos").then((v) => v || []),
    obterContadoresPix(),
    obterUltimoEventoPix(),
    obterUltimaConfirmacaoAutomaticaPix(),
    obterSeriesTemporaisPix(agora),
  ]);

  const serieConfirmou = series.find((s) => s.nome === "sentinela_confirmou");
  const serieCooldown = series.find((s) => s.nome === "sentinela_bloqueio_cooldown");
  const serieRateLimit = series.find((s) => s.nome === "sentinela_bloqueio_rate_limit");
  const serieProximaConsulta = series.find((s) => s.nome === "sentinela_bloqueio_proxima_consulta");
  const serieLock = series.find((s) => s.nome === "sentinela_bloqueio_lock");

  const contador = (nome: ContadorPixMetrica): number => contadores[nome] || 0;

  return {
    geradoEm: new Date(agora).toISOString(),
    metricasTemporaisDesde:
      "As métricas temporais começaram a ser coletadas a partir da implantação desta versão. Dados anteriores não foram reconstruídos.",
    resumo: calcularResumoPixDashboard(pedidosBrutos, agora),
    origem: {
      ...contarConfirmacoesPorOrigemPix(pedidosBrutos),
      identificadasPeloSentinelaUltimos30Dias: somarSerie(serieConfirmou?.dias || []),
    },
    latencia: calcularHistogramaLatenciaPix(pedidosBrutos),
    eficiencia: {
      mensagensQstashPublicadas: contador("qstash_mensagens_publicadas"),
      consultasRealizadas: contador("sentinela_consulta_realizada"),
      consultasEvitadas: contador("sentinela_consulta_evitada"),
      mensagensAntigasIgnoradas: contador("sentinela_mensagem_antiga_ignorada"),
      mensagensDuplicadasIgnoradas: contador("sentinela_mensagem_duplicada_ignorada"),
      consultasCoalescidas: contador("sentinela_consulta_coalescida"),
      bloqueiosCooldownUltimos30Dias: somarSerie(serieCooldown?.dias || []),
      bloqueiosRateLimitUltimos30Dias: somarSerie(serieRateLimit?.dias || []),
      bloqueiosProximaConsultaUltimos30Dias: somarSerie(serieProximaConsulta?.dias || []),
      bloqueiosLockUltimos30Dias: somarSerie(serieLock?.dias || []),
      proporcaoConsultaPorMensagem: calcularProporcaoConsultaPorMensagemQstash(contadores),
    },
    saude: {
      timeout: contador("timeout"),
      rateLimited: contador("rate_limited"),
      locksRecuperados: contador("locks_recuperados"),
      ultimoEvento,
      ultimaConfirmacaoAutomatica,
    },
    // "mostrar apenas métricas que realmente possuem buckets novos" — a
    // série completa (com zeros preenchidos) só é incluída quando pelo
    // menos um bucket tem valor > 0; caso contrário a métrica simplesmente
    // não aparece na resposta, e o painel mostra "sem dados ainda".
    series: series.filter((s) => s.temDados),
  };
}
