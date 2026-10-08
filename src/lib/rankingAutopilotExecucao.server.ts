import 'server-only'

import { redis } from './redis'
import {
  CONFIG_GAMIFICACAO_PADRAO,
  obterConfigGamificacao,
  salvarConfigGamificacao,
  type ConfigGamificacao,
} from './rankingGamificacaoConfig'
import type { ComandoAutopilot, PatchAutopilot } from './rankingAutopilotControle'

const TTL_COMANDO_SEGUNDOS = 8 * 24 * 60 * 60
const TTL_CONTROLE_SEGUNDOS = 45 * 24 * 60 * 60

type EstadoAplicacaoAutopilot = {
  tenantId: string
  salvoEm: string
  aplicado: PatchAutopilot
  antes: PatchAutopilot
}

export type ResultadoExecucaoAutopilot =
  | { executado: true; status: 'aplicado' | 'ja_aplicado'; comandoId: string; campos: string[] }
  | { executado: false; status: 'sem_comando' | 'duplicado' | 'conflito_manual'; motivo: string }

function chaveComando(tenantId: string, comandoId: string): string {
  return `ranking:autopilot:comando:${tenantId}:${comandoId}`
}

function chaveControle(tenantId: string): string {
  return `ranking:autopilot:controle:${tenantId}`
}

function valoresIguais(a: unknown, b: unknown): boolean {
  return a === b
}

function camposPatch(patch: PatchAutopilot): (keyof PatchAutopilot)[] {
  return Object.keys(patch) as (keyof PatchAutopilot)[]
}

/**
 * Aplica somente a missão escolhida pelo motor. A marca diária impede dupla
 * execução e a comparação com o padrão impede que o robô sobrescreva uma
 * escolha manual já existente.
 */
export async function aplicarComandoAutopilot(
  tenantId: string,
  comando: ComandoAutopilot | null,
): Promise<ResultadoExecucaoAutopilot> {
  if (!comando) return { executado: false, status: 'sem_comando', motivo: 'Nenhuma ação segura foi escolhida.' }

  const reservado = await redis.set(
    chaveComando(tenantId, comando.id),
    { comandoId: comando.id, criadoEm: comando.criadoEm },
    { nx: true, ex: TTL_COMANDO_SEGUNDOS },
  )
  if (!reservado) return { executado: false, status: 'duplicado', motivo: 'Este comando já foi processado neste ciclo.' }

  const atual = await obterConfigGamificacao()
  const controleAnterior = await redis.get<EstadoAplicacaoAutopilot>(chaveControle(tenantId))
  const nova: ConfigGamificacao = { ...atual }
  const antes: PatchAutopilot = {}

  // Primeiro devolve a configuração anterior apenas se ela ainda estiver
  // exatamente como o robô deixou. Se alguém alterou o campo, respeitamos a
  // escolha humana e não apagamos a mudança.
  if (controleAnterior) {
    for (const campo of camposPatch(controleAnterior.aplicado)) {
      const aplicado = controleAnterior.aplicado[campo]
      if (valoresIguais(nova[campo], aplicado)) {
        const anterior = controleAnterior.antes[campo]
        if (anterior !== undefined) nova[campo] = anterior as never
      }
    }
  }

  const conflitos = camposPatch(comando.patch).filter((campo) => {
    const desejado = comando.patch[campo]
    const valorAtual = nova[campo]
    const padrao = CONFIG_GAMIFICACAO_PADRAO[campo]
    return !valoresIguais(valorAtual, padrao) && !valoresIguais(valorAtual, desejado)
  })
  if (conflitos.length > 0) {
    return {
      executado: false,
      status: 'conflito_manual',
      motivo: `Configuração manual encontrada em: ${conflitos.join(', ')}. O robô não sobrescreveu nada.`,
    }
  }

  for (const campo of camposPatch(comando.patch)) {
    const desejado = comando.patch[campo]
    antes[campo] = nova[campo] as never
    nova[campo] = desejado as never
  }

  const mudou = camposPatch(comando.patch).some((campo) => !valoresIguais(atual[campo], nova[campo]))
  if (mudou) await salvarConfigGamificacao(nova)

  await redis.set<EstadoAplicacaoAutopilot>(chaveControle(tenantId), {
    tenantId,
    salvoEm: new Date().toISOString(),
    aplicado: comando.patch,
    antes,
  }, { ex: TTL_CONTROLE_SEGUNDOS })

  return {
    executado: true,
    status: mudou ? 'aplicado' : 'ja_aplicado',
    comandoId: comando.id,
    campos: camposPatch(comando.patch).map(String),
  }
}

/**
 * Desliga apenas o que o próprio robô ligou. Mudanças feitas pela equipe são
 * preservadas. É chamado quando os sinais deixam de justificar a missão.
 */
export async function reverterAplicacaoAutopilot(tenantId: string): Promise<ResultadoExecucaoAutopilot> {
  const controle = await redis.get<EstadoAplicacaoAutopilot>(chaveControle(tenantId))
  if (!controle) return { executado: false, status: 'sem_comando', motivo: 'Não há missão automática para desligar.' }

  const atual = await obterConfigGamificacao()
  const nova: ConfigGamificacao = { ...atual }
  let mudou = false
  for (const campo of camposPatch(controle.aplicado)) {
    if (valoresIguais(nova[campo], controle.aplicado[campo]) && controle.antes[campo] !== undefined) {
      nova[campo] = controle.antes[campo] as never
      mudou = true
    }
  }
  if (mudou) await salvarConfigGamificacao(nova)
  await redis.del(chaveControle(tenantId))
  if (mudou) {
    return { executado: true, status: 'aplicado', comandoId: `reverter:${controle.salvoEm}`, campos: camposPatch(controle.aplicado).map(String) }
  }
  return { executado: false, status: 'sem_comando', motivo: 'A configuração já não estava sob controle do robô.' }
}
