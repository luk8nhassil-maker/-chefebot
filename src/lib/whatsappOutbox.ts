import { randomUUID } from "crypto";
import { Client } from "@upstash/qstash";
import { redis } from "./redis";

// Outbox durável de WhatsApp. A Evolution não aceita chave de idempotência no
// sendText; por isso a outbox é "at-least-once até o provider" e nunca repete
// automaticamente um resultado ambíguo (timeout, rede ou 5xx).

export type PrioridadeWhatsapp = "critica" | "normal" | "promocional";
export type EstadoOutboxWhatsapp = "pending" | "leased" | "delivered" | "failed" | "ambiguous" | "suppressed" | "expired";

export type JobOutboxWhatsapp = {
  id: string;
  kind: "text" | "image";
  conversationId: string;
  phone: string;
  text: string;
  mediaUrl?: string;
  mediaCaption?: string;
  priority: PrioridadeWhatsapp;
  state: EstadoOutboxWhatsapp;
  createdAt: number;
  updatedAt: number;
  attempt: number;
  opts?: { delay?: number; presence?: "composing"; timeoutMs?: number; maxAttempts?: 1 };
  idempotencyKey?: string;
  leaseToken?: string;
  /** Prazo de negócio (ex.: OTP); diferente da retenção técnica de 7 dias. */
  expiresAt?: number;
  /** Metadado mínimo para atualizar o histórico só após confirmação do provider. */
  humanSenderName?: string;
  /** Efeito de histórico que o worker conclui somente após entrega confirmada. */
  history?: { autor: "bot" | "atendente"; texto: string; markOutbound?: boolean };
  result?: ResultadoTransporteWhatsapp | { motivo: string };
};

export type ResultadoTransporteWhatsapp = {
  ok: boolean; motivo?: string; statusHttp?: number; messageIdMascarado?: string; latenciaMs: number; tentativas: number;
};

const PREFIX = "whatsapp:outbox:";
const TTL_SEGUNDOS = 7 * 24 * 60 * 60;
const LEASE_MS = 30_000;
const LIMITE_PADRAO = 4;
const LIMITE_MAXIMO = 16;

const chaveJob = (id: string) => `${PREFIX}job:${id}`;
const chaveFila = (prioridade: PrioridadeWhatsapp) => `${PREFIX}due:${prioridade}`;
const chaveDedupe = (id: string) => `${PREFIX}dedupe:${id}`;
const chaveConversa = (id: string) => `${PREFIX}conversation:${id}`;
const chaveSequenciaConversa = (id: string) => `${PREFIX}conversation-queue:${id}`;
const chaveContadorSequenciaConversa = (id: string) => `${PREFIX}conversation-sequence:${id}`;
const CHAVE_LEASES = `${PREFIX}leases`;
const CHAVE_HISTORICO_HUMANO = `${PREFIX}human-history`;
const CHAVE_RECONCILIACAO = `${PREFIX}reconciliation`;
const CHAVE_INCONSISTENCIAS = `${PREFIX}unresolved`;
// Índice reverso durável: permite limpar uma cabeça órfã sem varrer todas as
// conversas. Ele é apagado junto com terminalidades seguras.
const CHAVE_CONVERSAS_POR_JOB = `${PREFIX}job-conversations`;
const CHAVE_VELOCIDADE = `${PREFIX}rate-window`;
// Telemetria agregada e sem PII, escrita atomicamente nos scripts existentes.
const CHAVE_METRICAS = `${PREFIX}monitor:metrics`;
const CHAVE_INCIDENTES = `${PREFIX}monitor:incidents`;
const chaveClaimHistoricoHumano = (id: string) => `${PREFIX}human-history-claim:${id}`;

function limiteGlobal(): number {
  const n = Number(process.env.WHATSAPP_OUTBOX_CONCURRENCY ?? LIMITE_PADRAO);
  return Number.isInteger(n) && n > 0 ? Math.min(n, LIMITE_MAXIMO) : LIMITE_PADRAO;
}

/**
 * Teto global opcional por janela deslizante. Não há número oficial público
 * da Evolution: ausente/inválido significa desabilitado, para que a operação
 * escolha o valor a partir de métricas da sua instância.
 */
function limiteVelocidadePorMinuto(): number {
  const n = Number(process.env.WHATSAPP_OUTBOX_RATE_LIMIT_PER_MINUTE ?? 0);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100_000) : 0;
}

