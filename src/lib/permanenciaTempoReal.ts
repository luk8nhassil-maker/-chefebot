// Regras de permanência/abandono para a listagem ativa do Tempo Real.
// NUNCA apaga histórico (conversa_full / conversa_meta).
// Filtra apenas visibilidade em /api/sessoes-ativas.
// Quando a conversa é "abandonada", some da listagem — histórico permanece intacto.
// Nova mensagem do cliente atualiza ultimaTs via atualizarHistorico() e a conversa
// reaparece automaticamente na próxima chamada.

const LIMITE_BOT_MS    = 40 * 60 * 1000        // 40 min  – bot em andamento
const LIMITE_PIX_MS    = 60 * 60 * 1000        // 60 min  – aguardando Pix
const LIMITE_DONE_MS   = 30 * 60 * 1000        // 30 min  – pedido finalizado
const LIMITE_MANUAL_MS = 2  * 60 * 60 * 1000   // 2 h     – atendimento humano

export type ContextoPermanencia = {
  step: string
  manual: boolean
  postOrderPriority: boolean
  /** conversa_meta.ultimaTs em ms; 0 = desconhecido */
  ultimaTs: number
  /** injetável em testes */
  now?: number
}

/**
 * Retorna true se a conversa deve aparecer no Tempo Real, false se deve ser
 * ocultada por inatividade. Quando ultimaTs=0 (desconhecido) exibe por
 * segurança (não esconde o que não pode datar).
 */
export function deveExibirNoTempoReal(ctx: ContextoPermanencia): boolean {
  if (!ctx.ultimaTs) return true

  const now = ctx.now ?? Date.now()
  const idadeMs = now - ctx.ultimaTs

  // Atendimento humano: janela mais larga (2h)
  if (ctx.manual) {
    return idadeMs <= LIMITE_MANUAL_MS
  }

  // Pedido finalizado sem re-engajamento: 30 min
  if (ctx.step === 'done' && !ctx.postOrderPriority) {
    return idadeMs <= LIMITE_DONE_MS
  }

  // Aguardando Pix: 60 min
  if (ctx.step === 'aguardando_pix') {
    return idadeMs <= LIMITE_PIX_MS
  }

  // Demais casos (bot em andamento, postOrderPriority, escalado sem manual): 40 min
  return idadeMs <= LIMITE_BOT_MS
}
