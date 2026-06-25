import { redis } from '@/lib/redis'
import Link from 'next/link'

type ConfigRedis = {
  nomePizzaria?: string
  horaAbertura?: number
  horaFechamento?: number
  tempoEntregaDelivery?: string
  endereco?: string
  whatsappPizzaria?: string
}

function isOpen(horaAbertura: number, horaFechamento: number): boolean {
  const hour = new Date().getHours()
  if (horaFechamento > horaAbertura) return hour >= horaAbertura && hour < horaFechamento
  return hour >= horaAbertura || hour < horaFechamento
}

export default async function LojaPage() {
  let config: ConfigRedis | null = null
  try {
    config = await redis.get<ConfigRedis>('config:pizzaria')
  } catch {}

  const nome = config?.nomePizzaria || 'Chefe da Pizza'
  const horaAbertura = config?.horaAbertura ?? 18
  const horaFechamento = config?.horaFechamento ?? 23
  const tempoDelivery = config?.tempoEntregaDelivery || '40-60 minutos'
  const endereco = config?.endereco || ''
  const telefone = config?.whatsappPizzaria || ''
  const aberto = isOpen(horaAbertura, horaFechamento)
  const horarioLabel = `${horaAbertura}h – ${horaFechamento}h`

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header hero */}
      <div className="bg-red-600 text-white px-6 pt-12 pb-8 flex flex-col items-center text-center">
        <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-5xl mb-4 shadow-lg">
          🍕
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{nome}</h1>
        <span
          className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${
            aberto ? 'bg-green-500/30 text-green-100' : 'bg-gray-600/40 text-gray-200'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${aberto ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
          {aberto ? 'Aberto agora' : 'Fechado'}
        </span>
      </div>

      {/* Info cards */}
      <div className="flex-1 px-4 pt-6 space-y-3">
        <div className="bg-gray-50 rounded-2xl p-4 flex items-start gap-4">
          <span className="text-2xl">🕐</span>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Horário</p>
            <p className="text-gray-800 font-medium mt-0.5">{horarioLabel}</p>
          </div>
        </div>

        {endereco && (
          <div className="bg-gray-50 rounded-2xl p-4 flex items-start gap-4">
            <span className="text-2xl">📍</span>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Endereço</p>
              <p className="text-gray-800 font-medium mt-0.5">{endereco}</p>
            </div>
          </div>
        )}

        {telefone && (
          <div className="bg-gray-50 rounded-2xl p-4 flex items-start gap-4">
            <span className="text-2xl">📞</span>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Contato</p>
              <p className="text-gray-800 font-medium mt-0.5">{telefone}</p>
            </div>
          </div>
        )}

        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-4">
          <span className="text-2xl">🛵</span>
          <div>
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Delivery</p>
            <p className="text-gray-800 font-medium mt-0.5">Taxa por bairro · ~{tempoDelivery}</p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="p-6 pb-8">
        <Link
          href="/loja/cardapio"
          className="block w-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-center py-4 rounded-2xl font-bold text-lg shadow-lg shadow-red-200 transition-colors"
        >
          🍕 Ver Cardápio
        </Link>
      </div>
    </div>
  )
}
