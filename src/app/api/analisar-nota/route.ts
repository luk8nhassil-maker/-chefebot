import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CATEGORIAS = ['ingredientes', 'embalagens', 'energia', 'funcionarios', 'aluguel', 'marketing', 'manutencao', 'outros']

export async function POST(req: NextRequest) {
  try {
    const { base64, mimeType } = await req.json()

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 }
          },
          {
            type: 'text',
            text: `Analise esta nota fiscal ou cupom fiscal e extraia as informações principais.

Responda APENAS em JSON neste formato exato, sem explicações:
{"descricao": "descrição resumida do que foi comprado", "valor": 99.90, "categoria": "categoria"}

Categorias disponíveis: ${CATEGORIAS.join(', ')}

Regras:
- descricao: máximo 50 caracteres, em português, descrevendo o produto/serviço principal
- valor: número decimal com ponto (ex: 45.90), sem R$
- categoria: escolha a mais adequada da lista acima

Se não conseguir ler, responda: {"descricao": null, "valor": null, "categoria": "outros"}`
          }
        ]
      }]
    })

    const texto = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = texto.replace(/```json|```/g, '').trim()
    const resultado = JSON.parse(clean)

    return NextResponse.json(resultado)
  } catch {
    return NextResponse.json({ descricao: null, valor: null, categoria: 'outros' })
  }
}