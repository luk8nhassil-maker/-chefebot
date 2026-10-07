'use client'

// Tela cheia do Ranking do Chefe para quem JÁ participa. Extraído de
// cliente/page.tsx (que crescia demais) para um módulo dedicado — mesmo
// comportamento e tipos, reaproveitado tanto pela página real quanto pelo
// Preview isolado (/dev/ranking-retencao), que importa este mesmo arquivo.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Star } from 'lucide-react'
import {
  detectarConquistaRanking,
  mensagemAlvoRanking,
  mensagemMovimento,
  textoConquistaRanking,
  type ParticipanteDisputa,
} from '@/lib/rankingRetencao'
import type { EventoRankingRetencao } from '@/lib/rankingRetencaoTelemetria'
import type {
  PainelFidelidade,
  VariacaoPosicaoRanking,
  FinalidadePrivacidadeRanking,
  PreferenciasPrivacidadeRanking,
  PainelGamificacao,
} from './painelFidelidadeTipos'

const NOME_STATUS_SOCIAL: Record<NonNullable<PainelGamificacao['statusSocial']>, string> = {
  campeao: 'Campeão',
  prata: 'Prata',
  bronze: 'Bronze',
  elite: 'Elite Top 10',
}

const ICONE_STATUS_SOCIAL: Record<NonNullable<PainelGamificacao['statusSocial']>, string> = {
  campeao: '👑',
  prata: '🥈',
  bronze: '🥉',
  elite: '✦',
}

type MomentoRanking = 'conquista' | 'nivel' | 'coroa' | 'indicacao' | 'foto' | 'semanal' | 'pedido'
function escolherMomentoPrincipal(
  ranking: NonNullable<PainelFidelidade['ranking']>,
  gamificacao: PainelGamificacao | null | undefined,
  indicacao: PainelFidelidade['indicacao'] | undefined,
  posPedido: FidelidadeRankingScreenProps['posPedido'],
  podeCompartilhar: boolean,
  podeIndicar: boolean,
  podeAdicionarFoto: boolean,
  podePedir: boolean,
): MomentoRanking | null {
  if (posPedido) return 'pedido'
  if (podeAdicionarFoto && gamificacao?.missaoFotoPerfil && !gamificacao.missaoFotoPerfil.concluida) return 'foto'
  if (gamificacao?.coroaAmeacada && ranking.participantes.alvo?.estado === 'liderando') return 'coroa'
  if (podePedir && gamificacao?.missaoSemanal?.status === 'desbloqueada') return 'semanal'
  if (podeIndicar && gamificacao?.missaoIndicacao && !gamificacao.missaoIndicacao.concluida && indicacao?.ativa && indicacao.compartilhamentoLiberado !== false) return 'indicacao'
  if (podeCompartilhar && detectarConquistaRanking({
    posicao: ranking.participantes.posicao ?? ranking.posicao,
    variacao: ranking.participantes.variacaoPosicao,
  })) return 'conquista'
  return null
}
const subscribeToDocument = () => () => {}
const documentDisponivel = () => true
const documentIndisponivel = () => false

// Selo compacto (só ícone) para OUTROS membros do Top 10 dentro das listas —
// distinto do selo "cf-ranking-selo" (ícone+nome) usado no card do próprio
// cliente no topo da tela. Correção de blocker da auditoria do #446: antes,
// só quem estava logado via o próprio selo.
function seloSocialCompacto(status: PainelGamificacao['statusSocial'] | undefined) {
  if (!status) return null
  return (
    <span className={`cf-ranking-selo-mini cf-ranking-selo-mini-${status}`} title={NOME_STATUS_SOCIAL[status]} aria-label={NOME_STATUS_SOCIAL[status]}>
      {ICONE_STATUS_SOCIAL[status]}
    </span>
  )
}

export type FidelidadeRankingScreenProps = {
  ranking: NonNullable<PainelFidelidade['ranking']>
  temporada: PainelFidelidade['temporada']
  indicacao?: PainelFidelidade['indicacao']
  // Gamificação V2 — ausente/null quando o admin não configurou nenhuma
  // mecânica (fail-closed): a tela nunca mostra selo, missão ou nível vazio.
  gamificacao?: PainelGamificacao | null
  privacidade: PreferenciasPrivacidadeRanking | null
  privacidadeCarregando: boolean
  privacidadeSalvando: FinalidadePrivacidadeRanking | 'todas' | null
  privacidadeErro: string
  indicando?: boolean
  compartilhando?: boolean
  posPedido?: { estado: 'pendente' | 'creditado'; estrelasGanhas?: number } | null
  onAlterarPrivacidade: (
    finalidade: FinalidadePrivacidadeRanking,
    estado: 'concedido' | 'revogado',
    textoVersao: string | null,
  ) => void
  onRevogarTodas: () => void
  onIndicarAmigo?: () => void
  onCompartilharConquista?: () => void
  onAdicionarFoto?: () => void
  fotoEnviando?: boolean
  onNovoPedido?: () => void
  onTelemetria?: (tipo: EventoRankingRetencao) => void
  onClose: () => void
}

/** Pódio detalhado: scores são reais; a identidade opcional ja chega como um
 * DTO minimo produzido pela protecao server-side. */
