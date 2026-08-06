import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getMENUDinamico } from '@/lib/menu.server'
import { verifyToken } from '@/lib/auth'
import { registrarAuditoriaCardapio } from '@/lib/auditoriaCardapio'

// Esgotados precisam refletir em tempo real no cardapio publico: nunca cachear.
export const dynamic = 'force-dynamic'

const ROLES_PERMITIDAS = ['admin', 'atendente', 'dev']

type EsgMetadata = Record<string, { desde: string; ultimaRevisao?: string }>

function hoje(): string {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

type ConfigHorario = { horaAbertura: number; horaFechamento: number }

const HORARIO_PADRAO: ConfigHorario = { horaAbertura: 18, horaFechamento: 23 }

// Mesma regra usada pelo bot do WhatsApp (estaAberto em src/app/api/whatsapp/route.ts):
// horário sempre calculado em America/Sao_Paulo, nunca no fuso do servidor/navegador.
function estaAbertoAgora(config: ConfigHorario): boolean {
  const agora = new Date()
  const brasilia = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const hora = brasilia.getHours()
  return hora >= config.horaAbertura && hora < config.horaFechamento
}

// ---------------------------------------------------------------------------
// Validação estrutural do payload de POST /api/cardapio
// ---------------------------------------------------------------------------
//
// Antes desta validação, a rota fazia `redis.set('cardapio', body)` com
// QUALQUER JSON que uma sessão admin/atendente/dev enviasse — sem checar
// nome vazio, preço inválido, seção desconhecida ou item duplicado. Foi
// assim que dois registros idênticos {"name":"Teste","price":1} entraram em
// produção (via um clique duplo no "+ Adicionar bebida" do admin) e
// corromperam a key do React no seletor do Novo pedido.
//
// A validação é ESTRUTURAL — nunca por nome. Um item chamado "Teste" com
// preço válido e sem duplicar outro é aceito normalmente; um item com nome
// vazio ou preço inválido é rejeitado mesmo que se chame "Pizza Calabresa".

const SECOES_TEXTO = ['saltyFlavors', 'sweetFlavors', 'calzoneFlavors', 'miniPizzaFlavors', 'payments'] as const
const SECOES_ITEM_PRECO = ['bebidas', 'sucos'] as const
const CHAVES_CONHECIDAS = new Set([
  'sizes', 'borders', 'neighborhoods', 'lanches',
  ...SECOES_TEXTO, ...SECOES_ITEM_PRECO,
])

const MAX_ITENS_POR_SECAO = 500
const MAX_TAMANHO_TEXTO = 200
const MAX_PRECO = 100000

function nomeValido(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TAMANHO_TEXTO
}

function precoValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_PRECO
}

function precoNaoNegativoValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRECO
}

/** Resultado da validação: `ok: true` com o corpo já tipado, ou `ok: false` com o motivo (nunca detalhe interno). */
type ResultadoValidacao =
  | { ok: true; cardapio: Record<string, unknown> }
  | { ok: false; erro: string }

function validarSecaoTexto(nomeSecao: string, valor: unknown): string | null {
  if (!Array.isArray(valor)) return `${nomeSecao}: precisa ser uma lista`
  if (valor.length > MAX_ITENS_POR_SECAO) return `${nomeSecao}: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (!nomeValido(item)) return `${nomeSecao}: contém um valor inválido (texto vazio ou grande demais)`
    if (vistos.has(item)) return `${nomeSecao}: item duplicado ("${item}")`
    vistos.add(item)
  }
  return null
}

function validarSecaoItemPreco(nomeSecao: string, valor: unknown): string | null {
  if (!Array.isArray(valor)) return `${nomeSecao}: precisa ser uma lista`
  if (valor.length > MAX_ITENS_POR_SECAO) return `${nomeSecao}: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return `${nomeSecao}: item inválido`
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.name)) return `${nomeSecao}: nome vazio ou inválido`
    if (!precoValido(obj.price)) return `${nomeSecao}: preço inválido em "${String(obj.name)}"`
    const chave = `${(obj.name as string).trim()}::${obj.price}`
    if (vistos.has(chave)) return `${nomeSecao}: item duplicado ("${obj.name}", mesmo preço)`
    vistos.add(chave)
  }
  return null
}

function validarSizes(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'sizes: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `sizes: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'sizes: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.code)) return 'sizes: código vazio ou inválido'
    if (!precoValido(obj.price)) return `sizes: preço inválido em "${String(obj.code)}"`
    if (obj.label !== undefined && !nomeValido(obj.label)) return `sizes: rótulo inválido em "${String(obj.code)}"`
    if (vistos.has(obj.code as string)) return `sizes: código duplicado ("${obj.code}")`
    vistos.add(obj.code as string)
  }
  return null
}

function validarLanches(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'lanches: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `lanches: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'lanches: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.name)) return 'lanches: nome vazio ou inválido'
    // price 0 é um sentinela legítimo aqui: "o preço real vem de `sizes`".
    if (!precoNaoNegativoValido(obj.price)) return `lanches: preço inválido em "${String(obj.name)}"`
    if (obj.sizes !== undefined) {
      if (!Array.isArray(obj.sizes)) return `lanches: tamanhos inválidos em "${String(obj.name)}"`
      for (const s of obj.sizes) {
        if (typeof s !== 'object' || s === null) return `lanches: tamanho inválido em "${String(obj.name)}"`
        const so = s as Record<string, unknown>
        if (!nomeValido(so.code) || !precoValido(so.price)) return `lanches: tamanho inválido em "${String(obj.name)}"`
      }
    }
    const chave = `${(obj.name as string).trim()}::${obj.price}`
    if (vistos.has(chave)) return `lanches: item duplicado ("${obj.name}", mesmo preço)`
    vistos.add(chave)
  }
  return null
}