function conversaSegura(phone: string): string {
  // O telefone fica apenas no valor do job; a chave não expõe PII.
  let hash = 2166136261;
  for (let i = 0; i < phone.length; i++) hash = Math.imul(hash ^ phone.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

const ENFILEIRAR_LUA = `
local dedupe = ARGV[1]
if dedupe ~= '' then
  local existing = redis.call('GET', KEYS[1])
  if existing then return existing end
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[5])
local sequence = redis.call('INCR', KEYS[5])
redis.call('EXPIRE', KEYS[5], ARGV[4])
redis.call('ZADD', KEYS[4], sequence, ARGV[5])
redis.call('HSET', KEYS[6], ARGV[5], ARGV[6])
if dedupe ~= '' then redis.call('SET', KEYS[1], ARGV[5], 'EX', ARGV[4]) end
redis.pcall('HSETNX', KEYS[7], 'since', ARGV[3])
redis.pcall('HINCRBY', KEYS[7], 'queued', 1)
return ARGV[5]
`;

const CLAIM_LUA = `
local now = tonumber(ARGV[1])
local leaseUntil = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local leaseToken = ARGV[4]
local rateLimit = tonumber(ARGV[10]) or 0
-- Não remova leases vencidos aqui. Eles precisam passar pela reconciliação
-- explícita antes de deixarem de contar para o limite global.
if redis.call('ZCARD', KEYS[1]) >= limit then return nil end
if rateLimit > 0 then
  redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now - 60000)
  if redis.call('ZCARD', KEYS[5]) >= rateLimit then return nil end
end
for q = 2, 4 do
  -- Não use uma janela fixa: 32 cabeças bloqueadas de uma conversa não podem
  -- ocultar uma conversa independente pronta logo depois na mesma fila.
  local candidates = redis.call('ZRANGEBYSCORE', KEYS[q], '-inf', now)
  for _, id in ipairs(candidates) do
    local jobKey = ARGV[5] .. id
    local raw = redis.call('GET', jobKey)
    if not raw then
      redis.call('ZREM', KEYS[q], id)
      -- Nunca reenvie um job cujo registro se perdeu. O índice reverso
      -- permite retirar somente sua cabeça, manter a evidência visível e
      -- liberar as mensagens posteriores da mesma conversa.
      local conversationId = redis.call('HGET', KEYS[6], id)
      if conversationId then
        redis.call('ZREM', ARGV[7] .. conversationId, id)
        redis.call('HDEL', KEYS[6], id)
      end
      redis.call('ZADD', KEYS[7], now, id)
    else
      local job = cjson.decode(raw)
      if job.state ~= 'pending' then
        redis.call('ZREM', KEYS[q], id)
      else
        local conversationQueueKey = ARGV[7] .. job.conversationId
        local firstInConversation = redis.call('ZRANGE', conversationQueueKey, 0, 0)[1]
        if firstInConversation == id then
          local conversationKey = ARGV[6] .. job.conversationId
          if redis.call('SET', conversationKey, id, 'NX', 'PX', ARGV[8]) then
            job.state = 'leased'
            job.leaseToken = leaseToken
            job.updatedAt = now
            job.attempt = (job.attempt or 0) + 1
            redis.call('SET', jobKey, cjson.encode(job), 'EX', ARGV[9])
            redis.call('ZREM', KEYS[q], id)
            redis.call('ZADD', KEYS[1], leaseUntil, id)
            if rateLimit > 0 then redis.call('ZADD', KEYS[5], now, leaseToken) end
            return cjson.encode(job)
          end
        end
      end
    end
  end
end
return nil
`;

const FINALIZAR_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local job = cjson.decode(raw)
if job.state ~= 'leased' or job.leaseToken ~= ARGV[1] then return 0 end
job.state = ARGV[2]
job.updatedAt = tonumber(ARGV[3])
job.leaseToken = nil
job.result = cjson.decode(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[5])
redis.call('ZREM', KEYS[2], job.id)
if redis.call('GET', KEYS[3]) == job.id then redis.call('DEL', KEYS[3]) end
-- Somente uma terminalidade comprovada libera a próxima mensagem da
-- conversa. Resultado ambíguo preserva a cabeça até reconciliação explícita.
if ARGV[2] == 'ambiguous' then
  redis.call('ZADD', KEYS[6], tonumber(ARGV[3]), job.id)
else
  redis.call('ZREM', KEYS[4], job.id)
  redis.call('ZREM', KEYS[6], job.id)
  redis.call('HDEL', KEYS[7], job.id)
end
if (job.humanSenderName or job.history) and ARGV[2] == 'delivered' then
  redis.call('ZADD', KEYS[5], tonumber(ARGV[3]), job.id)
end
-- Erros definitivos podem ser corrigidos (payload/configuração) e submetidos
-- novamente; resultados ambíguos permanecem deduplicados para não duplicar.
if job.idempotencyKey and (ARGV[2] == 'failed' or ARGV[2] == 'expired' or ARGV[2] == 'suppressed') then
  redis.call('DEL', ARGV[6] .. job.idempotencyKey)
end
redis.pcall('HINCRBY', KEYS[8], ARGV[2], 1)
if ARGV[2] == 'failed' or ARGV[2] == 'ambiguous' then
  redis.pcall('ZADD', KEYS[9], tonumber(ARGV[3]), job.id)
  local size = redis.pcall('ZCARD', KEYS[9])
  if type(size) == 'number' and size > 100 then redis.pcall('ZREMRANGEBYRANK', KEYS[9], 0, size - 101) end
end
return 1
`;

const RECUPERAR_LEASES_LUA = `
local now = tonumber(ARGV[1])
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, tonumber(ARGV[2]))
local reconciled = 0
local unresolved = 0
for _, id in ipairs(ids) do
  local raw = redis.call('GET', ARGV[3] .. id)
  if raw then
    local job = cjson.decode(raw)
    if job.state == 'leased' then
      job.state = 'ambiguous'
      job.updatedAt = now
      job.leaseToken = nil
      job.result = { motivo = 'lease_expired_without_provider_confirmation' }
      redis.call('SET', ARGV[3] .. id, cjson.encode(job), 'EX', ARGV[4])
      -- Mantém a cabeça e o lock lógico da conversa: um resultado incerto
      -- não pode permitir que a mensagem seguinte ultrapasse esta.
      redis.call('ZADD', KEYS[2], now, id)
      redis.pcall('ZADD', KEYS[6], now, id)
      redis.call('ZREM', KEYS[1], id)
      reconciled = reconciled + 1
    else
      -- Inconsistência: mantenha o lease visível e bloqueando capacidade até
      -- uma reconciliação operacional, em vez de fazê-lo sumir.
      redis.call('ZADD', KEYS[3], now, id)
      redis.call('ZREM', KEYS[1], id)
      unresolved = unresolved + 1
    end
  else
    -- Uma chave de job ausente pode indicar expiração/evicção do Redis. O
    -- job não é reenviado. Limpe sua cabeça pelo índice reverso e mantenha
    -- a pendência na quarentena auditável, sem bloquear a conversa para
    -- sempre.
    local conversationId = redis.call('HGET', KEYS[4], id)
    if conversationId then
      redis.call('ZREM', ARGV[6] .. conversationId, id)
      redis.call('HDEL', KEYS[4], id)
    end
    redis.call('ZADD', KEYS[3], now, id)
    redis.call('ZREM', KEYS[1], id)
    unresolved = unresolved + 1
  end
end
local incidentSize = redis.pcall('ZCARD', KEYS[6])
if type(incidentSize) == 'number' and incidentSize > 100 then
  redis.pcall('ZREMRANGEBYRANK', KEYS[6], 0, incidentSize - 101)
end
if reconciled > 0 then
  redis.pcall('HINCRBY', KEYS[5], 'recovered', reconciled)
  redis.pcall('HINCRBY', KEYS[5], 'ambiguous', reconciled)
end
if unresolved > 0 then redis.pcall('HINCRBY', KEYS[5], 'unresolvedEvents', unresolved) end
return { reconciled, unresolved }
`;

export async function enfileirarMensagemWhatsapp(input: {
  phone: string; text: string; priority?: PrioridadeWhatsapp;
  opts?: JobOutboxWhatsapp["opts"]; idempotencyKey?: string; humanSenderName?: string; expiresAt?: number; history?: JobOutboxWhatsapp["history"];
}): Promise<{ jobId: string; deduplicated: boolean }> {
  const id = randomUUID();
  const now = Date.now();
  const priority = input.priority ?? "critica";
  const job: JobOutboxWhatsapp = {
    id, kind: "text", phone: input.phone, text: input.text, priority, state: "pending", createdAt: now, updatedAt: now,
    attempt: 0, conversationId: conversaSegura(input.phone), opts: input.opts, idempotencyKey: input.idempotencyKey,
    humanSenderName: input.humanSenderName,
    expiresAt: input.expiresAt,
    history: input.history,
  };
  const dedupe = input.idempotencyKey ? chaveDedupe(input.idempotencyKey) : "";
  const resultado = await redis.eval(ENFILEIRAR_LUA,
    [dedupe || `${PREFIX}no-dedupe:${id}`, chaveJob(id), chaveFila(priority), chaveSequenciaConversa(job.conversationId), chaveContadorSequenciaConversa(job.conversationId), CHAVE_CONVERSAS_POR_JOB, CHAVE_METRICAS],
    [dedupe, JSON.stringify(job), String(now), String(TTL_SEGUNDOS), id, job.conversationId]);
  return { jobId: String(resultado), deduplicated: String(resultado) !== id };
}

export async function enfileirarImagemWhatsapp(input: {
  phone: string; mediaUrl: string; caption?: string; priority?: PrioridadeWhatsapp; idempotencyKey?: string;
}): Promise<{ jobId: string; deduplicated: boolean }> {
  const id = randomUUID();
  const now = Date.now();
  const priority = input.priority ?? "critica";
  const job: JobOutboxWhatsapp = {
    id, kind: "image", phone: input.phone, text: "", mediaUrl: input.mediaUrl, mediaCaption: input.caption ?? "",
    priority, state: "pending", createdAt: now, updatedAt: now, attempt: 0,
    conversationId: conversaSegura(input.phone), idempotencyKey: input.idempotencyKey,
  };
  const dedupe = input.idempotencyKey ? chaveDedupe(input.idempotencyKey) : "";
  const resultado = await redis.eval(ENFILEIRAR_LUA,
    [dedupe || `${PREFIX}no-dedupe:${id}`, chaveJob(id), chaveFila(priority), chaveSequenciaConversa(job.conversationId), chaveContadorSequenciaConversa(job.conversationId), CHAVE_CONVERSAS_POR_JOB, CHAVE_METRICAS],
    [dedupe, JSON.stringify(job), String(now), String(TTL_SEGUNDOS), id, job.conversationId]);
  return { jobId: String(resultado), deduplicated: String(resultado) !== id };
}

async function claimProximo(): Promise<JobOutboxWhatsapp | null> {
  const now = Date.now();
  const raw = await redis.eval(CLAIM_LUA,
    [CHAVE_LEASES, chaveFila("critica"), chaveFila("normal"), chaveFila("promocional"), CHAVE_VELOCIDADE, CHAVE_CONVERSAS_POR_JOB, CHAVE_INCONSISTENCIAS],
    [String(now), String(now + LEASE_MS), String(limiteGlobal()), randomUUID(), `${PREFIX}job:`, `${PREFIX}conversation:`, `${PREFIX}conversation-queue:`, String(LEASE_MS), String(TTL_SEGUNDOS), String(limiteVelocidadePorMinuto())]);
  if (raw == null) return null;
  // O SDK da Upstash pode devolver o JSON do Lua já desserializado.
  // JSON.parse(String(objeto)) causava HTTP 500 depois de reservar o lease,
  // antes de qualquer envio à Evolution.
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    typeof (parsed as JobOutboxWhatsapp).id !== "string" ||
    (parsed as JobOutboxWhatsapp).state !== "leased" ||
    typeof (parsed as JobOutboxWhatsapp).leaseToken !== "string"
  ) throw new Error("outbox_claim_invalid_response");
  return parsed as JobOutboxWhatsapp;
}

async function finalizar(job: JobOutboxWhatsapp, estado: "delivered" | "failed" | "ambiguous" | "suppressed" | "expired", result: ResultadoTransporteWhatsapp | { motivo: string }): Promise<boolean> {
  return Number(await redis.eval(FINALIZAR_LUA, [chaveJob(job.id), CHAVE_LEASES, chaveConversa(job.conversationId), chaveSequenciaConversa(job.conversationId), CHAVE_HISTORICO_HUMANO, CHAVE_RECONCILIACAO, CHAVE_CONVERSAS_POR_JOB, CHAVE_METRICAS, CHAVE_INCIDENTES],
    [job.leaseToken ?? "", estado, String(Date.now()), JSON.stringify(result), String(TTL_SEGUNDOS), `${PREFIX}dedupe:`])) === 1;
}

export type RecuperacaoLeasesWhatsapp = { reconciled: number; unresolved: number };

export async function recuperarLeasesWhatsapp(limite = 100): Promise<RecuperacaoLeasesWhatsapp> {
  const result = await redis.eval(RECUPERAR_LEASES_LUA, [CHAVE_LEASES, CHAVE_RECONCILIACAO, CHAVE_INCONSISTENCIAS, CHAVE_CONVERSAS_POR_JOB, CHAVE_METRICAS, CHAVE_INCIDENTES],
    [String(Date.now()), String(Math.max(1, Math.min(limite, 500))), `${PREFIX}job:`, String(TTL_SEGUNDOS), `${PREFIX}conversation:`, `${PREFIX}conversation-queue:`]);
  const values = Array.isArray(result) ? result : [result, 0];
  return { reconciled: Number(values[0]) || 0, unresolved: Number(values[1]) || 0 };
}

function resultadoAmbiguo(resultado: ResultadoTransporteWhatsapp): boolean {
  return resultado.motivo === "timeout" || resultado.motivo === "network_error" ||
    (typeof resultado.statusHttp === "number" && resultado.statusHttp >= 500);
}

export async function processarFilaWhatsapp(
  executar: (job: JobOutboxWhatsapp) => Promise<ResultadoTransporteWhatsapp>,
  limite = limiteGlobal(),
  limiteJobs = limite,
): Promise<{ processed: number; delivered: number; failed: number; ambiguous: number }> {
  await recuperarLeasesWhatsapp();
  let processed = 0, delivered = 0, failed = 0, ambiguous = 0, remaining = Math.max(0, limiteJobs);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, LIMITE_MAXIMO)) }, async () => {
    for (;;) {
      // Reserva síncrona do orçamento antes do await do claim: nenhum worker
      // pode ultrapassar o teto de lote por passar na mesma checagem.
      if (remaining <= 0) return;
      remaining--;
      const job = await claimProximo();
      if (!job) { remaining++; return; }
      processed++;
      try {
        if (job.expiresAt && job.expiresAt <= Date.now()) {
          await finalizar(job, "expired", { motivo: "expired_before_provider_send" });
          continue;
        }
        // A pausa global também vale para promoções já aceitas pela outbox;
        // decidir somente no enfileiramento deixaria lotes antigos escaparem.
        if (job.priority === "promocional" && await redis.get<boolean>("bot_ativo") === false) {
          await finalizar(job, "suppressed", { motivo: "global_pause_promotional" });
          continue;
        }
        const resultado = await executar(job);
        if (resultado.ok) { if (await finalizar(job, "delivered", resultado)) delivered++; }
        else if (resultado.motivo === "subscription_silenced_new_contact") { await finalizar(job, "suppressed", resultado); }
        else if (resultadoAmbiguo(resultado)) { await finalizar(job, "ambiguous", resultado); ambiguous++; }
        else { await finalizar(job, "failed", resultado); failed++; }
      } catch {
        await finalizar(job, "ambiguous", { motivo: "executor_threw_before_provider_confirmation" });
        ambiguous++;
      }
    }
  }));
  return { processed, delivered, failed, ambiguous };
}

export async function obterJobWhatsapp(id: string): Promise<JobOutboxWhatsapp | null> {
  return await redis.get<JobOutboxWhatsapp>(chaveJob(id));
}


/**
 * Encerra APENAS canários antigos com lease vencido sem confirmação.
 *
 * Uma execução anterior podia falhar no parse do retorno Redis depois de
 * reservar o lease e ANTES de chamar a Evolution. Seu job ficava ambíguo.
 * Nunca inferir que foi entregue; abandonar o teste sem reenvio. Não tocar
 * em jobs de clientes ou em outros tipos de resultado incerto.
 *
 * Chamado apenas por POST autenticado de início de novo teste. Leituras GET
 * do monitor permanecem estritamente sem efeitos colaterais.
 */
const ENCERRAR_CANARIO_EXPIRADO_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if not redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 0 end
local job = cjson.decode(raw)
if job.id ~= ARGV[1] or job.state ~= 'ambiguous' then return 0 end
if job.idempotencyKey ~= ARGV[2] or job.phone ~= ARGV[3] then return 0 end
if job.kind ~= 'text' or job.text ~= ARGV[4] then return 0 end
if job.conversationId ~= ARGV[7] then return 0 end
if not job.result or job.result.motivo ~= 'lease_expired_without_provider_confirmation' then return 0 end
if (tonumber(job.createdAt) or 0) > tonumber(ARGV[5]) - 1200000 then return 0 end
job.state = 'suppressed'
job.updatedAt = tonumber(ARGV[5])
job.result = { motivo = 'expired_technical_canary_closed_without_resend' }
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', tonumber(ARGV[6]))
redis.call('ZREM', KEYS[2], job.id)
if redis.call('GET', KEYS[3]) == job.id then redis.call('DEL', KEYS[3]) end
redis.call('ZREM', KEYS[4], job.id)
redis.call('HDEL', KEYS[5], job.id)
redis.pcall('HINCRBY', KEYS[6], 'closedCanaryNoRetry', 1)
return 1
`;


/**
 * Rota de contingência para um canário LEGADO cujo registro da última execução
 * guarda o jobId exato. Não tenta identificar jobs apenas por horários ou por
 * falta de recebimento no telefone: exige vínculo persistido e prova atômica.
 */
const ENCERRAR_CANARIO_VINCULADO_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw or not redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 0 end
local job = cjson.decode(raw)
if job.id ~= ARGV[1] or job.state ~= 'ambiguous' then return 0 end
if job.phone ~= ARGV[2] or job.kind ~= 'text' or job.priority ~= 'critica' then return 0 end
if job.conversationId ~= ARGV[9] then return 0 end
if not job.result or job.result.motivo ~= 'lease_expired_without_provider_confirmation' then return 0 end
local created = tonumber(job.createdAt) or 0
if created < tonumber(ARGV[5]) - 30000 or created > tonumber(ARGV[6]) then return 0 end
if created > tonumber(ARGV[7]) - 1200000 then return 0 end
if job.text ~= ARGV[3] and job.idempotencyKey ~= ARGV[4] then return 0 end
job.state = 'suppressed'
job.updatedAt = tonumber(ARGV[7])
job.result = { motivo = 'expired_technical_canary_closed_without_resend' }
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', tonumber(ARGV[8]))
redis.call('ZREM', KEYS[2], job.id)
if redis.call('GET', KEYS[3]) == job.id then redis.call('DEL', KEYS[3]) end
redis.call('ZREM', KEYS[4], job.id)
redis.call('HDEL', KEYS[5], job.id)
redis.pcall('HINCRBY', KEYS[6], 'closedCanaryNoRetry', 1)
return 1
`;

export type VinculoCanarioExpirado = {
  token: string;
  outboundOutboxJobId?: string;
  createdAt: number;
  expiresAt: number;
  state: string;
};

export async function encerrarCanarioVinculadoSemReenvio(
  telefoneAutorizado: string, canario: VinculoCanarioExpirado | null
): Promise<number> {
  const agora = Date.now();
  if (!canario || !canario.outboundOutboxJobId || canario.state !== 'expired' ||
    !/^CBTEST-[A-Z0-9]{4}$/.test(canario.token) ||
    !Number.isFinite(canario.createdAt) || !Number.isFinite(canario.expiresAt) ||
    canario.expiresAt > agora || canario.createdAt > agora - 20 * 60000) return 0;
  const job = await obterJobWhatsapp(canario.outboundOutboxJobId);
  if (!job || job.id !== canario.outboundOutboxJobId || job.state !== 'ambiguous' ||
    job.phone !== telefoneAutorizado || job.kind !== 'text' ||
    job.priority !== 'critica' ||
    job.result?.motivo !== 'lease_expired_without_provider_confirmation' ||
    job.createdAt < canario.createdAt - 30000 || job.createdAt > canario.expiresAt ||
    job.createdAt > agora - 20 * 60000) return 0;
  const esperado = `Teste técnico do ChefeBot: ${canario.token}\nResponda exatamente: ${canario.token}`;
  const dedupe = `canary:${canario.token}`;
  if (job.text !== esperado && job.idempotencyKey !== dedupe) return 0;
  const changed = await redis.eval(ENCERRAR_CANARIO_VINCULADO_LUA,
    [chaveJob(job.id), CHAVE_RECONCILIACAO, chaveConversa(job.conversationId),
      chaveSequenciaConversa(job.conversationId), CHAVE_CONVERSAS_POR_JOB, CHAVE_METRICAS],
    [job.id, telefoneAutorizado, esperado, dedupe, String(canario.createdAt),
      String(canario.expiresAt), String(agora), String(TTL_SEGUNDOS), job.conversationId]);
  return Number(changed) === 1 ? 1 : 0;
}

export async function encerrarCanariosExpiradosSemReenvio(telefoneAutorizado: string): Promise<number> {
  const ids = await redis.zrange<string[]>(CHAVE_RECONCILIACAO, 0, 99);
  let encerrados = 0;
  const agora = Date.now();
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const job = await obterJobWhatsapp(id);
    if (!job || job.kind !== 'text' || job.phone !== telefoneAutorizado ||
      job.state !== 'ambiguous' || job.result?.motivo !== 'lease_expired_without_provider_confirmation' ||
      agora - job.createdAt < 20 * 60_000) continue;
    const token = job.idempotencyKey?.startsWith('canary:')
      ? job.idempotencyKey.slice('canary:'.length) : '';
    if (!/^CBTEST-[A-Z0-9]{4}$/.test(token)) continue;
    const textoEsperado = `Teste técnico do ChefeBot: ${token}\nResponda exatamente: ${token}`;
    if (job.text !== textoEsperado) continue;
    const changed = await redis.eval(ENCERRAR_CANARIO_EXPIRADO_LUA,
      [chaveJob(id), CHAVE_RECONCILIACAO, chaveConversa(job.conversationId),
        chaveSequenciaConversa(job.conversationId), CHAVE_CONVERSAS_POR_JOB, CHAVE_METRICAS],
      [id, job.idempotencyKey!, telefoneAutorizado, textoEsperado, String(agora),
        String(TTL_SEGUNDOS), job.conversationId]);
    if (Number(changed) === 1) encerrados++;
  }
  return encerrados;
}

export async function resumoFilaWhatsapp(): Promise<{ pending: number; inFlight: number; ambiguous: number; unresolved: number }> {
  const [critica, normal, promocional, inFlight, ambiguous, unresolved] = await Promise.all([
    redis.zcard(chaveFila("critica")), redis.zcard(chaveFila("normal")), redis.zcard(chaveFila("promocional")), redis.zcard(CHAVE_LEASES),
    redis.zcard(CHAVE_RECONCILIACAO), redis.zcard(CHAVE_INCONSISTENCIAS),
  ]);
  return { pending: Number(critica) + Number(normal) + Number(promocional), inFlight: Number(inFlight), ambiguous: Number(ambiguous), unresolved: Number(unresolved) };
}

/**
 * Entrega ao histórico apenas mensagens humanas confirmadas. O índice é
 * durável; se o worker cair antes do callback, a próxima execução tenta de
 * novo. A remoção ocorre somente depois de o chamador concluir o registro.
 */
export async function sincronizarHistoricoMensagensHumanas(
  registrar: (job: JobOutboxWhatsapp) => Promise<void>,
  limite = 100,
): Promise<number> {
  const ids = await redis.zrange<string[]>(CHAVE_HISTORICO_HUMANO, 0, Math.max(0, limite - 1));
  let synced = 0;
  for (const id of ids) {
    const job = await obterJobWhatsapp(id);
    if (!job || job.state !== "delivered" || (!job.humanSenderName && !job.history)) {
      // Não deixe referências inválidas ocuparem os primeiros 100 slots para
      // sempre. A quarentena é auditável e não apaga a evidência do jobId.
      await Promise.all([redis.zadd(CHAVE_INCONSISTENCIAS, { score: Date.now(), member: `history:${id}` }), redis.zrem(CHAVE_HISTORICO_HUMANO, id)]);
      continue;
    }
    if (!await reivindicarHistoricoMensagemHumana(id)) continue;
    await registrar(job);
    await confirmarHistoricoMensagemHumana(id);
    synced++;
  }
  return synced;
}

export async function confirmarHistoricoMensagemHumana(jobId: string): Promise<void> {
  await Promise.all([redis.zrem(CHAVE_HISTORICO_HUMANO, jobId), redis.del(chaveClaimHistoricoHumano(jobId))]);
}

/** Evita que o POST síncrono e o worker registrem o mesmo histórico. */
export async function reivindicarHistoricoMensagemHumana(jobId: string): Promise<boolean> {
  return Boolean(await redis.set(chaveClaimHistoricoHumano(jobId), "1", { nx: true, ex: 60 }));
}

let qstash: Client | null | undefined;
let recoveryScheduleDestination: string | null = null;
const QSTASH_RECOVERY_SCHEDULE_ID = "chefebot-whatsapp-outbox-recovery-v1";
const QSTASH_RECOVERY_CRON = "*/5 * * * *";

function baseQstashConfigurada(): string | null {
  const raw = process.env.QSTASH_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Região explicitamente configurada: nunca cair silenciosamente no
    // endpoint europeu quando a instância vinculada é a dos EUA.
    if (url.protocol !== "https:" || url.username || url.password ||
      !["qstash-us-east-1.upstash.io", "qstash-eu-central-1.upstash.io", "qstash.upstash.io"].includes(url.hostname) ||
      url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function clienteQstash(): Client | null {
  if (qstash !== undefined) return qstash;
  const token = process.env.QSTASH_TOKEN?.trim();
  const baseUrl = baseQstashConfigurada();
  qstash = token && baseUrl ? new Client({ token, baseUrl }) : null;
  return qstash;
}

function destinoWorkerWhatsapp(): string {
  return process.env.WHATSAPP_OUTBOX_CALLBACK_URL?.trim()
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/interno/whatsapp-outbox/processar` : "");
}

