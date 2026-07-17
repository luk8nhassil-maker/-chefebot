import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { autenticarRequisicao, exigirRole } from '@/lib/apiAuth'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Único call site em todo o repositório: src/app/contador/page.tsx (aba
// "Assistente"). Sem esta checagem, qualquer visitante que descobrisse este
// endpoint consumiria o orçamento da API Anthropic do projeto com prompts
// arbitrários — não usado pelo bot/WhatsApp/pedidos, então o bloqueio é
// seguro e não afeta nenhum outro fluxo.
const ROLES_PERMITIDAS: Parameters<typeof exigirRole>[1] = ['admin', 'dev', 'contador']

export async function POST(req: NextRequest) {
  const negado = exigirRole(await autenticarRequisicao(req), ROLES_PERMITIDAS)
  if (negado) return negado
  try {
    const { system, messages } = await req.json()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages,
    })
    return NextResponse.json(response)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}