import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import type { Tenant } from '@/types/loja'

async function getTenant(): Promise<Tenant | null> {
  const { data } = await supabase.from('tenants').select('*').limit(1).single()
  return data
}

function isOpen(horario: string): boolean {
  const now = new Date()
  const hour = now.getHours()
  return hour >= 18 || hour < 1
}

export default async function LojaPage() {
  const tenant = await getTenant()

  if (!tenant) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
        <div className="text-6xl mb-4">🍕</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Chefe da Pizza</h1>
        <p className="text-gray-500 mb-6">Configuração necessária. Execute o SQL de setup no Supabase.</p>
        <Link
          href="/loja/setup"
          className="bg-red-600 text-white px-6 py-3 rounded-xl font-semibold"
        >
          Ver instruções de setup
        </Link>
      </div>
    )
  }

  const aberto = isOpen(tenant.horario)

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header hero */}
      <div className="bg-red-600 text-white px-6 pt-12 pb-8 flex flex-col items-center text-center">
        <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-5xl mb-4 shadow-lg">
          🍕
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{tenant.nome}</h1>
        <span
          className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${
            aberto ? 'bg-green-500/30 text-green-100' : 'bg-gray-600/40 text-gray-200'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${aberto ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}
          />
          {aberto ? 'Aberto agora' : 'Fechado'}
        </span>
      </div>

      {/* Info cards */}
      <div className="flex-1 px-4 pt-6 space-y-3">
        <div className="bg-gray-50 rounded-2xl p-4 flex items-start gap-4">
          <span className="text-2xl">🕐</span>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Horário</p>
            <p className="text-gray-800 font-medium mt-0.5">{tenant.horario}</p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 flex items-start gap-4">
          <span className="text-2xl">📍</span>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Endereço</p>
            <p className="text-gray-800 font-medium mt-0.5">{tenant.endereco}</p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 flex items-start gap-4">
          <span className="text-2xl">📞</span>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Telefone</p>
            <p className="text-gray-800 font-medium mt-0.5">{tenant.telefone}</p>
          </div>
        </div>

        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-4">
          <span className="text-2xl">🛵</span>
          <div>
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Delivery</p>
            <p className="text-gray-800 font-medium mt-0.5">Taxa de entrega a combinar · ~40 min</p>
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
