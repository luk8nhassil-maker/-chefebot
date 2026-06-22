import { redis } from './redis'
import type { MensagemRelevante } from './bot'

export type CicloStatus = 'ativo' | 'fechado' | 'abandonado' | 'cancelado' | 'finalizado'

export interface Ciclo {
  id: string
  phone: string
  startedAt: number
  endedAt?: number
  status: CicloStatus
  motivoInicio: string
  motivoFim?: string
}

const CHAVE = (phone: string) => `conversa_ciclos:${phone}`
const TTL = 7 * 24 * 60 * 60 // 7 dias

// ─── Helpers puros (testáveis sem Redis) ──────────────────────────────────────

function norm(txt: string): string {
  return txt.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const DESISTENCIAS = [
  'deixa pra depois', 'vou ver aqui', 'nao quero mais', 'cancela', 'desisti',
  'mais tarde eu peco', 'depois eu falo', 'nao vou querer', 'obrigado era so isso',
  'obrigado era isso', 'nao preciso mais', 'esquece', 'deixa pra la', 'vou deixar',
  'to sem dinheiro', 'mudei de ideia', 'mudei de opiniao', 'cancelar', 'desistir',
]

const SAUDACOES = [
  'boa noite', 'boa tarde', 'bom dia', 'oi', 'ola', 'hello', 'oii', 'oiii',
  'ei', 'hey', 'iae', 'eai', 'e ai', 'tudo bem', 'tudo bom',
]

export function isDesistencia(texto: string): boolean {
  const n = norm(texto)
  return DESISTENCIAS.some(d => n.includes(d))
}

export function isNovaSaudacao(texto: string): boolean {
  const n = norm(texto)
  return SAUDACOES.some(s => n === s || n.startsWith(s + ' ') || n.endsWith(' ' + s))
}

// Limiares de gap de tempo para presumir novo ciclo
const GAP_BOT_MS = 2 * 60 * 60 * 1000      // 2h durante montagem de pedido
const GAP_MANUAL_MS = 4 * 60 * 60 * 1000   // 4h em atendimento manual
const GAP_ABSOLUTO_MS = 24 * 60 * 60 * 1000 // 24h: sempre novo ciclo

/**
 * Reconstrói o "ciclo atual" a partir de mensagens sem cicloId (dados antigos).
 * Varre do fim para o início e para quando encontra ponto de corte:
 * - Gap de tempo acima do limiar
 * - Mensagem de desistência do cliente
 * - Saudação após gap
 */
export function recortarMensagensRecentes(
  mensagens: MensagemRelevante[],
  agora: number = Date.now(),
): MensagemRelevante[] {
  if (mensagens.length === 0) return []

  let corte = 0
  for (let i = mensagens.length - 1; i > 0; i--) {
    const atual = mensagens[i]
    const anterior = mensagens[i - 1]
    const tsAtual = atual.ts ?? agora
    const tsAnterior = anterior.ts ?? agora
    const gap = tsAtual - tsAnterior

    if (gap > GAP_ABSOLUTO_MS) { corte = i; break }
    if (gap > GAP_MANUAL_MS) { corte = i; break }
    if (anterior.autor === 'cliente' && isDesistencia(anterior.texto)) { corte = i; break }
    if (atual.autor === 'cliente' && isNovaSaudacao(atual.texto) && gap > GAP_BOT_MS) {
      corte = i; break
    }
  }

  return mensagens.slice(corte)
}

/**
 * Filtra mensagens do ciclo ativo.
 * Se cicloId for null ou nenhuma mensagem tiver cicloId, usa recortarMensagensRecentes.
 */
export function filtrarMensagensDoCiclo(
  mensagens: MensagemRelevante[],
  cicloId: string | null,
): MensagemRelevante[] {
  if (cicloId) {
    const filtradas = mensagens.filter(m => (m as any).cicloId === cicloId)
    if (filtradas.length > 0) return filtradas
  }
  // Fallback: recorte por tempo / conteúdo (dados antigos sem cicloId)
  return recortarMensagensRecentes(mensagens)
}

// ─── Operações Redis (best-effort, nunca propagam erro) ───────────────────────

export async function obterCiclos(phone: string): Promise<Ciclo[]> {
  try { return (await redis.get<Ciclo[]>(CHAVE(phone))) ?? [] } catch { return [] }
}

export async function obterCicloAtivo(phone: string): Promise<Ciclo | null> {
  try {
    const ciclos = await obterCiclos(phone)
    return ciclos.find(c => c.status === 'ativo') ?? null
  } catch { return null }
}

export async function abrirCiclo(phone: string, motivoInicio: string): Promise<Ciclo> {
  const now = Date.now()
  const novoCiclo: Ciclo = { id: now.toString(), phone, startedAt: now, status: 'ativo', motivoInicio }
  try {
    const ciclos = await obterCiclos(phone)
    const fechados = ciclos.map(c =>
      c.status === 'ativo' ? { ...c, status: 'abandonado' as CicloStatus, endedAt: now, motivoFim: 'novo ciclo aberto' } : c
    )
    await redis.set(CHAVE(phone), [...fechados, novoCiclo], { ex: TTL })
  } catch {}
  return novoCiclo
}

export async function fecharCiclo(
  phone: string,
  status: Exclude<CicloStatus, 'ativo'>,
  motivoFim: string,
): Promise<void> {
  try {
    const ciclos = await obterCiclos(phone)
    const updated = ciclos.map(c =>
      c.status === 'ativo' ? { ...c, status, endedAt: Date.now(), motivoFim } : c
    )
    await redis.set(CHAVE(phone), updated, { ex: TTL })
  } catch {}
}
