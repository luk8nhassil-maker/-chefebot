import { redis } from "./redis";
import type { PixConfirmadoPor } from "./pix";

// Observabilidade e métricas do Guardião Pix. Nunca cria uma nova fonte de
// verdade financeira: as funções "snapshot" só leem o array de pedidos já
// existente (mesma leitura que o conciliador já faz) e agregam o que já está
// gravado (pix.confirmadoPor, pix.criadoEm, pix.confirmadoEm). Os contadores
// cumulativos (timeout, rate limit, locks recuperados, duplicidades
// impedidas) vivem em chaves Redis simples, incrementadas pelo conciliador e
// pelo Guardião — nunca pelo webhook nem pela confirmação manual (não
// alterados por esta mudança).

type PedidoParaMetricas = {
  id?: string;
  pix?: {
    provider?: string;
    status?: string;
    confirmadoPor?: PixConfirmadoPor;
    confirmadoEm?: string;
    criadoEm?: string;
  };
  pixConfirmado?: boolean;
};

export type LatenciasConfirmacaoPix = {
  amostras: number;
  mediaMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
};

function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 1) return ordenados[0];
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)];
}

// Só considera Pix Mercado Pago confirmados com os dois carimbos de tempo
// (criadoEm é aditivo — pedidos antigos sem ele não entram na amostra, nunca
// geram latência negativa ou inventada).
export function calcularLatenciasConfirmacaoPix(pedidos: PedidoParaMetricas[]): LatenciasConfirmacaoPix {
  const latencias: number[] = [];
  for (const p of pedidos) {
    if (p.pix?.provider !== "mercadopago") continue;
    if (p.pix?.status !== "confirmado") continue;
    if (!p.pix.criadoEm || !p.pix.confirmadoEm) continue;
    const criado = new Date(p.pix.criadoEm).getTime();
    const confirmado = new Date(p.pix.confirmadoEm).getTime();
    if (!Number.isFinite(criado) || !Number.isFinite(confirmado)) continue;
    const latencia = confirmado - criado;
    if (latencia < 0) continue;
    latencias.push(latencia);
  }

  if (latencias.length === 0) {
    return { amostras: 0, mediaMs: null, p50Ms: null, p95Ms: null, p99Ms: null };
  }

  const ordenados = [...latencias].sort((a, b) => a - b);
  const soma = ordenados.reduce((acc, v) => acc + v, 0);

  return {
    amostras: ordenados.length,
    mediaMs: Math.round(soma / ordenados.length),
    p50Ms: percentil(ordenados, 50),
    p95Ms: percentil(ordenados, 95),
    p99Ms: percentil(ordenados, 99),
  };
}

export type ConfirmacoesPorOrigemPix = Record<string, number>;

export function contarConfirmacoesPorOrigemPix(pedidos: PedidoParaMetricas[]): ConfirmacoesPorOrigemPix {
  const contagem: ConfirmacoesPorOrigemPix = {};
  for (const p of pedidos) {
    if (p.pix?.provider !== "mercadopago") continue;
    if (p.pix?.status !== "confirmado") continue;
    const origem = p.pix.confirmadoPor || "desconhecida";
    contagem[origem] = (contagem[origem] || 0) + 1;
  }
  return contagem;
}

export type PendentesPorJanelaPix = {
  acimaDe1Min: number;
  acimaDe2Min: number;
  acimaDe5Min: number;
};

export function contarPendentesPorJanelaPix(pedidos: PedidoParaMetricas[], agora: number = Date.now()): PendentesPorJanelaPix {
  let acimaDe1Min = 0;
  let acimaDe2Min = 0;
  let acimaDe5Min = 0;

  for (const p of pedidos) {
    if (p.pix?.provider !== "mercadopago") continue;
    if (p.pix?.status === "confirmado" || p.pixConfirmado === true) continue;
    if (!p.pix?.criadoEm) continue;
    const criado = new Date(p.pix.criadoEm).getTime();
    if (!Number.isFinite(criado)) continue;
    const idadeMs = agora - criado;
    if (idadeMs >= 60_000) acimaDe1Min++;
    if (idadeMs >= 120_000) acimaDe2Min++;
    if (idadeMs >= 300_000) acimaDe5Min++;
  }

  return { acimaDe1Min, acimaDe2Min, acimaDe5Min };
}