/** URL canônica incluída na assinatura QStash; nunca derive do Host recebido. */
export function urlWorkerWhatsappAssinada(): string {
  return destinoWorkerWhatsapp();
}

// Uma agenda persistente não deve nascer em Preview. Em produção, VERCEL_URL
// é seguro como fallback; fora dela exigimos a URL explícita configurada.
function destinoRecuperacaoWhatsapp(): string {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return "";
  const configured = process.env.WHATSAPP_OUTBOX_CALLBACK_URL?.trim();
  if (configured) return configured;
  return process.env.VERCEL_ENV === "production" ? destinoWorkerWhatsapp() : "";
}

/** Nomes somente: permite diagnosticar configuração sem revelar segredo algum. */
export function configuracaoOutboxWhatsapp(): { ready: boolean; missing: string[] } {
  const required = ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  if (!baseQstashConfigurada()) missing.push("QSTASH_URL (endpoint HTTPS da região Upstash)");
  if (!destinoRecuperacaoWhatsapp()) missing.push("WHATSAPP_OUTBOX_CALLBACK_URL (ou VERCEL_URL em production)");
  return { ready: missing.length === 0, missing };
}

/**
 * O schedule vive no QStash, independente da frequência permitida pelo plano
 * Vercel. `scheduleId` torna a criação idempotente e atualiza a mesma agenda
 * caso a URL de callback mude. Ele só é solicitado após aceitar uma tarefa.
 */
