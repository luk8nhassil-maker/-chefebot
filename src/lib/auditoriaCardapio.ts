import { redis } from '@/lib/redis'

// Log administrativo de alterações no cardápio (chave Redis "cardapio").
// Cada gravação bem-sucedida de POST /api/cardapio anexa uma entrada aqui.
// Existe para investigar QUEM alterou o quê e QUANDO — foi a ausência total
// disso que tornou a investigação dos produtos "Teste" inteiramente
// dependente de comparar snapshots manuais. Nunca grava token, cookie ou
// qualquer dado de sessão — apenas identidade textual (username) já presente
// no payload do JWT verificado.
//
// Evolução futura documentada (fora do escopo desta rodada): IDs estáveis
// por item, createdAt/updatedAt/createdBy por item, histórico completo de
// diffs por item (não apenas contagem agregada por seção).

const CHAVE_LOG = 'cardapioAuditoria'
const MAX_ENTRADAS = 500

export type EntradaAuditoriaCardapio = {
  data: string
  admin: string
  acao: 'atualizacao_cardapio'
  secoes: Array<{
    secao: string
    itensAntes: number
    itensDepois: number
  }>
}

function contarItens(secao: unknown): number {
  return Array.isArray(secao) ? secao.length : 0
}

/**
 * Registra uma alteração de cardápio. Compara o cardápio anterior e o novo
 * seção a seção (apenas contagem, sem detalhe de item individual) para dar
 * visibilidade rápida do tamanho da mudança. Nunca lança: falha de log não
 * pode derrubar a gravação do cardápio em si.
 */
export async function registrarAuditoriaCardapio(
  admin: string,
  cardapioAnterior: Record<string, unknown> | null,
  cardapioNovo: Record<string, unknown>,
): Promise<void> {
  try {
    const chaves = new Set([
      ...Object.keys(cardapioAnterior ?? {}),
      ...Object.keys(cardapioNovo),
    ])
    const secoes = Array.from(chaves).map((secao) => ({
      secao,
      itensAntes: contarItens(cardapioAnterior?.[secao]),
      itensDepois: contarItens(cardapioNovo[secao]),
    }))

    const entrada: EntradaAuditoriaCardapio = {
      data: new Date().toISOString(),
      admin,
      acao: 'atualizacao_cardapio',
      secoes,
    }

    await redis.lpush(CHAVE_LOG, JSON.stringify(entrada))
    await redis.ltrim(CHAVE_LOG, 0, MAX_ENTRADAS - 1)
  } catch {
    // Auditoria é best-effort: nunca bloqueia nem quebra a gravação do cardápio.
  }
}
