// Configuração central da cadência de auto-verificação do Pix Mercado Pago
// e dos parâmetros do Sentinela Pix (Nível 6.9). Único lugar que define os
// números de intervalo/cooldown/lock: nada de valor mágico espalhado pelo
// painel, pelo conciliador, pelo Guardião ou pelo Sentinela — todos importam
// daqui.
//
// Janela adaptativa (a partir da criação do pagamento):
// - 0 a 30s:     5s  (piso desta etapa, configurável)
// - 30s a 2min:  10s
// - 2 a 5min:    20s
// - 5 a 15min:   60s
// - 15 a 45min:  180s
// - após 45min:  encerra a cadeia operacional (PIX_GUARDIAO_IDADE_MAXIMA_MS)
//
// Rollback: setar PIX_AUTO_CHECK_INITIAL_INTERVAL_MS=20000 no ambiente volta
// a primeira janela ao comportamento anterior à otimização, sem tocar em
// nenhum código financeiro. Se a variável estiver ausente, usa o novo padrão
// (5s). Se estiver presente mas inválida (não numérica ou abaixo do piso
// mínimo), cai para o valor historicamente validado em produção (20s) em vez
// de um número arbitrário.

const PIX_AUTO_CHECK_DEFAULT_INITIAL_INTERVAL_MS = 5_000;
export const PIX_AUTO_CHECK_FALLBACK_INITIAL_INTERVAL_MS = 20_000;
const PIX_AUTO_CHECK_INTERVAL_MIN_MS = 1_000;

function resolveInitialIntervalMs(): number {
  // NEXT_PUBLIC_* é a única forma de uma env var chegar ao bundle do
  // cliente (o painel /pedidos roda no navegador — Next.js só substitui
  // estaticamente variáveis com esse prefixo). Mantém a variável sem
  // prefixo como alias para uso em contexto server-side.
  const raw = process.env.NEXT_PUBLIC_PIX_AUTO_CHECK_INITIAL_INTERVAL_MS ?? process.env.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS;
  if (raw === undefined || raw.trim() === "") return PIX_AUTO_CHECK_DEFAULT_INITIAL_INTERVAL_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < PIX_AUTO_CHECK_INTERVAL_MIN_MS) {
    return PIX_AUTO_CHECK_FALLBACK_INITIAL_INTERVAL_MS;
  }
  return parsed;
}

export const PIX_AUTO_CHECK_INITIAL_INTERVAL_MS = resolveInitialIntervalMs();

// Camadas 2-5 da cadência — só a primeira janela é configurável via env
// (pedido original: "altere somente a primeira janela e preserve os demais
// mecanismos"); as demais são constantes fixas centralizadas aqui.
export const PIX_AUTO_CHECK_INTERVAL_TIER2_MS = 10_000; // 30s .. 2min
export const PIX_AUTO_CHECK_INTERVAL_TIER3_MS = 20_000; // 2min .. 5min
export const PIX_AUTO_CHECK_INTERVAL_TIER4_MS = 60_000; // 5min .. 15min
export const PIX_AUTO_CHECK_INTERVAL_TIER5_MS = 180_000; // 15min .. 45min

// Sem nenhum Pix Mercado Pago pendente na lista: volta ao intervalo leve
// (mesmo valor de níveis anteriores — fora do escopo desta mudança).
export const PIX_AUTO_CHECK_INTERVAL_SEM_PENDENTE_MS = 120_000;

export const PIX_AUTO_CHECK_WINDOW_30S_MS = 30 * 1000;
export const PIX_AUTO_CHECK_WINDOW_2MIN_MS = 2 * 60 * 1000;
export const PIX_AUTO_CHECK_WINDOW_5MIN_MS = 5 * 60 * 1000;
export const PIX_AUTO_CHECK_WINDOW_15MIN_MS = 15 * 60 * 1000;

// Jitter pequeno para múltiplas instâncias/abas não baterem no Mercado Pago
// no mesmo milissegundo. Deliberadamente pequeno para não empurrar a
// primeira janela de forma relevante para além dos 5s desejados.
export const PIX_AUTO_CHECK_JITTER_MAX_MS = 800;

/**
 * Intervalo até a próxima verificação para um pagamento Mercado Pago ainda
 * pendente, dado há quanto tempo (ms) ele foi criado. Determinístico, sem
 * qualquer heurística probabilística. O corte final (encerrar a cadeia após
 * PIX_GUARDIAO_IDADE_MAXIMA_MS) é decidido por quem chama esta função, não
 * aqui — esta função só responde "com que intervalo", nunca "se".
 */
export function calcularIntervaloPorIdade(idadeMs: number): number {
  const idade = Number.isFinite(idadeMs) && idadeMs > 0 ? idadeMs : 0;
  if (idade < PIX_AUTO_CHECK_WINDOW_30S_MS) return PIX_AUTO_CHECK_INITIAL_INTERVAL_MS;
  if (idade < PIX_AUTO_CHECK_WINDOW_2MIN_MS) return PIX_AUTO_CHECK_INTERVAL_TIER2_MS;
  if (idade < PIX_AUTO_CHECK_WINDOW_5MIN_MS) return PIX_AUTO_CHECK_INTERVAL_TIER3_MS;
  if (idade < PIX_AUTO_CHECK_WINDOW_15MIN_MS) return PIX_AUTO_CHECK_INTERVAL_TIER4_MS;
  return PIX_AUTO_CHECK_INTERVAL_TIER5_MS;
}

