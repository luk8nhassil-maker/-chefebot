import { NextResponse } from 'next/server'
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from '@/lib/vercelProjeto'
import { consultarSimulacaoAutopilot } from '@/lib/rankingAutopilotReadModel.server'
import { salvarEstadoAutopilot } from '@/lib/rankingAutopilotEstado.server'
import { criarComandoAutopilot } from '@/lib/rankingAutopilotControle'
import { aplicarComandoAutopilot, reverterAplicacaoAutopilot, type ResultadoExecucaoAutopilot } from '@/lib/rankingAutopilotExecucao.server'

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
    const comando = criarComandoAutopilot(simulacao.plano)
    let execucao: ResultadoExecucaoAutopilot
    if (comando) {
      execucao = await aplicarComandoAutopilot(tenantId, comando)
    } else if (
      simulacao.decisao.missao === 'nenhuma'
      && simulacao.sinaisControle.fonteConfiavel
      && simulacao.plano.percentual >= 60
    ) {
      // Só revoga o que o próprio robô deixou ativo e quando há dados
      // suficientes para concluir que a ação não faz mais sentido.
      execucao = await reverterAplicacaoAutopilot(tenantId)
    } else {
      execucao = { executado: false, status: 'sem_comando', motivo: simulacao.plano.motivo }
    }
    const salvoEm = new Date().toISOString()
    const persistencia = await salvarEstadoAutopilot({
      tenantId,
      salvoEm,
      modoExecucao: execucao.executado ? 'autonomo' : 'observacao',
      executado: execucao.executado,
      decisao: simulacao.decisao,
      plano: simulacao.plano,
      execucao,
      janelaAtual: simulacao.janelaAtual,
      janelaAnterior: simulacao.janelaAnterior,
    })
    return NextResponse.json({
      ok: true,
      modo: execucao.executado ? 'autonomo' : 'observacao',
      executado: execucao.executado,
      decisao: simulacao.decisao,
      plano: simulacao.plano,
      execucao,
      persistencia,
    })
  } catch (erro) {
    console.error('[ranking-autopilot] falha fechada', { erro: erro instanceof Error ? erro.message : 'erro_inesperado' })
    return NextResponse.json({ ok: false, error: 'falha_simulacao_autopilot' }, { status: 500 })
  }
}