// Contadores cumulativos — best-effort, nunca sensíveis, nunca bloqueiam o
// fluxo principal (qualquer falha de Redis aqui é engolida). Usa get+set em
// vez de INCR para não depender de um comando extra no mock/cliente Redis já
// usado pelo restante do projeto.
export type ContadorPixMetrica =
  | "timeout"
  | "rate_limited"
  | "locks_recuperados"
  | "duplicidade_evitada"
  | "guardiao_recuperado"
  | "guardiao_failed"
  | "guardiao_cadeia_tick"
  | "guardiao_cadeia_finalizada"
  // Sentinela Pix (Nível 6.9) — coordenação de consultas, nunca decide
  // confirmação. Ver src/lib/pixSentinela.ts.
  | "sentinela_consulta_realizada"
  | "sentinela_consulta_evitada"
  | "sentinela_consulta_coalescida"
  | "sentinela_cadeia_encerrada"
  | "sentinela_mensagem_antiga_ignorada"
  | "sentinela_mensagem_duplicada_ignorada"
  | "sentinela_encerrado_webhook"
  | "sentinela_encerrado_manual"
  | "sentinela_painel_reaproveitado"
  | "qstash_mensagens_publicadas";

const PREFIXO_CONTADOR = "pix:metricas:contador:";

export async function incrementarContadorPix(nome: ContadorPixMetrica, quantidade: number = 1): Promise<void> {
  try {
    const chave = `${PREFIXO_CONTADOR}${nome}`;
    const atual = (await redis.get<number>(chave)) || 0;
    await redis.set(chave, atual + quantidade);
  } catch {
    // Observabilidade nunca pode derrubar o fluxo de confirmação.
  }
}

export async function obterContadoresPix(): Promise<Record<ContadorPixMetrica, number>> {
  const nomes: ContadorPixMetrica[] = [
    "timeout",
    "rate_limited",
    "locks_recuperados",
    "duplicidade_evitada",
    "guardiao_recuperado",
    "guardiao_failed",
    "guardiao_cadeia_tick",
    "guardiao_cadeia_finalizada",
    "sentinela_consulta_realizada",
    "sentinela_consulta_evitada",
    "sentinela_consulta_coalescida",
    "sentinela_cadeia_encerrada",
    "sentinela_mensagem_antiga_ignorada",
    "sentinela_mensagem_duplicada_ignorada",
    "sentinela_encerrado_webhook",
    "sentinela_encerrado_manual",
    "sentinela_painel_reaproveitado",
    "qstash_mensagens_publicadas",
  ];
  const valores = await Promise.all(
    nomes.map(async (nome) => {
      try {
        return (await redis.get<number>(`${PREFIXO_CONTADOR}${nome}`)) || 0;
      } catch {
        return 0;
      }
    })
  );
  const resultado = {} as Record<ContadorPixMetrica, number>;
  nomes.forEach((nome, i) => { resultado[nome] = valores[i]; });
  return resultado;
}

// Mascaramento de identificadores para log (Nível Guardião Pix) — nunca loga
// o paymentId completo, access token, senha, hash, código Pix completo ou
// dados bancários. Mantém só um sufixo curto para correlação manual.
export function mascararIdentificador(valor: string | undefined | null): string {
  if (!valor) return "—";
  const limpo = String(valor).trim();
  if (limpo.length <= 4) return "***";
  return `***${limpo.slice(-4)}`;
}

// --- Observabilidade adicional do Sentinela Pix (Nível 6.10) -------------
// Estritamente ADITIVA: nunca substitui, nunca altera o comportamento de
// incrementarContadorPix acima — os contadores cumulativos existentes
// continuam exatamente como estavam, gravados exatamente como antes. Esta
// seção só adiciona uma segunda trilha de observabilidade (buckets por
// hora/dia + "último evento") para alimentar o painel /dev/pix. Nunca é
// aguardada de forma bloqueante-crítica pelo caminho financeiro: qualquer
// falha aqui (Redis indisponível, TypeError etc.) é engolida internamente e
// jamais propaga, jamais muda o retorno de quem chamou, jamais impede
// confirmação, reagendamento, lock ou cooldown.

