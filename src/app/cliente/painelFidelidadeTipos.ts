// Tipos compartilhados entre a página do cliente (page.tsx) e a tela
// dedicada do ranking (FidelidadeRankingScreen.tsx) — extraídos para um
// módulo próprio para as duas partes importarem sem depender uma da outra
// (evita import circular entre page.tsx e FidelidadeRankingScreen.tsx).
import type { AlvoRankingAtual, DisputaRelativa } from "@/lib/rankingRetencao"

export type PainelFidelidade = {
  temporada: {
    nome: string | null
    diasRestantes: number | null
    fimEm: string | null
    estado: string
    // `null` sem aprovação explícita do admin — nunca promete prêmio.
    premio?: { descricao: string | null; quantidadePremiados: number } | null
  } | null
  ranking: {
    posicao: number
    score: number
    participaCampanha: boolean
    entorno: { posicao: number; eVoce: boolean }[]
    lista: {
      posicao: number
      score: number
      eVoce: boolean
      participaCampanha: boolean
      nomePublico?: string
      telefoneMascarado?: string
    }[]
    variacaoPosicao: VariacaoPosicaoRanking | null
    participantes: {
      posicao: number | null
      total: number
      variacaoPosicao: VariacaoPosicaoRanking | null
      lista: {
        posicao: number
        score: number
        eVoce: boolean
        participaCampanha: true
        nomePublico?: string
        telefoneMascarado?: string
      }[]
      // Alvo atual e disputa relativa (vizinho acima/abaixo), sempre entre
      // PARTICIPANTES — quem não autorizou não disputa o prêmio.
      alvo?: AlvoRankingAtual | null
      disputa?: DisputaRelativa | null
    }
  } | null
  // Regra oficial de indicação — nunca hardcoded no frontend.
  indicacao?: { ativa: boolean; estrelasPrimeiraCompra: number | null } | null
  // Gamificação V2 — cada campo fica null/ausente quando o admin não
  // configurou aquela mecânica (fail-closed). Nunca renderizar um selo,
  // missão ou nível a partir de um valor "adivinhado" quando o campo é null.
  gamificacao?: PainelGamificacao | null
}

export type StatusTemporadaSocial = 'campeao' | 'prata' | 'bronze' | 'elite' | null

export type PainelGamificacao = {
  statusSocial: StatusTemporadaSocial
  // Já está somado dentro de ranking.score/ranking.participantes — exposto
  // aqui só para a UI conseguir mostrar "dos quais X são bônus de temporada".
  bonusCompeticao: number
  missaoSemanal: { status: 'inativa' | 'desbloqueada' | 'consumida' } | null
  missaoIndicacao: { concluida: boolean } | null
  nivelChef: { nivel: number; nome: string | null; xpAtual: number; xpProximoNivel: number | null } | null
}

export type VariacaoPosicaoRanking = { direcao: 'subiu' | 'desceu' | 'manteve'; casas: number }

export type FinalidadePrivacidadeRanking = 'ranking_primeiro_nome' | 'ranking_telefone_mascarado' | 'ranking_foto_perfil'

export type PreferenciasPrivacidadeRanking = {
  participaCampanha: boolean
  finalidades: Array<{
    finalidade: FinalidadePrivacidadeRanking
    texto: string | null
    textoVersao: string | null
    disponivel: boolean
    motivoIndisponivel: 'texto_nao_aprovado' | 'infraestrutura_nao_configurada' | 'fonte_oficial_indisponivel' | null
    estado: 'concedido' | 'revogado'
    atualizadoEm: string | null
  }>
}
