import type { DecisaoAutopilot, EntradaAutopilot } from './rankingAutopilot'

/**
 * Painel de controle do robô autônomo.
 *
 * Este módulo é puro: não lê Redis e não muda configuração. Ele transforma os
 * sinais já calculados pelo motor em uma trilha de desbloqueio explicável.
 * Assim a interface pode mostrar o progresso sem criar uma segunda regra de
 * negócio escondida no front-end.
 */

export type FaseAutopilotId =
  | 'dados'
  | 'demanda'
  | 'economia'
  | 'protecao'
  | 'acao'
  | 'auditoria'

export type EstadoFaseAutopilot = 'concluida' | 'em_andamento' | 'bloqueada'

export type FaseAutopilot = {
  id: FaseAutopilotId
  titulo: string
  peso: number
  estado: EstadoFaseAutopilot
  detalhe: string
  desbloqueios: string[]
}

export type SinaisControleAutopilot = {
  /** A leitura veio do índice/fallback e não está incompleta. */
  fonteConfiavel: boolean
  /** Existe uma temporada que pode receber uma missão. */
  temporadaAtiva: boolean
  /** O limite seguro tem origem em margem e orçamento conhecidos. */
  economiaConhecida: boolean
  /** O custo da ação foi calculado; sem ele não há promoção paga. */
  custoConhecido: boolean
  /** A cozinha/entrega tem uma capacidade calculada. */
  capacidadeConhecida: boolean
  /** O lock da execução foi obtido e evita duas ações iguais. */
  idempotenciaPronta: boolean
  /** Pausa de emergência; deve vencer qualquer outra regra. */
  pausaEmergencia?: boolean
  /** O Top 10 anterior foi calculado sem buracos. */
  top10Completo?: boolean
}

export type PlanoAutopilot = {
  modo: 'autonomo'
  estado: 'bloqueado' | 'observando' | 'pronto'
  percentual: number
  fases: FaseAutopilot[]
  acao: DecisaoAutopilot['missao']
  podeExecutar: boolean
  motivo: string
  limiteSeguroSemanalCents: number
  gastoEstimadoCents: number
}

export type PatchAutopilot = {
  missaoSemanalAtiva?: boolean
  missaoSemanalMultiplicador?: number
  missaoSemanalCooldownDias?: number
  missaoIndicacaoAtiva?: boolean
  missaoIndicacaoBonus?: number
  missaoDivulgacaoAtiva?: boolean
  missaoDivulgacaoBonus?: number
}

export type ComandoAutopilot = {
  id: string
  missao: Exclude<PlanoAutopilot['acao'], 'nenhuma'>
  patch: PatchAutopilot
  motivo: string
  criadoEm: string
  gastoEstimadoCents: number
}

const PESOS: Record<FaseAutopilotId, number> = {
  dados: 20,
  demanda: 20,
  economia: 20,
  protecao: 15,
  acao: 15,
  auditoria: 10,
}

function fase(
  id: FaseAutopilotId,
  estado: EstadoFaseAutopilot,
  detalhe: string,
  desbloqueios: string[] = [],
): FaseAutopilot {
  return { id, titulo: tituloFase(id), peso: PESOS[id], estado, detalhe, desbloqueios }
}

function tituloFase(id: FaseAutopilotId): string {
  switch (id) {
    case 'dados': return 'Dados confiáveis'
    case 'demanda': return 'Leitura da demanda'
    case 'economia': return 'Proteção do dinheiro'
    case 'protecao': return 'Proteção da operação'
    case 'acao': return 'Ação correta'
    case 'auditoria': return 'Controle e rastreio'
  }
}

function percentual(fases: FaseAutopilot[]): number {
  const total = fases.reduce((soma, item) => soma + item.peso, 0)
  const concluido = fases.reduce((soma, item) => soma + (item.estado === 'concluida' ? item.peso : 0), 0)
  return Math.round((concluido / total) * 100)
}

/**
 * Monta o estado que o painel deve exibir e decide se uma ação pode sair do
 * planejamento. O robô continua autônomo: "não fazer nada" é uma decisão
 * válida quando existe risco ou dado faltando.
 */
