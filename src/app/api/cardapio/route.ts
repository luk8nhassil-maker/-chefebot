import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getMENUDinamico } from '@/lib/menu.server'
import { buildPizzaCatalog } from '@/lib/catalog/pizzas'
import { buildSimpleCatalog } from '@/lib/catalog/simpleProducts'
import { verifyToken } from '@/lib/auth'
import { lerSessaoSalao } from '@/lib/salaoAuth'
import { registrarAuditoriaCardapio } from '@/lib/auditoriaCardapio'
import {
  obterEsgotadosEfetivos,
  obterEsgotadosLegado,
  obterEsgotadosMetadataEfetiva,
  obterEstoqueItens,
  definirDisponibilidade,
  marcarRevisaoHoje,
} from '@/lib/estoque'

// Esgotados precisam refletir em tempo real no cardapio publico: nunca cachear.
export const dynamic = 'force-dynamic'

const ROLES_PERMITIDAS = ['admin', 'atendente', 'dev']

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
    // flavorsMode (correção da regra comercial do Calzone): configuração
    // explícita de onde vêm os sabores deste produto — "pizza" (reaproveita
    // a Pizza) ou "own" (lista própria via flavorsKey). Só os dois valores
    // oficiais são aceitos aqui; o comportamento quando o campo está AUSENTE
    // (compatibilidade com config persistida antes deste campo existir) não
    // é sempre "pizza" — ver `resolverFlavorsModeEfetivo` em
    // @/lib/pedidoAppItens (fonte única, usada em runtime, não nesta
    // validação estrutural de escrita).
    if (obj.flavorsMode !== undefined && obj.flavorsMode !== 'pizza' && obj.flavorsMode !== 'own') {
      return `lanches: flavorsMode inválido em "${String(obj.name)}"`
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

export async function GET(req?: NextRequest) {
  try {
    const menu = await getMENUDinamico()
    const [esgotados, esgotadosLegado, estoqueItens] = await Promise.all([
      obterEsgotadosEfetivos(menu),
      obterEsgotadosLegado(),
      obterEstoqueItens(),
    ])
    const esgotadosIds = Object.values(estoqueItens).filter(item => item.esgotado).map(item => item.id)
    const esgotadosMetadata = await obterEsgotadosMetadataEfetiva()
    const config = (await redis.get<ConfigHorario>('config:pizzaria')) || HORARIO_PADRAO
    const horario = {
      horaAbertura: config.horaAbertura,
      horaFechamento: config.horaFechamento,
      aberto: estaAbertoAgora(config),
    }
    // O catálogo exclusivo do Salão só é entregue quando DUAS condições são
    // verdadeiras: a UI pediu explicitamente `?scope=salao` E o cookie do
    // Salão foi validado no servidor. Sem qualquer uma delas o resultado é
    // público. Assim, adicionar o parâmetro manualmente no link do cliente
    // nunca revela os produtos/preços exclusivos.
    const solicitouSalao = req?.nextUrl?.searchParams.get('scope') === 'salao'
    const sessaoSalao = solicitouSalao ? await lerSessaoSalao(req) : null
    const catalogScope = solicitouSalao && sessaoSalao ? 'salao' : 'public'

    // Catálogo oficial de pizzas com IDs estáveis (Fase 2) — aditivo, ninguém
    // ainda consome esta chave; a UI do cardápio continua 100% em name/detail
    // (ver docs de entrega da Fase 2 sobre por que a interface não foi
    // religada nesta mesma etapa). Serve pra religar a UI depois sem precisar
    // reconstruir o catálogo em outro lugar.
    const pizzaCatalog = buildPizzaCatalog(menu, esgotadosLegado, esgotadosIds)
    // Catálogo oficial dos demais produtos configuráveis, com IDs estáveis e
    // disponibilidade em tempo real (Fase 6). O escopo público continua como
    // default; somente uma sessão do Salão autenticada recebe a extensão
    // comercial de sucos Copo/Jarra.
    const catalog = buildSimpleCatalog(menu, esgotadosLegado, esgotadosIds, catalogScope)
    return NextResponse.json({ ...menu, esgotados, esgotadosIds, esgotadosMetadata, horario, pizzaCatalog, catalog })
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

    const { id, nome, esgotado, revisaoHoje } = await req.json()
    if (!nome) return NextResponse.json({ ok: false, error: 'nome obrigatorio' }, { status: 400 })

    if (revisaoHoje) {
      const metadata = await marcarRevisaoHoje(nome)
      return NextResponse.json({ ok: true, esgotadosMetadata: metadata })
    }

    const menu = await getMENUDinamico()
    const resultado = await definirDisponibilidade({ menu, id, nome, esgotado })
    return NextResponse.json({ ok: true, ...resultado })
  } catch (error) {
    if (error instanceof Error && error.message === 'ID de catálogo inválido') {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
