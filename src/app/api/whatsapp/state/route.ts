import { NextRequest, NextResponse } from 'next/server'
import { salvarStatusConexao } from '@/lib/conexaoWhatsapp'
import { verifyToken } from '@/lib/auth'
import { obterConfigEvolution } from '@/lib/evolutionApi'
import { verificarInstancia } from '@/lib/evolutionConnect'
import { registrarResultadoVerificacao, acaoRecomendada } from '@/lib/whatsappProviderState'

async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return { status: 401 }
  const payload = await verifyToken(token)
  if (!payload) return { status: 401 }
  if (!['admin', 'dev'].includes(payload.role as string)) return { status: 403 }
  return { status: 200 }
}

// Consumido só por /admin e /setup (telas de admin/dev) — nenhum outro
// papel precisa consultar o estado da conexão do WhatsApp.
export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (auth.status === 401) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  if (auth.status === 403) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  const config = obterConfigEvolution()
  if (!config) {
    await registrarResultadoVerificacao('provider_not_configured', { etapaFalha: 'config' })
    return NextResponse.json({
      estado: 'provider_not_configured',
      error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados.',
      acaoRecomendada: acaoRecomendada('provider_not_configured'),
    })
  }

  const resultado = await verificarInstancia(config)
  const persistido = await registrarResultadoVerificacao(resultado.estado, { etapaFalha: resultado.ok ? null : resultado.step })

  if (resultado.ok && resultado.estado === 'connected') {
    await salvarStatusConexao('connected')
  } else if (resultado.ok && resultado.estado === 'connecting') {
    await salvarStatusConexao('connecting')
  } else {
    await salvarStatusConexao('disconnected')
  }

  return NextResponse.json({
    // Compatibilidade com consumidores antigos que leem instance.state
    // diretamente (ex.: /setup) — nunca remover sem migrar os dois juntos.
    instance: { state: resultado.ok && resultado.estado === 'connected' ? 'open' : resultado.ok && resultado.estado === 'connecting' ? 'connecting' : 'close' },
    estado: resultado.estado,
    ...(resultado.ok ? {} : { error: resultado.error }),
    acaoRecomendada: acaoRecomendada(resultado.estado),
    ultimaVerificacao: persistido.ultimaVerificacao,
    ultimaConexaoValida: persistido.ultimaConexaoValida,
    ultimaMensagemRecebida: persistido.ultimaMensagemRecebida,
    falhasConsecutivas: persistido.falhasConsecutivas,
  })
}