async function assegurarRecuperacaoPeriodicaWhatsapp(client: Client, destination: string): Promise<boolean> {
  if (recoveryScheduleDestination === destination) return true;
  try {
    await client.schedules.create({
      destination,
      cron: QSTASH_RECOVERY_CRON,
      scheduleId: QSTASH_RECOVERY_SCHEDULE_ID,
      body: "{}",
      headers: { "Content-Type": "application/json" },
      retries: 1,
      flowControl: { key: "chefebot-whatsapp-outbox", parallelism: 1 },
      redact: { body: true },
    });
    recoveryScheduleDestination = destination;
    return true;
  } catch {
    // Não impede a publicação imediata; o job aceito segue no Redis e uma
    // próxima chamada tentará restabelecer a agenda.
    return false;
  }
}

// Melhor esforço: a durabilidade está no Redis; QStash só desperta o worker.
// Não publica sem token/URL e nunca impede que um pedido já aceito prossiga.
export async function agendarDrenoWhatsapp(): Promise<boolean> {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return false;
  const client = clienteQstash();
  const base = destinoWorkerWhatsapp();
  if (!client || !base || !configuracaoOutboxWhatsapp().ready) return false;
  try {
    const recoveryDestination = destinoRecuperacaoWhatsapp();
    if (recoveryDestination) await assegurarRecuperacaoPeriodicaWhatsapp(client, recoveryDestination);
    await client.publishJSON({
      url: base, body: {}, retries: 1,
      // Evita uma rajada de despertares idênticos; a recuperação periódica
      // abaixo continua sendo a garantia para publicação que falhe.
      deduplicationId: `chefebot-whatsapp-outbox-${Math.floor(Date.now() / 60_000)}`,
      flowControl: { key: "chefebot-whatsapp-outbox", parallelism: 1 },
      redact: { body: true },
    });
    return true;
  } catch { return false; }
}
