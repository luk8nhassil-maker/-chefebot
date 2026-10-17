import { redis } from './redis'
import type { AutorMensagem, MensagemRelevante } from './bot'

export const CONVERSAS_ZSET = 'conversas:index'
// Histórico permanente: a conversa NUNCA deve expirar nem ser truncada de forma
// destrutiva durante o atendimento. conversa_full/conversa_meta são gravados SEM
// TTL (permanentes). Mantemos um teto de segurança alto só para evitar um único
// valor Redis patológico; 1000 mensagens cobre conversas reais com folga.
// (Para histórico verdadeiramente ilimitado, migrar conversa_full para uma LIST
//  Redis com RPUSH/LRANGE é o próximo passo recomendado — fora do escopo deste fix.)
export const MAX_FULL_MSGS = 1000

export type ConversaMeta = {
  phone: string
  nome: string
  ultimaMensagem: string
  ultimaTs: number
  mensagensCount: number
}

const TTL_DEDUP_OUTBOX_SEGUNDOS = 7 * 24 * 60 * 60;
const MAX_MENSAGENS_CURTAS = 8;

const REGISTRAR_OUTBOX_IDEMPOTENTE_LUA = `
if redis.call('GET', KEYS[1]) then return 0 end
local author = ARGV[1]
local text = ARGV[2]
local ts = tonumber(ARGV[3])
local phone = ARGV[4]
redis.call('SET', KEYS[1], '1', 'EX', ARGV[5])
local short = redis.call('GET', KEYS[2])
local shortItems = short and cjson.decode(short) or {}
table.insert(shortItems, { autor = author, texto = text, ts = ts })
while #shortItems > tonumber(ARGV[6]) do table.remove(shortItems, 1) end
redis.call('SET', KEYS[2], cjson.encode(shortItems), 'EX', ARGV[7])
redis.call('ZADD', KEYS[3], ts, phone)
local full = redis.call('GET', KEYS[4])
local fullItems = full and cjson.decode(full) or {}
table.insert(fullItems, { autor = author, texto = text, ts = ts })
while #fullItems > tonumber(ARGV[8]) do table.remove(fullItems, 1) end
redis.call('SET', KEYS[4], cjson.encode(fullItems))
local metaRaw = redis.call('GET', KEYS[5])
local meta = metaRaw and cjson.decode(metaRaw) or { phone = phone, nome = ARGV[9], mensagensCount = 0 }
meta.ultimaMensagem = string.sub(text, 1, 200)
meta.ultimaTs = ts
meta.mensagensCount = #fullItems
if not meta.nome or meta.nome == '' then meta.nome = ARGV[9] end
redis.call('SET', KEYS[5], cjson.encode(meta))
return 1
`;

/**
 * Registro atômico para efeitos concluídos da outbox. Dedupe e os dois
 * históricos são persistidos no mesmo script; depois de uma queda, repetir
 * o job não duplica e uma falha do script não consome sua referência.
 */
export async function atualizarHistoricoIdempotenteOutbox(
  phone: string,
  autor: AutorMensagem,
  texto: string,
  idempotencyKey: string,
  ts = Date.now(),
): Promise<boolean> {
  if (!phone || !texto || !idempotencyKey) return false;
  const text = texto.slice(0, 400);
  // O nome é apenas metadado de apresentação. Obtê-lo antes do script não
  // interfere na atomicidade do dedupe nem do histórico, e preserva o mesmo
  // fallback da gravação síncrona para conversas ainda sem meta.
  const existing = await redis.get<ConversaMeta>(`conversa_meta:${phone}`);
  let nome = existing?.nome;
  if (!nome) {
    const session = await redis.get<{ customerName?: string }>(`session:${phone}`);
    nome = session?.customerName || phone;
  }
  const result = await redis.eval(REGISTRAR_OUTBOX_IDEMPOTENTE_LUA,
    [`conversa:outbox-history:${idempotencyKey}`, `conversa:${phone}`, CONVERSAS_ZSET, `conversa_full:${phone}`, `conversa_meta:${phone}`],
    [autor, text, String(ts), phone, String(TTL_DEDUP_OUTBOX_SEGUNDOS), String(MAX_MENSAGENS_CURTAS), "1800", String(MAX_FULL_MSGS), nome]);
  return Number(result) === 1;
}

export async function atualizarHistorico(
  phone: string,
  autor: AutorMensagem,
  texto: string,
  ts: number,
  nomeCliente?: string,
): Promise<void> {
  if (!phone || !texto) return
  try {
    await redis.zadd(CONVERSAS_ZSET, { score: ts, member: phone })

    const metaKey = `conversa_meta:${phone}`
    const existing = await redis.get<ConversaMeta>(metaKey)

    let nome = nomeCliente || existing?.nome
    if (!nome) {
      const session = await redis.get<{ customerName?: string }>(`session:${phone}`)
      nome = session?.customerName || phone
    }

    const fullKey = `conversa_full:${phone}`
    const full = (await redis.get<MensagemRelevante[]>(fullKey)) || []
    full.push({ autor, texto: texto.slice(0, 400), ts })
    const trimmed = full.slice(-MAX_FULL_MSGS)
    // Permanente: sem TTL — o histórico não pode expirar durante/depois do atendimento.
    await redis.set(fullKey, trimmed)

    const meta: ConversaMeta = {
      phone,
      nome,
      ultimaMensagem: texto.slice(0, 200),
      ultimaTs: ts,
      mensagensCount: trimmed.length,
    }
    // Permanente: sem TTL.
    await redis.set(metaKey, meta)
  } catch {
    // best-effort; never propagate error
  }
}