function validarBorders(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'borders: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `borders: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'borders: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.label)) return 'borders: rótulo vazio ou inválido'
    if (!precoNaoNegativoValido(obj.priceSmall) || !precoNaoNegativoValido(obj.priceLarge)) {
      return `borders: preço inválido em "${String(obj.label)}"`
    }
  }
  return null
}

function validarNeighborhoods(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'neighborhoods: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `neighborhoods: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'neighborhoods: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.name)) return 'neighborhoods: nome vazio ou inválido'
    if (!precoNaoNegativoValido(obj.fee)) return `neighborhoods: taxa inválida em "${String(obj.name)}"`
  }
  return null
}

/**
 * Valida a ESTRUTURA do catálogo antes de persistir — nunca o nome dos
 * itens. Devolve o primeiro problema encontrado, pronto para a resposta de
 * erro (texto sem detalhe interno de infraestrutura).
 */
export function validarCardapio(body: unknown): ResultadoValidacao {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, erro: 'Corpo inválido' }
  }
  const obj = body as Record<string, unknown>

  for (const chave of Object.keys(obj)) {
    if (!CHAVES_CONHECIDAS.has(chave)) return { ok: false, erro: `Campo desconhecido: ${chave}` }
  }

  if (obj.sizes !== undefined) {
    const erro = validarSizes(obj.sizes)
    if (erro) return { ok: false, erro }
  }
  if (obj.lanches !== undefined) {
    const erro = validarLanches(obj.lanches)
    if (erro) return { ok: false, erro }
  }
  if (obj.borders !== undefined) {
    const erro = validarBorders(obj.borders)
    if (erro) return { ok: false, erro }
  }
  if (obj.neighborhoods !== undefined) {
    const erro = validarNeighborhoods(obj.neighborhoods)
    if (erro) return { ok: false, erro }
  }
  for (const secao of SECOES_ITEM_PRECO) {
    if (obj[secao] !== undefined) {
      const erro = validarSecaoItemPreco(secao, obj[secao])
      if (erro) return { ok: false, erro }
    }
  }
  for (const secao of SECOES_TEXTO) {
    if (obj[secao] !== undefined) {
      const erro = validarSecaoTexto(secao, obj[secao])
      if (erro) return { ok: false, erro }
    }
  }

  return { ok: true, cardapio: obj }
}

export async function GET() {
  try {
    const menu = await getMENUDinamico()
    const esgotados = (await redis.get<string[]>('esgotados')) || []
    const esgotadosMetadata = (await redis.get<EsgMetadata>('esgotadosMetadata')) || {}
    const config = (await redis.get<ConfigHorario>('config:pizzaria')) || HORARIO_PADRAO
    const horario = {
      horaAbertura: config.horaAbertura,
      horaFechamento: config.horaFechamento,
      aberto: estaAbertoAgora(config),
    }
    return NextResponse.json({ ...menu, esgotados, esgotadosMetadata, horario })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Cardápio temporariamente indisponível' },
      { status: 503 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    const payload = token ? await verifyToken(token) : null
    if (!payload || !ROLES_PERMITIDAS.includes(payload.role)) {
      return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
    }

    const body = await req.json()
    const resultado = validarCardapio(body)
    if (!resultado.ok) {
      return NextResponse.json({ ok: false, error: resultado.erro }, { status: 400 })
    }

    const cardapioAnterior = await getMENUDinamico()
    await redis.set('cardapio', resultado.cardapio)
    await registrarAuditoriaCardapio(payload.username, cardapioAnterior, resultado.cardapio)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    const payload = token ? await verifyToken(token) : null
    if (!payload || !ROLES_PERMITIDAS.includes(payload.role)) {
      return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
    }

    const { nome, esgotado, revisaoHoje } = await req.json()
    if (!nome) return NextResponse.json({ ok: false, error: 'nome obrigatorio' }, { status: 400 })

    const metadata = (await redis.get<EsgMetadata>('esgotadosMetadata')) || {}

    if (revisaoHoje) {
      if (metadata[nome]) {
        metadata[nome] = { ...metadata[nome], ultimaRevisao: hoje() }
        await redis.set('esgotadosMetadata', metadata)
      }
      return NextResponse.json({ ok: true, esgotadosMetadata: metadata })
    }

    const lista = (await redis.get<string[]>('esgotados')) || []
    let nova: string[]
    if (esgotado) {
      nova = lista.includes(nome) ? lista : [...lista, nome]
      if (!metadata[nome]) {
        metadata[nome] = { desde: hoje(), ultimaRevisao: hoje() }
      }
    } else {
      nova = lista.filter((n: string) => n !== nome)
      delete metadata[nome]
    }
    await redis.set('esgotados', nova)
    await redis.set('esgotadosMetadata', metadata)
    return NextResponse.json({ ok: true, esgotados: nova, esgotadosMetadata: metadata })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
