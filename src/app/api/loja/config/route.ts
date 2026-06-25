import { redis } from '@/lib/redis'
import { NextResponse } from 'next/server'

type ConfigPizzaria = {
  nomePizzaria?: string
  horaAbertura?: number
  horaFechamento?: number
  tempoEntregaDelivery?: string
  tempoEntregaRetirada?: string
  endereco?: string
  whatsappPizzaria?: string
}

export async function GET() {
  let config: ConfigPizzaria | null = null
  try {
    config = await redis.get<ConfigPizzaria>('config:pizzaria')
  } catch {}

  return NextResponse.json({
    nome: config?.nomePizzaria || 'Chefe da Pizza',
    horaAbertura: config?.horaAbertura ?? 18,
    horaFechamento: config?.horaFechamento ?? 23,
    tempoEntregaDelivery: config?.tempoEntregaDelivery || '40-60 minutos',
    tempoEntregaRetirada: config?.tempoEntregaRetirada || '20-30 minutos',
    endereco: config?.endereco || '',
    telefone: config?.whatsappPizzaria || '',
  })
}