export function aplicarJitter(intervaloMs: number, maxJitterMs: number = PIX_AUTO_CHECK_JITTER_MAX_MS): number {
  if (maxJitterMs <= 0) return intervaloMs;
  return intervaloMs + Math.floor(Math.random() * maxJitterMs);
}

// Guardião Pix — limites de recuperação e janelas de saúde operacional
// (não financeiras). Também centralizados aqui para evitar números mágicos
// no módulo do Guardião.
export const PIX_GUARDIAO_MAX_RECUPERACOES = 5;
export const PIX_GUARDIAO_COOLDOWN_RECUPERACAO_SEGUNDOS = 30;
// Considerado "atrasado" quando a última tentativa/última resposta válida é
// mais antiga que N vezes o intervalo esperado para a idade atual do pagamento.
export const PIX_GUARDIAO_MULTIPLICADOR_ATRASO = 2;
export const PIX_GUARDIAO_FALHAS_CONSECUTIVAS_LIMITE = 3;
// Idade a partir da qual o Guardião/Sentinela param de tentar recuperar e só
// classificam como "expired" (operacional) para observabilidade — não é a
// expiração financeira do Pix (essa continua sendo decidida pelo status
// oficial vindo do Mercado Pago/webhook/confirmação manual).
export const PIX_GUARDIAO_IDADE_MAXIMA_MS = 45 * 60 * 1000;

// Política comercial de pagamento Pix Mercado Pago. O limite operacional de
// 45 min do Guardião acima continua apenas como rede de segurança para falhas
// de infraestrutura; em fluxo normal, aviso e encerramento acontecem antes.
export const PIX_PAGAMENTO_AVISO_PENDENTE_MS = 6 * 60 * 1000;
export const PIX_PAGAMENTO_CANCELAMENTO_MS = 13 * 60 * 1000;
export const PIX_PAGAMENTO_RETRY_INCONCLUSIVO_MS = 15_000;

export function calcularDelayAteProximoMarcoPagamentoPix(idadeMs: number): number | null {
  const idade = Math.max(0, Number.isFinite(idadeMs) ? idadeMs : 0);
  if (idade < PIX_PAGAMENTO_AVISO_PENDENTE_MS) return PIX_PAGAMENTO_AVISO_PENDENTE_MS - idade;
  if (idade < PIX_PAGAMENTO_CANCELAMENTO_MS) return PIX_PAGAMENTO_CANCELAMENTO_MS - idade;
  return null;
}

// --- Sentinela Pix (Nível 6.9) ------------------------------------------
// Camada determinística de COORDENAÇÃO de consultas ao Mercado Pago — nunca
// decide se um pagamento foi confirmado (isso segue vindo exclusivamente do
// Mercado Pago via reconciliarPixMercadoPago, do webhook ou da confirmação
// manual). Só decide QUANDO uma consulta oficial é permitida.

// Lock de single-flight por pagamento — impede duas consultas concorrentes
// ao mesmo paymentId (painel, QStash, conciliador). TTL curto: uma consulta
// real ao Mercado Pago (com timeout de 5s no conciliador) nunca deveria
// segurar o lock por mais que isso; o TTL é só rede de segurança contra
// crash no meio da consulta.
export const PIX_SENTINELA_LOCK_TTL_SEGUNDOS = 12;

// TTL do estado operacional do Sentinela por pedido — mesmo horizonte da
// cadeia (idade máxima) mais margem, igual ao lock de cadeia do Guardião.
export const PIX_SENTINELA_ESTADO_TTL_SEGUNDOS = Math.ceil(PIX_GUARDIAO_IDADE_MAXIMA_MS / 1000) + 60;

// Backoff aplicado ao intervalo normal quando uma consulta falha (timeout ou
// erro transitório) — multiplicativo e limitado, nunca confirma nada por
// suposição, só espaça as próximas tentativas.
export const PIX_SENTINELA_BACKOFF_MULTIPLICADOR = 2;
export const PIX_SENTINELA_BACKOFF_MAX_MULTIPLICADOR = 8;

// Cooldown por pagamento após rate limit (429) do Mercado Pago — aplicado
// além do cooldown global já existente no conciliador
// (cooldown:mercadopago:reconciliacao, 60s), como segunda camada específica
// do Sentinela para esse pagamento.
export const PIX_SENTINELA_COOLDOWN_RATE_LIMIT_SEGUNDOS = 60;

// QStash — paralelismo máximo de entregas simultâneas ao endpoint do
// Guardião/Sentinela (flowControl). 0/ausente desativa o flowControl
// (rollback simples caso a Vercel/QStash precise de ajuste sem redeploy de
// lógica). Valor moderado por padrão: o próprio Sentinela é quem decide se
// uma consulta real ao Mercado Pago acontece, então o flowControl aqui é só
// uma segunda camada de proteção contra picos de invocação da função.
const PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM_DEFAULT = 10;
function resolveFlowControlParallelism(): number {
  const raw = process.env.PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM;
  if (raw === undefined || raw.trim() === "") return PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM_DEFAULT;
  return Math.trunc(parsed);
}
export const PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM = resolveFlowControlParallelism();
export const PIX_GUARDIAO_QSTASH_FLOW_CONTROL_KEY = "pix-guardiao-verificacao";

// QStash — número de retries por tick. Reduzido de 3 para 2: o endpoint é
// idempotente (dedupe por tick + geração da cadeia + gating do Sentinela),
// então uma 3ª tentativa raramente muda o resultado e só adiciona custo.
export const PIX_GUARDIAO_QSTASH_RETRIES = 2;