export type EventoObservabilidadePix =
  | "sentinela_confirmou"
  | "sentinela_bloqueio_cooldown"
  | "sentinela_bloqueio_rate_limit"
  | "sentinela_bloqueio_proxima_consulta"
  | "sentinela_bloqueio_lock";

const PREFIXO_BUCKET_OBSERVABILIDADE = "pix:metricas:bucket:";
const BUCKET_HORA_TTL_SEGUNDOS = 72 * 60 * 60; // 3 dias
const BUCKET_DIA_TTL_SEGUNDOS = 35 * 24 * 60 * 60; // 35 dias
const CHAVE_ULTIMO_EVENTO_PIX = "pix:metricas:ultimoEvento";
const CHAVE_ULTIMA_CONFIRMACAO_AUTOMATICA_PIX = "pix:metricas:ultimaConfirmacaoAutomatica";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Chaves em UTC — determinístico, sem depender de fuso do servidor.
function sufixoHora(agora: number): string {
  const d = new Date(agora);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}`;
}
function sufixoDia(agora: number): string {
  const d = new Date(agora);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

export function chaveBucketHoraPix(nome: EventoObservabilidadePix, agora: number): string {
  return `${PREFIXO_BUCKET_OBSERVABILIDADE}${nome}:h:${sufixoHora(agora)}`;
}
export function chaveBucketDiaPix(nome: EventoObservabilidadePix, agora: number): string {
  return `${PREFIXO_BUCKET_OBSERVABILIDADE}${nome}:d:${sufixoDia(agora)}`;
}

type RedisPipelineLike = {
  incr: (key: string) => RedisPipelineLike;
  expire: (key: string, seconds: number) => RedisPipelineLike;
  set: (key: string, value: unknown) => RedisPipelineLike;
  exec: () => Promise<unknown[]>;
};

// Teto rígido de latência para a observabilidade adicional. Um `.catch()`
// sozinho protege contra REJEIÇÃO, mas não contra uma promise que nunca
// resolve (pipeline.exec()/get()/set() pendurados) — como as duas chamadas
// em pixSentinela.ts acontecem ANTES do retorno do Sentinela (bloqueio e
// confirmação), uma gravação lenta atrasaria a resposta ao QStash. Esta
// constante é o limite de quanto tempo registrarEventoObservabilidadePix
// pode, no máximo, atrasar quem a chamou.
const TIMEOUT_TELEMETRIA_MS = 100;

// Corpo real da gravação — extraído para que a Promise que ele retorna possa
// ser mantida viva (nunca "void simples") e corrida contra o timeout abaixo.
async function executarGravacaoObservabilidadePix(
  tipo: EventoObservabilidadePix,
  opts?: { ultimaConfirmacaoAutomatica?: boolean; agora?: number }
): Promise<void> {
  const agora = opts?.agora ?? Date.now();
  const chaveHora = chaveBucketHoraPix(tipo, agora);
  const chaveDia = chaveBucketDiaPix(tipo, agora);
  const registro = { tipo, ts: agora };

  const clienteComPipeline = redis as unknown as { pipeline?: () => RedisPipelineLike };
  if (typeof clienteComPipeline.pipeline === "function") {
    const p = clienteComPipeline.pipeline();
    p.incr(chaveHora);
    p.expire(chaveHora, BUCKET_HORA_TTL_SEGUNDOS);
    p.incr(chaveDia);
    p.expire(chaveDia, BUCKET_DIA_TTL_SEGUNDOS);
    p.set(CHAVE_ULTIMO_EVENTO_PIX, registro);
    if (opts?.ultimaConfirmacaoAutomatica) {
      p.set(CHAVE_ULTIMA_CONFIRMACAO_AUTOMATICA_PIX, registro);
    }
    await p.exec();
    return;
  }

  // Fallback sem pipeline — mesmo padrão get+set de incrementarContadorPix.
  const [horaAtual, diaAtual] = await Promise.all([
    redis.get<number>(chaveHora),
    redis.get<number>(chaveDia),
  ]);
  const escritas: Promise<unknown>[] = [
    redis.set(chaveHora, (horaAtual || 0) + 1, { ex: BUCKET_HORA_TTL_SEGUNDOS }),
    redis.set(chaveDia, (diaAtual || 0) + 1, { ex: BUCKET_DIA_TTL_SEGUNDOS }),
    redis.set(CHAVE_ULTIMO_EVENTO_PIX, registro),
  ];
  if (opts?.ultimaConfirmacaoAutomatica) {
    escritas.push(redis.set(CHAVE_ULTIMA_CONFIRMACAO_AUTOMATICA_PIX, registro));
  }
  await Promise.all(escritas);
}

/**
 * Registra um evento de observabilidade adicional do Sentinela Pix —
 * SEPARADO de incrementarContadorPix (que não é alterado). Grava, em uma
 * única viagem de rede quando o cliente Redis suporta pipeline (produção):
 *   - contador do bucket da hora atual (TTL 72h)
 *   - contador do bucket do dia atual (TTL 35 dias)
 *   - "último evento": { tipo, ts } — NUNCA inclui pedidoId, nem mascarado
 *   - opcionalmente "última confirmação pelo Sentinela": { tipo, ts }
 * Sem suporte a pipeline (ex.: mocks de teste), cai para o menor número
 * possível de escritas sequenciais equivalentes.
 *
 * NUNCA lança e SEMPRE resolve em no máximo TIMEOUT_TELEMETRIA_MS (100ms),
 * mesmo que a operação Redis nunca resolva: a gravação real roda numa
 * Promise mantida viva (com seu próprio `.catch()`, para nunca virar uma
 * rejeição não tratada depois que o timeout já tiver vencido a corrida) e
 * disputa um `Promise.race` contra um timer — quem resolver primeiro decide
 * o retorno desta função, mas a gravação em si nunca é cancelada.
 */
export async function registrarEventoObservabilidadePix(
  tipo: EventoObservabilidadePix,
  opts?: { ultimaConfirmacaoAutomatica?: boolean; agora?: number }
): Promise<void> {
  const gravacao = executarGravacaoObservabilidadePix(tipo, opts).catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TIMEOUT_TELEMETRIA_MS);
  });

  try {
    await Promise.race([gravacao, limite]);
  } finally {
    // Gravação terminou antes do limite: cancela o timer pendente em vez de
    // deixá-lo rodar até os 100ms à toa (nunca prende o event loop do
    // ambiente serverless por mais tempo do que o necessário).
    if (timer) clearTimeout(timer);
  }
}

export type UltimoEventoPix = { tipo: string; ts: number } | null;

export async function obterUltimoEventoPix(): Promise<UltimoEventoPix> {
  try {
    return (await redis.get<{ tipo: string; ts: number }>(CHAVE_ULTIMO_EVENTO_PIX)) || null;
  } catch {
    return null;
  }
}

export async function obterUltimaConfirmacaoAutomaticaPix(): Promise<UltimoEventoPix> {
  try {
    return (await redis.get<{ tipo: string; ts: number }>(CHAVE_ULTIMA_CONFIRMACAO_AUTOMATICA_PIX)) || null;
  } catch {
    return null;
  }
}

// Proporção consultasMercadoPago / mensagensQStash (Sentinela Pix) — quanto
// menor, maior a economia do Sentinela (mais ticks QStash resultaram em
// "evitada"/"coalescida"/"geração antiga" em vez de uma consulta real ao
// Mercado Pago). null quando ainda não houve nenhuma mensagem QStash
// publicada (evita divisão por zero / proporção sem sentido).
export function calcularProporcaoConsultaPorMensagemQstash(
  contadores: Pick<Record<ContadorPixMetrica, number>, "sentinela_consulta_realizada" | "qstash_mensagens_publicadas">
): number | null {
  const mensagens = contadores.qstash_mensagens_publicadas || 0;
  if (mensagens === 0) return null;
  const consultas = contadores.sentinela_consulta_realizada || 0;
  return Math.round((consultas / mensagens) * 1000) / 1000;
}
