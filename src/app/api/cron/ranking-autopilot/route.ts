import { NextResponse } from 'next/server'
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from '@/lib/vercelProjeto'
import { consultarSimulacaoAutopilot } from '@/lib/rankingAutopilotReadModel.server'
import { salvarEstadoAutopilot } from '@/lib/rankingAutopilotEstado.server'

export const maxDuration = 30

/**
 * Execução diária do robô em observação.
 * A rota calcula e guarda a decisão, mas não ativa missão, bônus ou mensagem.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'ambiente_nao_producao' })
  }
  if (process.env.VERCEL_PROJECT_ID !== VERCEL_PROJECT_CHEFEBOT_OFICIAL) {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'projeto_nao_oficial' })
  }

  try {
    const tenantId = 'default'
    const simulacao = await consultarSimulacaoAutopilot(tenantId)
    const salvoEm = new Date().toISOString()
    const persistencia = await salvarEstadoAutopilot({
      tenantId,
      salvoEm,
      modoExecucao: 'observacao',
      executado: false,
      decisao: simulacao.decisao,
      janelaAtual: simulacao.janelaAtual,
      janelaAnterior: simulacao.janelaAnterior,
    })
    return NextResponse.json({
      ok: true,
      modo: 'observacao',
      executado: false,
      decisao: simulacao.decisao,
      persistencia,
    })
  } catch (erro) {
    console.error('[ranking-autopilot] falha fechada', { erro: erro instanceof Error ? erro.message : 'erro_inesperado' })
    return NextResponse.json({ ok: false, error: 'falha_simulacao_autopilot' }, { status: 500 })
  }
}