export function montarPlanoAutopilot(
  entrada: EntradaAutopilot,
  decisao: DecisaoAutopilot,
  sinais: SinaisControleAutopilot,
): PlanoAutopilot {
  const dadosOk = sinais.fonteConfiavel && entrada.diasObservados >= 7 && entrada.diasComPedido >= 4
  const demandaOk = dadosOk && entrada.pedidosDiaMediaBase > 0 && entrada.ticketMedioBaseCents > 0
  const economiaOk = sinais.economiaConhecida && sinais.custoConhecido && decisao.limiteSeguroSemanalCents > 0
    && decisao.gastoEstimadoCents <= decisao.limiteSeguroSemanalCents
  const protecaoOk = sinais.capacidadeConhecida && entrada.capacidadePedidosDia > 0
  const acaoOk = sinais.temporadaAtiva && decisao.missao !== 'nenhuma' && !sinais.pausaEmergencia
  const auditoriaOk = sinais.idempotenciaPronta

  const fases: FaseAutopilot[] = [
    fase('dados', dadosOk ? 'concluida' : 'em_andamento', dadosOk
      ? 'A leitura tem cobertura mínima para comparar períodos.'
      : 'O robô ainda precisa de dias e pedidos válidos para aprender.', ['Comparar o período atual com a referência']),
    fase('demanda', demandaOk ? 'concluida' : dadosOk ? 'em_andamento' : 'bloqueada', demandaOk
      ? 'Volume, ticket e recorrência podem ser comparados.'
      : 'Ainda não há referência suficiente para saber se a semana está fraca.', ['Identificar a causa da queda']),
    fase('economia', economiaOk ? 'concluida' : 'em_andamento', economiaOk
      ? 'O limite e o custo da ação estão conhecidos.'
      : 'Sem margem, orçamento ou custo confiável o robô não libera ação com risco financeiro.', ['Calcular margem e limite antes de oferecer bônus']),
    fase('protecao', protecaoOk ? 'concluida' : 'em_andamento', protecaoOk
      ? 'A capacidade da operação está disponível para a decisão.'
      : 'A capacidade da operação ainda não foi medida; o robô não força mais pedidos.', ['Aprender o limite seguro da operação']),
    fase('acao', acaoOk ? 'concluida' : decisao.missao === 'nenhuma' ? 'em_andamento' : 'bloqueada', acaoOk
      ? `A ação escolhida foi: ${decisao.missao}.`
      : 'Nenhuma missão segura foi escolhida ou não existe temporada ativa.', ['Ativar somente a missão escolhida']),
    fase('auditoria', auditoriaOk ? 'concluida' : 'em_andamento', auditoriaOk
      ? 'Lock e registro estão prontos para evitar duplicidade.'
      : 'O controle contra ações repetidas ainda não foi confirmado.', ['Guardar motivo, custo e resultado']),
  ]

  const bloqueioUrgente = sinais.pausaEmergencia
    ? 'Pausa de emergência ligada; nenhuma ação será executada.'
    : !dadosOk
      ? 'Faltam dados confiáveis para o robô aprender.'
      : !economiaOk
        ? 'A ação está bloqueada até o custo e o limite seguro serem conhecidos.'
        : !protecaoOk
          ? 'A operação ainda não tem capacidade conhecida.'
          : !acaoOk
            ? 'Não existe uma ação segura para executar agora.'
            : !auditoriaOk
              ? 'O controle contra duplicidade ainda não está pronto.'
              : 'Todos os bloqueios foram removidos.'

  const podeExecutar = dadosOk && demandaOk && economiaOk && protecaoOk && acaoOk && auditoriaOk
  const estado: PlanoAutopilot['estado'] = podeExecutar
    ? 'pronto'
    : decisao.status === 'simulacao_pronta' || decisao.status === 'observando'
      ? 'observando'
      : 'bloqueado'

  return {
    modo: 'autonomo',
    estado,
    percentual: percentual(fases),
    fases,
    acao: podeExecutar ? decisao.missao : 'nenhuma',
    podeExecutar,
    motivo: bloqueioUrgente,
    limiteSeguroSemanalCents: decisao.limiteSeguroSemanalCents,
    gastoEstimadoCents: podeExecutar ? decisao.gastoEstimadoCents : 0,
  }
}

/**
 * Converte a decisão em um comando pequeno e idempotente. Os valores abaixo
 * são políticas seguras do robô, não campos que o dono precisa preencher:
 * missões de competição começam com +1 e a Caçada permanece no 2x aprovado.
 * Impulso, foto e carryover ficam fora deste executor porque têm regras de
 * prêmio/consentimento próprias.
 */
export function criarComandoAutopilot(
  plano: PlanoAutopilot,
  agora = Date.now(),
): ComandoAutopilot | null {
  if (!plano.podeExecutar || plano.acao === 'nenhuma') return null
  const prefixo = new Date(agora).toISOString().slice(0, 10)
  switch (plano.acao) {
    case 'missao_indicacao':
      return {
        id: `ranking-autopilot:${prefixo}:missao_indicacao`,
        missao: 'missao_indicacao',
        patch: { missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 1 },
        motivo: plano.motivo,
        criadoEm: new Date(agora).toISOString(),
        gastoEstimadoCents: plano.gastoEstimadoCents,
      }
    case 'divulgacao_organica':
      return {
        id: `ranking-autopilot:${prefixo}:divulgacao_organica`,
        missao: 'divulgacao_organica',
        patch: { missaoDivulgacaoAtiva: true, missaoDivulgacaoBonus: 1 },
        motivo: plano.motivo,
        criadoEm: new Date(agora).toISOString(),
        gastoEstimadoCents: plano.gastoEstimadoCents,
      }
    case 'missao_semanal':
      return {
        id: `ranking-autopilot:${prefixo}:missao_semanal`,
        missao: 'missao_semanal',
        patch: { missaoSemanalAtiva: true, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7 },
        motivo: plano.motivo,
        criadoEm: new Date(agora).toISOString(),
        gastoEstimadoCents: plano.gastoEstimadoCents,
      }
  }
}
