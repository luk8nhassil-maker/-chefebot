// Lógica pura da Área do Cliente (Etapa 4), separada do componente React
// para permitir teste sem depender de renderização de DOM (o projeto não usa
// jsdom/testing-library — ver limitações registradas no PR).

export type TipoMovimentoExtrato =
  | 'previsto'
  | 'confirmado'
  | 'cancelado'
  | 'estornado'
  | 'resgatado'
  | 'ajuste'
  | 'resgate_estornado'

export type MovimentoExtrato = {
  id: string
  pedidoId: string | null
  tipo: TipoMovimentoExtrato
  pontos: number
  descricao: string
  criadoEm: string
}

export type RecompensaInfo = {
  ativa: boolean
  custoPontos: number
  tipo: 'desconto_fixo' | 'pizza_gratis'
  descricao: string
  disponivel: boolean
  valorDescontoCentavos?: number
  valorMaximoCentavos?: number
} | null

export type Fidelidade = {
  saldoPontos: number
  pontosPrevistos: number
  metaPontos: number
  pontosFaltantes: number
  progressoPercentual: number
  metaAtingida: boolean
  extrato: MovimentoExtrato[]
  recompensa: RecompensaInfo
}

export type Resgate = {
  resgateId: string
  status: 'reservado' | 'aplicado' | 'cancelado' | 'expirado' | 'estornado'
  expiraEm: string
}

export const EXTRATO_LABEL: Record<TipoMovimentoExtrato, string> = {
  previsto: 'Pontos previstos',
  confirmado: 'Pontos confirmados',
  cancelado: 'Pedido cancelado',
  estornado: 'Estorno de pontos',
  resgatado: 'Resgate de recompensa',
  ajuste: 'Ajuste',
  resgate_estornado: 'Pontos restituídos',
}

/** Cor semântica (sucesso, erro ou neutra) usada para o valor de uma linha do extrato. */
export type CorValor = 'sucesso' | 'erro' | 'neutra'

export function descreverMovimento(mov: Pick<MovimentoExtrato, 'tipo' | 'pontos'>): { valorTexto: string; cor: CorValor } {
  if (mov.tipo === 'cancelado') {
    return { valorTexto: '—', cor: 'neutra' }
  }
  if (mov.tipo === 'confirmado' || mov.tipo === 'resgate_estornado') {
    return { valorTexto: `+${mov.pontos}`, cor: 'sucesso' }
  }
  if (mov.tipo === 'resgatado' || mov.tipo === 'estornado') {
    return { valorTexto: `−${Math.abs(mov.pontos)}`, cor: 'erro' }
  }
  if (mov.tipo === 'previsto') {
    return { valorTexto: `+${mov.pontos} (previsto)`, cor: 'neutra' }
  }
  // ajuste: sinal segue o valor
  return { valorTexto: mov.pontos >= 0 ? `+${mov.pontos}` : `${mov.pontos}`, cor: mov.pontos >= 0 ? 'sucesso' : 'erro' }
}

/** Primeiro nome para saudação — nunca expõe o nome completo/telefone. */
export function primeiroNome(nome: string | null | undefined): string | null {
  return nome ? nome.trim().split(' ')[0] : null
}

/** Formata centavos->reais para exibição (money helper usado pelo extrato de pedidos). */
export function formatarMoeda(v?: number): string {
  return `R$ ${(v ?? 0).toFixed(2).replace('.', ',')}`
}

/** Percentual visual da barra de progresso, sempre limitado a [0, 100]. */
export function progressoVisual(percentual: number): number {
  return Math.min(100, Math.max(0, percentual))
}

/** Minutos restantes até a expiração de uma reserva de resgate (nunca negativo). */
export function minutosRestantes(expiraEm: string, agora: number = Date.now()): number {
  return Math.max(0, Math.round((new Date(expiraEm).getTime() - agora) / 60000))
}

/** Um resgate só é considerado "ativo" para exibição se reservado e ainda não expirado. */
export function resgateEstaAtivo(resgate: Pick<Resgate, 'status' | 'expiraEm'>, agora: number = Date.now()): boolean {
  return resgate.status === 'reservado' && minutosRestantes(resgate.expiraEm, agora) > 0
}

/** O card de meta atingida (fundo navy) substitui o de progresso — nunca os dois juntos. */
export function deveExibirMetaAtingida(fidelidade: Pick<Fidelidade, 'metaAtingida'>): boolean {
  return fidelidade.metaAtingida
}

/** Pontos previstos só aparecem quando existem, e nunca somados ao saldo confirmado. */
export function deveExibirPontosPrevistos(fidelidade: Pick<Fidelidade, 'pontosPrevistos'>): boolean {
  return fidelidade.pontosPrevistos > 0
}

/** CTA de resgate só aparece quando a recompensa está disponível e não há reserva ativa em curso. */
export function podeExibirCtaResgate(recompensa: RecompensaInfo, resgateAtivo: Resgate | null): boolean {
  return !!recompensa && recompensa.disponivel && !resgateAtivo
}