export function FidelidadeRankingScreen({
  ranking,
  temporada,
  indicacao,
  gamificacao = null,
  privacidade,
  privacidadeCarregando,
  privacidadeSalvando,
  privacidadeErro,
  indicando = false,
  compartilhando = false,
  posPedido = null,
  onAlterarPrivacidade,
  onRevogarTodas,
  onIndicarAmigo,
  onCompartilharConquista,
  onAdicionarFoto,
  fotoEnviando = false,
  onNovoPedido,
  onTelemetria,
  onClose,
}: FidelidadeRankingScreenProps) {
  const [aba, setAba] = useState<'participantes' | 'minha' | 'geral'>('minha')
  const [sheetSubirAberto, setSheetSubirAberto] = useState(false)
  const [momentoAberto, setMomentoAberto] = useState<MomentoRanking | null>(() => escolherMomentoPrincipal(ranking, gamificacao, indicacao, posPedido, !!onCompartilharConquista && indicacao?.ativa === true && indicacao.compartilhamentoLiberado !== false, !!onIndicarAmigo, !!onAdicionarFoto, !!onNovoPedido))
  const podeCriarPortal = useSyncExternalStore(subscribeToDocument, documentDisponivel, documentIndisponivel)
  const momentoDialogRef = useRef<HTMLDivElement>(null)
  const momentoGatilhoRef = useRef<HTMLElement | null>(null)
  const rankingRef = useRef<HTMLElement>(null)
  const abrirMomento = (momento: MomentoRanking) => {
    if (!momentoAberto) momentoGatilhoRef.current = document.activeElement as HTMLElement | null
    setMomentoAberto(momento)
  }
  const emit = (tipo: EventoRankingRetencao) => onTelemetria?.(tipo)
  const lista = [...ranking.lista].sort((a, b) => a.posicao - b.posicao)
  const listaSemPodio = lista.filter((entrada) => entrada.posicao > 3)
  // Posição própria de quem "Vale prêmio": reindexada só entre participantes
  // pelo servidor (src/app/api/cliente/fidelidade/painel/route.ts), nunca a
  // posição do ranking geral — um participante pode estar no pódio aqui
  // mesmo fora do Top 3 geral, se os primeiros colocados não participarem.
  const participantes = [...ranking.participantes.lista].sort((a, b) => a.posicao - b.posicao)
  const podium = participantes.filter((entrada) => entrada.posicao <= 3)
  const linhas = aba === 'geral' ? listaSemPodio : participantes.filter((entrada) => entrada.posicao > 3)
  const nomeSeguro = (entrada: { eVoce: boolean; participaCampanha: boolean; posicao: number; nomePublico?: string }) => {
    if (entrada.eVoce && !entrada.participaCampanha) return 'Você — fora da disputa'
    if (!entrada.participaCampanha) return 'Fora da disputa'
    return entrada.eVoce ? 'Você' : entrada.nomePublico || `Participante ${entrada.posicao}`
  }
  const avatarSeguro = (entrada: { eVoce: boolean; nomePublico?: string } | undefined) =>
    entrada?.eVoce ? 'V' : entrada?.nomePublico?.slice(0, 1).toUpperCase() || null
  // `linhas` mistura o ranking geral (sem selo) com o de participantes (com
  // selo) conforme a aba — leitura opcional e seletiva, nunca inventa selo
  // para quem não tem um vindo do servidor.
  const statusSocialDaLinha = (entrada: unknown): PainelGamificacao['statusSocial'] | undefined =>
    (entrada as { statusSocial?: PainelGamificacao['statusSocial'] }).statusSocial
  const scoreSeguro = (score: number) => (
    <span className="cf-ranking-score"><Star size={16} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />{score}</span>
  )
  // Histórico honesto: só mostra selo quando o servidor tem um snapshot
  // anterior real para comparar (variacaoPosicao null = sem histórico ainda,
  // e "manteve" não gera selo — não há o que destacar).
  const variacaoDaAba = aba === 'participantes' ? ranking.participantes.variacaoPosicao : ranking.variacaoPosicao
  const seloVariacao = (variacao: VariacaoPosicaoRanking | null) => {
    if (!variacao || variacao.direcao === 'manteve') return null
    const cor = variacao.direcao === 'subiu' ? 'var(--success-text)' : 'var(--danger-text)'
    const seta = variacao.direcao === 'subiu' ? '▲' : '▼'
    return <small style={{ color: cor, fontWeight: 700 }}>{seta} {variacao.casas} desde ontem</small>
  }

  // Alvo e disputa são sempre calculados pelo servidor entre PARTICIPANTES
  // (quem "vale prêmio") — é a posição que importa para quem já disputa a
  // temporada. O componente só formata os números que já chegaram prontos.
  const alvo = ranking.participantes.alvo ?? null
  const disputa = ranking.participantes.disputa ?? null
  const mensagemMissao = alvo ? mensagemAlvoRanking(alvo) : null
  const mensagemMov = mensagemMovimento(ranking.participantes.variacaoPosicao)
  const conquista = detectarConquistaRanking({
    posicao: ranking.participantes.posicao ?? ranking.posicao,
    variacao: ranking.participantes.variacaoPosicao,
  })
  const compartilhamentoLiberado = indicacao?.compartilhamentoLiberado !== false
  const consentimentoNome = privacidade?.finalidades.find((item) =>
    item.finalidade === 'ranking_primeiro_nome' && item.disponivel && item.textoVersao
  ) ?? null
  const podeLiberarNome = !!consentimentoNome && consentimentoNome.estado !== 'concedido'
  const podeCompartilharConquista = conquista !== null && indicacao?.ativa === true && !!onCompartilharConquista && compartilhamentoLiberado
  // Progresso absoluto (XP acumulado / XP do próximo nível) — nunca inventa
  // um "início de faixa" que o domínio (calcularNivelChef) não devolve; sem
  // próximo nível (nível máximo), a barra fica cheia.
  const nivelProgressoPercent = gamificacao?.nivelChef
    ? gamificacao.nivelChef.xpProximoNivel
      ? Math.max(0, Math.min(100, Math.round((gamificacao.nivelChef.xpAtual / gamificacao.nivelChef.xpProximoNivel) * 100)))
      : 100
    : 0
  const momentos: { id: MomentoRanking; eyebrow: string; titulo: string; resumo: string; simbolo: string }[] = []
  if (posPedido) momentos.push({
    id: 'pedido', eyebrow: 'SEU PEDIDO',
    titulo: posPedido.estado === 'creditado' ? (posPedido.estrelasGanhas == null ? 'Estrelas confirmadas' : `+${posPedido.estrelasGanhas} estrelas`) : 'Pedido recebido',
    resumo: posPedido.estado === 'creditado' ? 'Veja o que mudou na sua posição.' : 'Acompanhe a confirmação das estrelas.',
    simbolo: posPedido.estado === 'creditado' ? '✦' : '◷',
  })
  if (conquista) momentos.push({ id: 'conquista', eyebrow: 'CONQUISTA RECENTE', titulo: 'Sua posição merece destaque', resumo: podeCompartilharConquista ? 'Veja sua conquista e convide alguém conhecido.' : 'Veja sua conquista no Ranking.', simbolo: '✦' })
  if (gamificacao?.missaoFotoPerfil) momentos.push({
    id: 'foto',
    eyebrow: 'MISSÃO DE PERFIL',
    titulo: gamificacao.missaoFotoPerfil.concluida ? 'Foto concluída' : `Adicione uma foto e ganhe +${gamificacao.missaoFotoPerfil.bonus}`,
    resumo: gamificacao.missaoFotoPerfil.concluida ? 'Bônus já recebido.' : 'Bônus único no Ranking. Sua foto só fica pública se você autorizar.',
    simbolo: '◎',
  })
  if (gamificacao?.missaoSemanal?.status === 'desbloqueada') momentos.push({ id: 'semanal', eyebrow: 'MISSÃO SEMANAL', titulo: 'Caçada ao Pódio liberada!', resumo: 'Seu próximo pedido vale 2x no Ranking.', simbolo: '↗' })
  if (alvo?.estado === 'liderando') momentos.push({ id: 'coroa', eyebrow: 'NA LIDERANÇA', titulo: gamificacao?.coroaAmeacada ? 'Coroa ameaçada!' : 'Defenda sua coroa', resumo: mensagemMissao ?? 'Acompanhe sua vantagem.', simbolo: '♛' })
  if (gamificacao?.missaoIndicacao) momentos.push({ id: 'indicacao', eyebrow: 'MISSÃO DA TEMPORADA', titulo: 'Indique 1 amigo', resumo: gamificacao.missaoIndicacao.concluida ? '1/1 ✓ Concluída' : '0/1 · Veja como participar', simbolo: '↗' })
  if (gamificacao?.nivelChef) momentos.push({ id: 'nivel', eyebrow: 'SEU NÍVEL', titulo: `Nível ${gamificacao.nivelChef.nivel}${gamificacao.nivelChef.nome ? ` — ${gamificacao.nivelChef.nome}` : ''}`, resumo: gamificacao.nivelChef.xpProximoNivel === null ? 'Nível máximo atingido.' : `${gamificacao.nivelChef.xpAtual} XP / ${gamificacao.nivelChef.xpProximoNivel} XP`, simbolo: '✶' })
  const momentoAtual = momentos.find((item) => item.id === momentoAberto)
  const modalAtivo = !!momentoAtual
  const focoAtual = momentos.find((item) => item.id === escolherMomentoPrincipal(ranking, gamificacao, indicacao, posPedido, podeCompartilharConquista, !!onIndicarAmigo, !!onAdicionarFoto, !!onNovoPedido))
  const outrosMomentos = momentos.filter((item) => item.id !== focoAtual?.id)

  // Telemetria da abertura — dispara uma vez por montagem (o usuário abriu a
  // tela agora). "Retorno" é reconhecido por um marcador local no aparelho,
  // nunca por dado de servidor — não é PII, só "já visitou esta tela antes".
  // "Subiu posição"/"entrou Top 10"/"entrou Top 3" são FATOS de negócio e
  // agora só são registrados no servidor (painel/route.ts), no momento em
  // que a variação real é calculada — nunca aqui, para o navegador não ser
  // autoridade sobre um fato e para uma mesma subida não ser contada de novo
  // a cada vez que o cliente reabre a tela (correção do #445).
  useEffect(() => {
    let jaVisitou = false
    try { jaVisitou = localStorage.getItem('cf_ranking_visitado_antes_v1') === '1' } catch {}
    emit(jaVisitou ? 'ranking_retorno' : 'ranking_aberto')
    try { localStorage.setItem('cf_ranking_visitado_antes_v1', '1') } catch {}
    if (disputa) emit('disputa_visualizada')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!modalAtivo || !podeCriarPortal) return
    const rankingAtual = rankingRef.current
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    momentoDialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMomentoAberto(null); return }
      if (event.key !== 'Tab') return
      const focaveis = Array.from(momentoDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') ?? [])
      if (focaveis.length === 0) { event.preventDefault(); return }
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      if (event.shiftKey && (document.activeElement === primeiro || document.activeElement === momentoDialogRef.current)) {
        event.preventDefault(); ultimo.focus()
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault(); primeiro.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = overflowAnterior
      document.removeEventListener('keydown', onKeyDown);
      (momentoGatilhoRef.current ?? rankingAtual)?.focus()
    }
  }, [momentoAberto, modalAtivo, podeCriarPortal])

  useEffect(() => {
    if (!momentoAberto || modalAtivo) return
    let ativo = true
    queueMicrotask(() => { if (ativo) setMomentoAberto(null) })
    return () => { ativo = false }
  }, [momentoAberto, modalAtivo])

  const linhaDisputa = (participante: ParticipanteDisputa) => (
    <div key={`disputa-${participante.posicao}`} className={`cf-ranking-row ${participante.eVoce ? 'voce' : ''}`}>
      <strong>{participante.posicao}</strong>
      <span className="cf-ranking-row-avatar">
        {participante.eVoce ? 'V' : participante.nomePublico?.slice(0, 1).toUpperCase() || <Star size={15} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />}
      </span>
      <span className="cf-ranking-row-name">
        {participante.eVoce ? 'Você' : participante.nomePublico || 'Participante'}
        {participante.telefoneMascarado && <small>{participante.telefoneMascarado}</small>}
      </span>
      <b>{scoreSeguro(participante.score)}</b>
    </div>
  )

  return (
    <main ref={rankingRef} tabIndex={-1} className="cf-ranking-screen" aria-label="Pódio Chefe" inert={modalAtivo ? true : undefined}>
      <header className="cf-ranking-header">
        <button type="button" onClick={onClose} aria-label="Voltar para Fidelidade">‹</button>
        <div>
          <h1>Ranking do Chefe</h1>
          {/* A descrição do prêmio só aparece quando o servidor o configurou. */}
          <p>{temporada?.premio ? 'Suba de posição nesta temporada.' : 'Acompanhe sua posição nesta temporada.'}</p>
        </div>
        {temporada && (
          <div className="cf-ranking-season">
            <strong>{temporada.diasRestantes === null ? 'Em andamento' : `${temporada.diasRestantes}d restantes`}</strong>
            <small>{temporada.premio ? (temporada.premio.descricao || 'Prêmio configurado') : (temporada.nome || 'Temporada atual')}</small>
          </div>
        )}
      </header>

      <section className="cf-ranking-podium" aria-label="Melhores posições">
        {[2, 1, 3].map((posicao) => {
          const entrada = podium.find((item) => item.posicao === posicao)
          return (
            <div key={posicao} className={`cf-ranking-podium-item cf-ranking-podium-${posicao}`}>
              <div className="cf-ranking-medal">{posicao}</div>
              <div className="cf-ranking-avatar">{avatarSeguro(entrada) ?? <Star size={16} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />}</div>
              <strong>{entrada ? nomeSeguro(entrada) : `Posição ${posicao}`} {entrada && seloSocialCompacto(entrada.statusSocial)}</strong>
              <b>{entrada ? scoreSeguro(entrada.score) : 'Vaga aberta'}</b>
            </div>
          )
        })}
      </section>

      <div className="cf-ranking-tabs" role="tablist" aria-label="Filtro do ranking">
        {([['participantes', 'Participando'], ['minha', 'Minha posição'], ['geral', 'Todos']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}>{label}</button>
        ))}
      </div>

      {aba === 'minha' ? (
        <section className="cf-ranking-personal" aria-label="Minha posição">
          <section className="cf-ranking-current" aria-label="Seu status atual">
            <div>
              <small>SUA POSIÇÃO</small>
              <strong>{ranking.participantes.posicao ? `#${ranking.participantes.posicao}` : '—'}</strong>
              <span>{ranking.score} pontos no Ranking</span>
              {(gamificacao?.bonusCompeticao ?? 0) > 0 && (
                <span>{gamificacao?.bonusCompeticao} de bônus na competição; suas Estrelas de Fidelidade não mudam.</span>
              )}
            </div>
            <div className="cf-ranking-current-goal">
              <small>PRÓXIMO PASSO</small>
              <strong>{mensagemMissao ?? 'Continue acumulando estrelas para subir.'}</strong>
            </div>
          </section>

          {podeLiberarNome && consentimentoNome && (
            <section className="cf-ranking-name-optin" aria-label="Identidade no Ranking">
              <span>
                <strong>Quer aparecer pelo seu primeiro nome?</strong>
                <small>É opcional. Sem autorização, você continua como “Participante”.</small>
              </span>
              <button
                type="button"
                disabled={privacidadeSalvando !== null}
                onClick={() => onAlterarPrivacidade('ranking_primeiro_nome', 'concedido', consentimentoNome.textoVersao)}
              >
                {privacidadeSalvando === 'ranking_primeiro_nome' ? 'Salvando…' : 'Mostrar meu nome'}
              </button>
            </section>
          )}

          {gamificacao?.movimentoRecente && gamificacao.movimentoRecente.variacao.direcao !== 'manteve' && (
            <p className="cf-ranking-movimento-recente">
              {gamificacao.movimentoRecente.variacao.direcao === 'subiu' ? '▲' : '▼'} {gamificacao.movimentoRecente.variacao.casas} desde sua última visita
            </p>
          )}

          {onNovoPedido && (
            <button
              type="button"
              className="cf-ranking-cta-primary"
              onClick={() => { emit('cta_subir_clicado'); setSheetSubirAberto(true) }}
            >
              Como subir
            </button>
          )}

          <section className="cf-ranking-list" aria-label="Pessoas próximas de você">
            <p className="cf-ranking-footnote" style={{ marginTop: 0, fontWeight: 700, color: '#40536f' }}>PERTO DE VOCÊ</p>
            {disputa ? (
              <>
                {disputa.acima && linhaDisputa(disputa.acima)}
                {disputa.abaixo && linhaDisputa(disputa.abaixo)}
                {disputa.sozinho && <p className="cf-ranking-empty">Você é o único participante desta temporada até agora.</p>}
              </>
            ) : (
              <p className="cf-ranking-empty">Sua disputa aparece assim que você tiver uma posição entre participantes.</p>
            )}
          </section>

          {gamificacao?.statusSocial && (
            <section className="cf-ranking-selos" aria-label="Seu status">
              <span className={`cf-ranking-selo cf-ranking-selo-${gamificacao.statusSocial}`}>
                <span aria-hidden="true">{ICONE_STATUS_SOCIAL[gamificacao.statusSocial]}</span>
                {NOME_STATUS_SOCIAL[gamificacao.statusSocial]}
              </span>
            </section>
          )}

          {momentos.length > 0 && (
            <section className="cf-ranking-momentos" aria-label="Suas novidades no Ranking">
              {focoAtual && <>
                <div className="cf-ranking-momentos-head"><span>SEU FOCO AGORA</span></div>
                <button type="button" className={`cf-ranking-momento-teaser cf-ranking-momento-${focoAtual.id}`} onClick={() => abrirMomento(focoAtual.id)}>
                  <span className="cf-ranking-momento-icon" aria-hidden="true">{focoAtual.simbolo}</span>
                  <span className="cf-ranking-momento-words"><small>{focoAtual.eyebrow}</small><strong>{focoAtual.titulo}</strong><span>{focoAtual.resumo}</span></span>
                  <span className="cf-ranking-momento-arrow" aria-hidden="true">↗</span>
                </button>
              </>}
              {outrosMomentos.length > 0 && <details className="cf-ranking-momentos-outros"><summary>Outras informações do Ranking</summary>
                {outrosMomentos.map((momento) => <button key={momento.id} type="button" className={`cf-ranking-momento-teaser cf-ranking-momento-${momento.id}`} onClick={() => abrirMomento(momento.id)}>
                  <span className="cf-ranking-momento-icon" aria-hidden="true">{momento.simbolo}</span>
                  <span className="cf-ranking-momento-words"><small>{momento.eyebrow}</small><strong>{momento.titulo}</strong><span>{momento.resumo}</span></span>
                  <span className="cf-ranking-momento-arrow" aria-hidden="true">↗</span>
                </button>)}
              </details>}
            </section>
          )}

        </section>
      ) : (
        <section className="cf-ranking-list" aria-label="Lista de posições">
          {linhas.length === 0 ? <p className="cf-ranking-empty">Sua posição ainda não apareceu no ranking desta temporada.</p> : linhas.map((entrada) => (
            <div key={entrada.posicao} className={`cf-ranking-row ${entrada.eVoce ? 'voce' : ''}`}>
              <strong>{entrada.posicao}</strong>
              <span className="cf-ranking-row-avatar">{avatarSeguro(entrada) ?? <Star size={15} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />}</span>
              <span className="cf-ranking-row-name">
                {nomeSeguro(entrada)} {seloSocialCompacto(statusSocialDaLinha(entrada))}
                {entrada.eVoce && seloVariacao(variacaoDaAba)}
                {entrada.telefoneMascarado && <small>{entrada.telefoneMascarado}</small>}
              </span>
              <b>{scoreSeguro(entrada.score)}</b>
            </div>
          ))}
          {aba === 'participantes' && <p className="cf-ranking-footnote">Mostrando posições próximas a você. “Participante” aparece quando a pessoa ainda não autorizou exibir o primeiro nome.</p>}
          {aba === 'geral' && <p className="cf-ranking-footnote">Só quem ativou o Ranking participa da disputa.</p>}
        </section>
      )}

      {aba === 'minha' && <details className="cf-ranking-privacy">
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Privacidade e participação</summary>
        <p>Você pode disputar anonimamente. Seu nome e telefone só aparecem se você permitir abaixo.</p>
        {privacidadeCarregando && <p>Carregando escolhas…</p>}
        {!privacidadeCarregando && privacidade?.finalidades.filter((item) => item.disponivel && item.texto && item.textoVersao).map((item) => (
          <label key={item.finalidade}>
            <input type="checkbox" checked={item.estado === 'concedido'} disabled={privacidadeSalvando !== null}
              onChange={(event) => onAlterarPrivacidade(item.finalidade, event.target.checked ? 'concedido' : 'revogado', item.textoVersao)} />
            <span>{item.texto}</span>
          </label>
        ))}
        <button type="button" disabled={privacidadeSalvando !== null} onClick={onRevogarTodas}>
          {privacidadeSalvando === 'todas' ? 'Saindo…' : 'Sair do Ranking e remover autorizações'}
        </button>
        {privacidadeErro && <p role="alert">{privacidadeErro}</p>}
      </details>}

      {sheetSubirAberto && (
        <div className="cf-ranking-sheet-backdrop" role="presentation" onClick={() => setSheetSubirAberto(false)}>
          <div className="cf-ranking-sheet" role="dialog" aria-modal="true" aria-label="Como subir no ranking" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="cf-ranking-sheet-close" aria-label="Fechar" onClick={() => setSheetSubirAberto(false)}>×</button>
            <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Como subir</h2>
            <p style={{ margin: '0 0 4px', color: '#697588', fontSize: 13, lineHeight: 1.4 }}>
              {mensagemMissao ?? 'Continue acumulando estrelas para subir de posição.'}
            </p>
            <div className="cf-ranking-sheet-row">
              <span><strong>Fazer um novo pedido</strong><small>Pedidos elegíveis entregues contam na temporada.</small></span>
              <button
                type="button"
                className="cf-ranking-sheet-action"
                onClick={() => { setSheetSubirAberto(false); onNovoPedido?.() }}
              >
                Pedir
              </button>
            </div>
            {indicacao?.ativa && (
              <div className="cf-ranking-sheet-row">
                <span>
                  <strong>Indicar um amigo</strong>
                  <small>
                    {!compartilhamentoLiberado
                      ? 'Faça seu primeiro pedido para liberar os convites.'
                      : gamificacao?.missaoIndicacao?.concluida
                      ? '✓ Missão da temporada já concluída.'
                      : indicacao.estrelasPrimeiraCompra
                        ? `+${indicacao.estrelasPrimeiraCompra} Estrelas na primeira compra dele.`
                        : 'Estrelas na primeira compra dele.'}
                  </small>
                </span>
                <button
                  type="button"
                  className="cf-ranking-sheet-action"
                  disabled={indicando}
                  onClick={() => {
                    if (!compartilhamentoLiberado) {
                      setSheetSubirAberto(false)
                      onNovoPedido?.()
                      return
                    }
                    emit('indicacao_clicada'); onIndicarAmigo?.()
                  }}
                >
                  {indicando ? 'Aguarde…' : compartilhamentoLiberado ? 'Indicar' : 'Fazer primeiro pedido'}
                </button>
              </div>
            )}
            <div className="cf-ranking-sheet-row">
              <span><strong>Ver minhas Estrelas</strong><small>Volte para o resumo da fidelidade.</small></span>
              <button type="button" className="cf-ranking-sheet-action" onClick={() => { setSheetSubirAberto(false); onClose() }}>Ver</button>
            </div>
          </div>
        </div>
      )}

      {momentoAtual && podeCriarPortal && createPortal(
        <div className={`cf-ranking-momento-backdrop cf-ranking-momento-backdrop-${momentoAtual.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setMomentoAberto(null) }}>
          <div ref={momentoDialogRef} className="cf-ranking-momento-dialog" role="dialog" aria-modal="true" aria-labelledby="cf-ranking-momento-title" tabIndex={-1}>
            <button type="button" className="cf-ranking-momento-close" aria-label="Fechar e voltar ao ranking" onClick={() => setMomentoAberto(null)}>×</button>
            <div className="cf-ranking-momento-emblem" aria-hidden="true">{momentoAtual.simbolo}</div>
            <span className="cf-ranking-momento-kicker">{momentoAtual.eyebrow}</span>
            <h2 id="cf-ranking-momento-title">{momentoAtual.titulo}</h2>
            <div className="cf-ranking-momento-detail">
              {momentoAberto === 'conquista' && conquista && (
                <>
                  <p className="cf-ranking-momento-lead">{textoConquistaRanking(conquista, ranking.participantes.posicao ?? ranking.posicao)}</p>
                  {podeCompartilharConquista && <p>Você pode convidar alguém conhecido para conhecer o ChefeBot e fortalecer sua posição.</p>}
                  {!compartilhamentoLiberado && <p className="cf-ranking-momento-notice">Convites bloqueados. Faça seu primeiro pedido confirmado para liberar o compartilhamento.</p>}
                </>
              )}
              {momentoAberto === 'nivel' && gamificacao?.nivelChef && (
                <>
                  <p className="cf-ranking-momento-lead">{gamificacao.nivelChef.xpAtual} XP{gamificacao.nivelChef.xpProximoNivel !== null ? ` / ${gamificacao.nivelChef.xpProximoNivel} XP` : ''}</p>
                  <div className="cf-ranking-nivel-bar" role="progressbar" aria-label="Progresso do Nível de Chef" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nivelProgressoPercent}><div className="cf-ranking-nivel-fill" style={{ width: `${nivelProgressoPercent}%` }} /></div>
                  <p>{gamificacao.nivelChef.xpProximoNivel === null ? 'Nível máximo atingido.' : `Faltam ${Math.max(0, gamificacao.nivelChef.xpProximoNivel - gamificacao.nivelChef.xpAtual)} XP para o próximo nível.`}</p>
                </>
              )}
              {momentoAberto === 'coroa' && <p className="cf-ranking-momento-lead">{mensagemMissao}</p>}
              {momentoAberto === 'indicacao' && gamificacao?.missaoIndicacao && (
                <>
                  <p className="cf-ranking-momento-lead">Indique 1 amigo — {gamificacao.missaoIndicacao.concluida ? '1/1 ✓ Concluída' : '0/1'}</p>
                  <p>{gamificacao.missaoIndicacao.concluida ? 'Sua missão desta temporada foi concluída.' : 'A missão avança quando a primeira compra elegível do amigo for confirmada.'}</p>
                  {!compartilhamentoLiberado && <p className="cf-ranking-momento-notice">Convites bloqueados. Faça seu primeiro pedido confirmado para liberar o compartilhamento.</p>}
                </>
              )}
              {momentoAberto === 'foto' && gamificacao?.missaoFotoPerfil && (
                <>
                  <p className="cf-ranking-momento-lead">
                    {gamificacao.missaoFotoPerfil.concluida
                      ? `Você já recebeu o bônus desta missão.`
                      : `Envie uma foto válida e ganhe +${gamificacao.missaoFotoPerfil.bonus} pontos no Ranking.`}
                  </p>
                  <p>A missão é única por cliente. A foto não aparece para outras pessoas automaticamente; isso depende da sua autorização de privacidade.</p>
                </>
              )}
              {momentoAberto === 'semanal' && (
                <>
                  <p className="cf-ranking-momento-lead">Seu próximo pedido vale 2x no Ranking desta temporada.</p>
                  <p>Suas Estrelas normais da Fidelidade continuam as mesmas — o bônus 2x conta só para a disputa desta temporada.</p>
                </>
              )}
              {momentoAberto === 'pedido' && posPedido && (
                <p className="cf-ranking-momento-lead">{posPedido.estado === 'pendente'
                  ? 'Seu pedido foi recebido. Quando as estrelas forem confirmadas, seu progresso será atualizado.'
                  : mensagemMov ?? (mensagemMissao ? `Agora você está em #${ranking.participantes.posicao ?? ranking.posicao}. ${mensagemMissao}` : `Agora você está em #${ranking.participantes.posicao ?? ranking.posicao}.`)}</p>
              )}
            </div>
            <div className="cf-ranking-momento-actions">
              {momentoAberto === 'conquista' && podeCompartilharConquista && (
                <button type="button" className="cf-ranking-momento-primary" disabled={compartilhando} onClick={() => { setMomentoAberto(null); emit('compartilhamento_clicado'); onCompartilharConquista?.() }}>{compartilhando ? 'Preparando…' : 'Fortalecer minha posição'}</button>
              )}
              {momentoAberto === 'indicacao' && !gamificacao?.missaoIndicacao?.concluida && indicacao?.ativa && (compartilhamentoLiberado ? !!onIndicarAmigo : !!onNovoPedido) && (
                <button type="button" className="cf-ranking-momento-primary" disabled={indicando} onClick={() => {
                  setMomentoAberto(null)
                  if (!compartilhamentoLiberado) onNovoPedido?.()
                  else { emit('indicacao_clicada'); onIndicarAmigo?.() }
                }}>{compartilhamentoLiberado ? 'Convidar um amigo' : 'Fazer primeiro pedido'}</button>
              )}
              {momentoAberto === 'foto' && gamificacao?.missaoFotoPerfil && !gamificacao.missaoFotoPerfil.concluida && onAdicionarFoto && (
                <button type="button" className="cf-ranking-momento-primary" disabled={fotoEnviando} onClick={() => {
                  setMomentoAberto(null)
                  onAdicionarFoto()
                }}>{fotoEnviando ? 'Preparando foto…' : `Adicionar foto e ganhar +${gamificacao.missaoFotoPerfil.bonus}`}</button>
              )}
              {momentoAberto === 'semanal' && onNovoPedido && <button type="button" className="cf-ranking-momento-primary" onClick={() => { setMomentoAberto(null); onNovoPedido() }}>Fazer pedido</button>}
              {momentoAberto === 'coroa' && gamificacao?.coroaAmeacada && <button type="button" className="cf-ranking-momento-primary" onClick={() => { setMomentoAberto(null); setSheetSubirAberto(true) }}>Ver como subir</button>}
              <button type="button" className="cf-ranking-momento-secondary" onClick={() => setMomentoAberto(null)}>Voltar ao ranking</button>
            </div>
          </div>
        </div>, document.body,
      )}

      <style>{`
        .cf-ranking-screen { width: 100%; max-width: 720px; margin: -4px auto 0; color: #1e2a3b; }
        .cf-ranking-header { display: grid; grid-template-columns: 52px 1fr auto; align-items: start; gap: 8px; margin-bottom: 16px; }
        .cf-ranking-header>button { width: 48px; height: 48px; border: 0; border-radius: 50%; background: rgba(255,255,255,.9); color: #182337; font-size: 39px; line-height: 38px; cursor: pointer; box-shadow: 0 8px 20px rgba(39,68,100,.08); }
        .cf-ranking-header h1 { margin: 4px 0 3px; font-size: 28px; line-height: 1.1; letter-spacing: -.7px; text-align: center; }
        .cf-ranking-header p { margin: 0; color: #6c7788; font-size: 12.5px; text-align: center; white-space: nowrap; }
        .cf-ranking-season { min-width: 112px; padding: 10px 11px; border: 1px solid rgba(216,170,44,.25); border-radius: 22px; background: rgba(255,250,235,.92); color: #9c6a0b; font-size: 10px; }
        .cf-ranking-season strong,.cf-ranking-season small { display: block; white-space: nowrap; }.cf-ranking-season small { color: #667284; font-size: 11px; margin-top: 3px; }
        .cf-ranking-podium { display: grid; grid-template-columns: 1fr 1.18fr 1fr; align-items: end; gap: 5px; min-height: 220px; padding: 18px 5px 0; border-radius: 24px 24px 0 0; background: radial-gradient(circle at 50% 25%, rgba(255,230,131,.6), transparent 45%), linear-gradient(180deg, rgba(255,250,237,.88), rgba(255,255,255,.58)); }
        .cf-ranking-podium-item { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-width: 0; padding: 0 4px 15px; border-radius: 18px 18px 0 0; background: linear-gradient(180deg, rgba(255,255,255,.84), rgba(244,247,250,.96)); box-shadow: 0 -2px 12px rgba(88,111,137,.08); text-align: center; }
        .cf-ranking-podium-1 { min-height: 180px; background: linear-gradient(180deg, rgba(255,243,176,.95), rgba(255,255,255,.96)); }.cf-ranking-podium-2,.cf-ranking-podium-3 { min-height: 145px; }
        .cf-ranking-medal { width: 28px; height: 28px; margin-top: -14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #e1e8ef; color: #4f5d70; font-weight: 800; box-shadow: 0 2px 0 rgba(41,59,82,.15); }.cf-ranking-podium-1 .cf-ranking-medal { background: #f5bd20; color: #8a5c00; }.cf-ranking-podium-3 .cf-ranking-medal { background: #e6b58b; color: #7b4322; }
        .cf-ranking-avatar { width: 56px; height: 56px; margin: 6px 0 6px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid #c9d4df; background: #f5f8fb; color: #53647a; font-size: 18px; font-weight: 800; }.cf-ranking-podium-1 .cf-ranking-avatar { width: 70px; height: 70px; border-color: #f1b92e; background: #fff3c4; color: #9d6900; }.cf-ranking-podium-3 .cf-ranking-avatar { border-color: #dda16e; }
        .cf-ranking-podium-item strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }.cf-ranking-podium-item b { margin-top: 4px; color: #ae7109; font-size: 11px; }
        .cf-ranking-current { display: grid; grid-template-columns: .78fr 1.15fr 1.15fr; align-items: center; gap: 10px; margin: 14px 0; padding: 16px 15px; border: 1px solid rgba(107,164,245,.32); border-radius: 22px; background: linear-gradient(110deg, rgba(247,252,255,.98), rgba(230,243,255,.95)); box-shadow: 0 10px 22px rgba(62,117,180,.08); }
        .cf-ranking-current small { display: block; color: #69798d; font-size: 10px; line-height: 1.25; }.cf-ranking-current>div>strong { display: block; margin-top: 3px; color: #17263d; font-size: 30px; line-height: 1; }.cf-ranking-current-user { display: flex; align-items: center; gap: 8px; border-left: 1px solid rgba(88,133,192,.22); border-right: 1px solid rgba(88,133,192,.22); padding: 0 8px; }.cf-ranking-current-user>span { width: 37px; height: 37px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #4f86ed; color: white; font-weight: 800; }.cf-ranking-current-user b { display: flex; flex-direction: column; font-size: 14px; }.cf-ranking-current-user em { margin-top: 3px; color: #b27108; font-size: 11px; font-style: normal; white-space: nowrap; }.cf-ranking-current>div:last-child strong { font-size: 15px; color: #40536f; line-height:1.3; }
        .cf-ranking-tabs { display: grid; grid-template-columns: repeat(3,1fr); gap: 2px; margin: 17px 0 11px; padding: 3px; border-radius: 24px; background: rgba(222,227,234,.75); }.cf-ranking-tabs button { min-height: 39px; border: 0; border-radius: 21px; background: transparent; color: #687488; font: 700 12px inherit; cursor: pointer; }.cf-ranking-tabs button.ativo { color: #1f63d6; background: rgba(255,255,255,.98); box-shadow: 0 3px 10px rgba(48,75,108,.1); }
        .cf-ranking-list { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; }.cf-ranking-row { display: grid; grid-template-columns: 30px 34px 1fr auto; align-items: center; gap: 7px; min-height: 48px; padding: 6px 11px; border: 1px solid rgba(255,255,255,.85); border-radius: 24px; background: rgba(255,255,255,.84); box-shadow: 0 5px 14px rgba(58,78,101,.05); }.cf-ranking-row.voce { border-color: rgba(88,151,247,.4); background: linear-gradient(90deg, rgba(234,244,255,.98), rgba(248,252,255,.9)); }.cf-ranking-row>strong { font-size: 17px; text-align: center; }.cf-ranking-row-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #e8eef5; color: #61738a; font-size: 12px; font-weight: 800; }.cf-ranking-row.voce .cf-ranking-row-avatar { background: #4f86ed; color: #fff; }.cf-ranking-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.cf-ranking-row-name small{display:block;margin-top:2px;color:#758296;font-size:10px}.cf-ranking-row>b { color: #ae7109; font-size: 12px; white-space: nowrap; }.cf-ranking-empty,.cf-ranking-footnote { margin: 7px 2px; color: #6d7a8c; font-size: 12px; line-height: 1.45; text-align: center; }
        .cf-ranking-note { display: flex; gap: 12px; align-items: center; margin-top: 17px; padding: 14px 15px; border: 1px solid rgba(226,180,55,.38); border-radius: 18px; background: linear-gradient(110deg, rgba(255,252,239,.96), rgba(255,247,218,.75)); }.cf-ranking-note>span { font-size: 25px; }.cf-ranking-note strong { font-size: 13px; display: block; }.cf-ranking-note p { margin: 4px 0 0; color: #697588; font-size: 11.5px; line-height: 1.35; }
        .cf-ranking-name-optin{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0;padding:12px 13px;border:1px solid rgba(79,134,237,.2);border-radius:16px;background:rgba(239,246,255,.78)}.cf-ranking-name-optin span{display:grid;gap:3px}.cf-ranking-name-optin strong{font-size:12.5px;color:#304d77}.cf-ranking-name-optin small{font-size:10.5px;color:#718199;line-height:1.35}.cf-ranking-name-optin button{border:0;border-radius:999px;padding:8px 11px;background:#4f86ed;color:#fff;font-size:10.5px;font-weight:800;white-space:nowrap;cursor:pointer}.cf-ranking-name-optin button:disabled{opacity:.55;cursor:wait}
        .cf-ranking-share-locked { display: grid; gap: 3px; margin-top: 10px; padding: 9px 11px; border: 1px solid rgba(180,196,220,.75); border-radius: 12px; background: rgba(247,250,255,.8); color: #52657f; }.cf-ranking-share-locked strong { color: #304d77; font-size: 12px; }.cf-ranking-share-locked small { font-size: 11px; line-height: 1.35; }
        .cf-ranking-selos { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin: 0 0 12px; }
        .cf-ranking-selo { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 800; background: #eef1f5; color: #4a5568; }
        .cf-ranking-selo-campeao { background: linear-gradient(110deg, #fff3c4, #ffe08a); color: #8a5c00; }
        .cf-ranking-selo-prata { background: linear-gradient(110deg, #eef2f6, #d9e1e8); color: #4a5568; }
        .cf-ranking-selo-bronze { background: linear-gradient(110deg, #f3ded0, #e6b58b); color: #7b4322; }
        .cf-ranking-selo-elite { background: linear-gradient(110deg, #e7f0ff, #d5e6ff); color: #2a548f; }
        .cf-ranking-selo-mini { display: inline-flex; align-items: center; justify-content: center; font-size: 12px; margin-left: 2px; vertical-align: middle; }
        .cf-ranking-missao { border-color: rgba(88,151,247,.4); background: linear-gradient(110deg, rgba(234,244,255,.98), rgba(248,252,255,.9)); }
        .cf-ranking-note small { display: block; margin-top: 4px; color: #8a95a6; font-size: 10.5px; line-height: 1.35; }
        .cf-ranking-coroa { border-color: rgba(245,189,32,.5); background: linear-gradient(110deg, rgba(255,248,225,.98), rgba(255,255,255,.9)); }
        .cf-ranking-coroa-ameacada { border-color: rgba(224,62,62,.45); background: linear-gradient(110deg, rgba(255,235,235,.98), rgba(255,247,247,.9)); }
        .cf-ranking-coroa-ameacada strong { color: #b52020; }
        .cf-ranking-nivel { margin-top: 14px; padding: 14px 15px; border: 1px solid rgba(16,25,58,.12); border-radius: 18px; background: rgba(255,255,255,.85); }
        .cf-ranking-nivel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .cf-ranking-nivel-head strong { font-size: 13px; }
        .cf-ranking-nivel-head span { font-size: 11px; color: #697588; white-space: nowrap; }
        .cf-ranking-nivel-bar { margin-top: 8px; height: 8px; border-radius: 999px; background: #eef1f5; overflow: hidden; }
        .cf-ranking-nivel-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #ffcd00, #ffe08a); }
        .cf-ranking-nivel small { display: block; margin-top: 6px; color: #8a95a6; font-size: 10.5px; }
        .cf-ranking-movimento-recente { margin: -8px 0 12px; color: #697588; font-size: 11.5px; text-align: center; }
        .cf-ranking-share-card { display: flex; gap: 12px; align-items: flex-start; margin-top: 17px; padding: 15px; border: 1px solid rgba(79,134,237,.34); border-radius: 19px; background: linear-gradient(115deg, rgba(239,247,255,.98), rgba(255,252,239,.96)); }
        .cf-ranking-share-mark { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 12px; background: #fff; font-size: 19px; box-shadow: 0 4px 10px rgba(58,91,132,.1); }
        .cf-ranking-share-copy { min-width: 0; }
        .cf-ranking-share-copy>small { display: block; color: #3972d7; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
        .cf-ranking-share-copy>strong { display: block; margin-top: 3px; font-size: 13px; line-height: 1.35; }
        .cf-ranking-share-copy>p { margin: 5px 0 0; color: #5f6f84; font-size: 11.5px; line-height: 1.4; }
        .cf-ranking-share-btn { margin-top: 10px; padding: 9px 14px; border: 0; border-radius: 12px; background: #4f86ed; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; }.cf-ranking-share-btn:disabled { opacity: .6; cursor: wait; }
        .cf-ranking-cta-primary { display: block; width: 100%; min-height: 46px; margin: 0 0 14px; border: 0; border-radius: 13px; background: #ffc900; color: #252a30; font-weight: 700; font-size: 14.5px; cursor: pointer; }
        .cf-ranking-sheet-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; padding: 18px; background: rgba(20,27,37,.38); }
        .cf-ranking-sheet { position: relative; width: 100%; max-width: 390px; max-height: min(560px, 80dvh); overflow: auto; box-sizing: border-box; padding: 24px 20px 20px; border-radius: 22px; background: #fff; color: #414851; box-shadow: 0 24px 60px rgba(0,0,0,.22); }
        .cf-ranking-sheet-close { position: absolute; top: 8px; right: 12px; border: 0; background: none; color: #7b8490; font-size: 28px; line-height: 1; cursor: pointer; }
        .cf-ranking-sheet-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid #edf0f4; font-size: 13px; }
        .cf-ranking-sheet-row span { display: flex; flex-direction: column; gap: 4px; }
        .cf-ranking-sheet-row small { color: #7b8490; font-size: 11px; }
        .cf-ranking-sheet-action { flex: none; padding: 9px 14px; border: 0; border-radius: 12px; background: #ffc900; color: #252a30; font-weight: 700; font-size: 12.5px; cursor: pointer; white-space: nowrap; }.cf-ranking-sheet-action:disabled { opacity: .6; cursor: wait; }
        .cf-ranking-header h1 { font-size: 23px; }
        .cf-ranking-header p { white-space: normal; line-height: 1.4; }
        .cf-ranking-current { grid-template-columns: minmax(110px, .75fr) 1fr; background: #fff; box-shadow: none; border-color: #d9e3ef; }
        .cf-ranking-current>div>strong { font-size: 38px; }
        .cf-ranking-current>div>span { display: block; margin-top: 7px; color: #53657e; font-size: 13px; }
        .cf-ranking-current-goal { border-left: 1px solid #d9e3ef; padding-left: 16px; }
        .cf-ranking-current .cf-ranking-current-goal strong { font-size: 15px; line-height: 1.35; }
        .cf-ranking-momentos { display: grid; gap: 8px; margin: 22px 0 16px; }
        .cf-ranking-momentos-head { display: flex; justify-content: space-between; align-items: center; padding: 0 3px 3px; color: #304562; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
        .cf-ranking-momentos-head small { color: #6d7a8c; font-size: 11px; font-weight: 500; letter-spacing: 0; }
        .cf-ranking-momento-teaser { display: flex; align-items: center; gap: 13px; width: 100%; min-height: 72px; padding: 12px 15px; border: 1px solid #d9e3ef; border-radius: 17px; background: #fff; color: #17263d; text-align: left; cursor: pointer; transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease; }
        .cf-ranking-momento-teaser:hover { transform: translateY(-2px); border-color: #8eb4f3; box-shadow: 0 12px 24px rgba(31,66,112,.1); }
        .cf-ranking-momento-teaser:focus-visible, .cf-ranking-momento-close:focus-visible, .cf-ranking-momento-actions button:focus-visible { outline: 3px solid #306cce; outline-offset: 3px; }
        .cf-ranking-momento-semanal, .cf-ranking-momento-coroa { background: #fffcf3; border-color: #f0dfa8; }
        .cf-ranking-momento-conquista { background: #f5f9ff; border-color: #b5cef4; }
        .cf-ranking-momento-icon { display: grid; flex: none; place-items: center; width: 42px; height: 42px; border-radius: 13px; background: #e9f1ff; color: #2860ba; font-size: 24px; font-weight: 800; }
        .cf-ranking-momento-semanal .cf-ranking-momento-icon, .cf-ranking-momento-coroa .cf-ranking-momento-icon { color: #8b5e00; background: #ffefb3; }
        .cf-ranking-momento-words { display: grid; gap: 2px; min-width: 0; flex: 1; }
        .cf-ranking-momento-words small { color: #4a70a8; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
        .cf-ranking-momento-words strong { font-size: 15px; line-height: 1.2; letter-spacing: -.02em; }
        .cf-ranking-momento-words>span { color: #5b6b80; font-size: 12px; line-height: 1.35; }
        .cf-ranking-momento-arrow { align-self: center; color: #58759d; font-size: 22px; }
        .cf-ranking-momento-backdrop { position: fixed; inset: 0; z-index: 500; display: grid; place-items: center; padding: 20px; background: rgba(11,27,49,.92); animation: cf-momento-fundo .28s ease-out both; }
        .cf-ranking-momento-dialog { position: relative; display: flex; flex-direction: column; width: min(100%, 550px); max-height: min(760px, 94dvh); overflow-y: auto; box-sizing: border-box; padding: clamp(28px, 5vw, 48px); border-radius: 28px; background: #fffdf7; color: #142640; box-shadow: 0 36px 100px rgba(0,0,0,.32); outline: none; animation: cf-momento-entrada .5s cubic-bezier(.17,.85,.24,1) both; }
        .cf-ranking-momento-close { position: absolute; top: 18px; right: 20px; display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid #d9e3ef; border-radius: 50%; background: #fff; color: #283c59; font-size: 28px; line-height: 1; cursor: pointer; }
        .cf-ranking-momento-emblem { display: grid; place-items: center; width: 90px; height: 90px; margin: 24px 0 26px; border: 2px solid #b6d0f7; border-radius: 26px; background: #eaf3ff; color: #2860ba; font-size: 54px; font-weight: 800; animation: cf-momento-emblema .8s .12s cubic-bezier(.18,.89,.32,1.25) both; }
        .cf-ranking-momento-kicker { color: #3265af; font-size: 11px; font-weight: 850; letter-spacing: .16em; }
        .cf-ranking-momento-dialog h2 { max-width: 440px; margin: 9px 0 0; font-size: clamp(32px, 7vw, 52px); line-height: 1.04; letter-spacing: -.055em; font-weight: 850; }
        .cf-ranking-momento-detail { margin: 24px 0 0; padding-top: 20px; border-top: 1px solid #d9e3ef; }
        .cf-ranking-momento-detail p { margin: 0 0 12px; color: #4b5b70; font-size: 15px; line-height: 1.55; }
        .cf-ranking-momento-detail .cf-ranking-momento-lead { color: #203854; font-size: 20px; line-height: 1.34; font-weight: 700; letter-spacing: -.02em; }
        .cf-ranking-momento-detail .cf-ranking-momento-notice { padding: 12px 14px; border-radius: 12px; background: #eef4fd; color: #365276; font-size: 13px; }
        .cf-ranking-momento-detail .cf-ranking-nivel-bar { height: 12px; margin: 13px 0 16px; }
        .cf-ranking-momento-detail .cf-ranking-nivel-fill { transform-origin: left; animation: cf-momento-progresso 1s .25s ease-out both; }
        .cf-ranking-momento-actions { display: grid; gap: 9px; margin-top: 20px; }
        .cf-ranking-momento-actions button { min-height: 49px; padding: 10px 16px; border-radius: 13px; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
        .cf-ranking-momento-actions .cf-ranking-momento-primary { border: 0; background: #ffca00; color: #202a38; }
        .cf-ranking-momento-actions .cf-ranking-momento-secondary { border: 1px solid #d9e3ef; background: #fff; color: #315275; }
        .cf-ranking-momento-actions button:disabled { opacity: .55; cursor: wait; }
        .cf-ranking-momentos-outros { margin-top: 5px; }
        .cf-ranking-momentos-outros summary { padding: 10px 2px; color: #536b89; font-size: 12px; font-weight: 700; cursor: pointer; }
        .cf-ranking-momentos-outros .cf-ranking-momento-teaser { margin-top: 8px; }
        .cf-ranking-momento-backdrop-semanal .cf-ranking-momento-emblem, .cf-ranking-momento-backdrop-coroa .cf-ranking-momento-emblem { border-color: #edcd66; background: #fff1b7; color: #9b6b00; }
        .cf-ranking-momento-backdrop-conquista .cf-ranking-momento-emblem { animation-name: cf-momento-conquista; }
        .cf-ranking-momento-backdrop-pedido .cf-ranking-momento-emblem { animation-name: cf-momento-pedido; }
        .cf-ranking-momento-backdrop-coroa .cf-ranking-momento-emblem { animation-name: cf-momento-coroa; }
        .cf-ranking-momento-backdrop-semanal .cf-ranking-momento-emblem, .cf-ranking-momento-backdrop-indicacao .cf-ranking-momento-emblem { animation-name: cf-momento-deslize; }
        @keyframes cf-momento-fundo { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cf-momento-entrada { from { opacity: 0; transform: translateY(30px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes cf-momento-emblema { from { opacity: 0; transform: scale(.65) rotate(-10deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
        @keyframes cf-momento-conquista { from { opacity: 0; transform: scale(.5) rotate(-25deg); } 70% { transform: scale(1.12) rotate(4deg); } to { opacity: 1; transform: scale(1); } }
        @keyframes cf-momento-pedido { from { opacity: 0; transform: scale(.65); } 60% { transform: scale(1.1); } to { opacity: 1; transform: scale(1); } }
        @keyframes cf-momento-coroa { from { opacity: 0; transform: translateY(-25px) rotate(-12deg); } to { opacity: 1; transform: translateY(0) rotate(0); } }
        @keyframes cf-momento-deslize { from { opacity: 0; transform: translateX(-35px) rotate(-8deg); } to { opacity: 1; transform: translateX(0) rotate(0); } }
        @keyframes cf-momento-progresso { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @media (max-width: 600px) { .cf-ranking-momento-backdrop { padding: 0; }.cf-ranking-momento-dialog { width: 100%; max-height: 100dvh; min-height: 100dvh; border-radius: 0; padding: max(30px, env(safe-area-inset-top)) 25px max(28px, env(safe-area-inset-bottom)); }.cf-ranking-momento-emblem { margin-top: clamp(30px, 10dvh, 90px); }.cf-ranking-momento-actions { margin-top: auto; padding-top: 24px; } }
        @media (prefers-reduced-motion: reduce) { .cf-ranking-momento-backdrop, .cf-ranking-momento-dialog, .cf-ranking-momento-emblem, .cf-ranking-momento-detail .cf-ranking-nivel-fill { animation: none !important; }.cf-ranking-momento-teaser { transition: none; } }
        @media (prefers-reduced-motion: reduce) { .cf-ranking-screen * { transition: none !important; } }
        @media (max-width: 420px) {
          .cf-ranking-current { grid-template-columns: minmax(100px, .75fr) 1fr; gap: 8px; padding: 14px 12px; border-radius: 17px; }
          .cf-ranking-current>div>strong { font-size: 32px; }
          .cf-ranking-current .cf-ranking-current-goal strong { font-size: 13px; }
          .cf-ranking-current-goal { padding-left: 11px; }
          .cf-ranking-season { min-width: 98px; padding: 8px 9px; border-radius: 16px; font-size: 10px; }.cf-ranking-season small { font-size: 11px; margin-top: 2px; }
        }
      `}</style>
    </main>
  )
}
