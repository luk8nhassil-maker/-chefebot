import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getMENUDinamico } from '@/lib/menu.server'
import { buildPizzaCatalog } from '@/lib/catalog/pizzas'
import { buildSimpleCatalog } from '@/lib/catalog/simpleProducts'
import { verifyToken } from '@/lib/auth'
import { registrarAuditoriaCardapio } from '@/lib/auditoriaCardapio'
import { validarCardapio } from '@/lib/cardapioValidacao'
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

export async function GET() {
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
    // Catálogo oficial de pizzas com IDs estáveis (Fase 2), aditivo.
    const pizzaCatalog = buildPizzaCatalog(menu, esgotadosLegado, esgotadosIds)
    // Catálogo oficial dos demais produtos configuráveis, também aditivo.
    const catalog = buildSimpleCatalog(menu, esgotadosLegado, esgotadosIds)
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
