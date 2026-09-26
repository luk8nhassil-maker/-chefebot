'use client'

// Tela cheia do Ranking do Chefe para quem JÁ participa. Extraído de
// cliente/page.tsx (que crescia demais) para um módulo dedicado — mesmo
// comportamento e tipos, reaproveitado tanto pela página real quanto pelo
// Preview isolado (/dev/ranking-retencao), que importa este mesmo arquivo.
import { useEffect, useState } from 'react'
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
  onNovoPedido,
  onTelemetria,
  onClose,
}: FidelidadeRankingScreenProps) {
  const [aba, setAba] = useState<'participantes' | 'minha' | 'geral'>('participantes')
  const [sheetSubirAberto, setSheetSubirAberto] = useState(false)
  const emit = (tipo: EventoRankingRetencao) => onTelemetria?.(tipo)
  const lista = [...ranking.lista].sort((a, b) => a.posicao - b.posicao)
  const listaSemPodio = lista.filter((entrada) => entrada.posicao > 3)
  // Posição própria de quem "Vale prêmio": reindexada só entre participantes
  // pelo servidor (src/app/api/cliente/fidelidade/painel/route.ts), nunca a
  // posição do ranking geral — um participante pode estar no pódio aqui
  // mesmo fora do Top 3 geral, se os primeiros colocados não participarem.
  const participantes = [...ranking.participantes.lista].sort((a, b) => a.posicao - b.posicao)
  const podium = participantes.filter((entrada) => entrada.posicao <= 3)
  const linhas = aba === 'minha'
    ? lista.filter((entrada) => entrada.eVoce)
    : aba === 'geral' ? listaSemPodio : participantes.filter((entrada) => entrada.posicao > 3)
  const nomeSeguro = (entrada: { eVoce: boolean; participaCampanha: boolean; posicao: number; nomePublico?: string }) => {
    if (entrada.eVoce && !entrada.participaCampanha) return 'Você — não participa do prêmio'
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
  const podeCompartilharConquista = conquista !== null && !!onCompartilharConquista
  // Progresso absoluto (XP acumulado / XP do próximo nível) — nunca inventa
  // um "início de faixa" que o domínio (calcularNivelChef) não devolve; sem
  // próximo nível (nível máximo), a barra fica cheia.
  const nivelProgressoPercent = gamificacao?.nivelChef
    ? gamificacao.nivelChef.xpProximoNivel
      ? Math.max(0, Math.min(100, Math.round((gamificacao.nivelChef.xpAtual / gamificacao.nivelChef.xpProximoNivel) * 100)))
      : 100
    : 0

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
    <main className="cf-ranking-screen" aria-label="Pódio Chefe">
      <header className="cf-ranking-header">
        <button type="button" onClick={onClose} aria-label="Voltar para Fidelidade">‹</button>
        <div>
          <h1>Rank</h1>
          {/* Copy fail-closed (correção de blocker): "ganhe presentes" só
              quando existe um prêmio REAL aprovado e configurado pelo admin
              (temporada.premio, já fail-closed no servidor) — sem isso, a
              frase nunca promete um presente que pode não existir. */}
          <p>{temporada?.premio ? 'Suba com suas Estrelas e ganhe presentes.' : 'Suba com suas Estrelas e avance na temporada.'}</p>
        </div>
        {temporada && (
          <div className="cf-ranking-season">
            <strong>{temporada.diasRestantes === null ? 'Em andamento' : `${temporada.diasRestantes}d restantes`}</strong>
            <small>{temporada.premio ? (temporada.premio.descricao || 'Prêmio configurado') : (temporada.nome || 'Temporada atual')}</small>
          </div>
        )}
      </header>

      {gamificacao?.statusSocial && (
        <section className="cf-ranking-selos" aria-label="Seu status">
          <span className={`cf-ranking-selo cf-ranking-selo-${gamificacao.statusSocial}`}>
            <span aria-hidden="true">{ICONE_STATUS_SOCIAL[gamificacao.statusSocial]}</span>
            {NOME_STATUS_SOCIAL[gamificacao.statusSocial]}
          </span>
        </section>
      )}

      {gamificacao?.nivelChef && (
        <section className="cf-ranking-nivel" aria-label="Progresso de Nível de Chef">
          <div className="cf-ranking-nivel-head">
            <strong>Nível {gamificacao.nivelChef.nivel}{gamificacao.nivelChef.nome ? ` — ${gamificacao.nivelChef.nome}` : ''}</strong>
            <span>
              {gamificacao.nivelChef.xpAtual} XP
              {gamificacao.nivelChef.xpProximoNivel !== null ? ` / ${gamificacao.nivelChef.xpProximoNivel} XP` : ''}
            </span>
          </div>
          <div className="cf-ranking-nivel-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nivelProgressoPercent}>
            <div className="cf-ranking-nivel-fill" style={{ width: `${nivelProgressoPercent}%` }} />
          </div>
          <small>{gamificacao.nivelChef.xpProximoNivel === null ? 'Nível máximo atingido.' : `Faltam ${Math.max(0, gamificacao.nivelChef.xpProximoNivel - gamificacao.nivelChef.xpAtual)} XP para o próximo nível.`}</small>
        </section>
      )}

      {alvo?.estado === 'liderando' && (
        <section className={`cf-ranking-note cf-ranking-coroa${gamificacao?.coroaAmeacada ? ' cf-ranking-coroa-ameacada' : ''}`} aria-label="Defenda sua coroa">
          <span aria-hidden="true">👑</span>
          <div>
            <strong>{gamificacao?.coroaAmeacada ? 'Coroa ameaçada!' : 'Defenda sua coroa'}</strong>
            <p>{mensagemMissao}</p>
          </div>
        </section>
      )}

      {gamificacao?.missaoIndicacao && (
        <section className="cf-ranking-note cf-ranking-missao" aria-label="Missão de indicação da temporada">
          <span aria-hidden="true">🤝</span>
          <div>
            <strong>MISSÃO DA TEMPORADA</strong>
            <p>{gamificacao.missaoIndicacao.concluida ? 'Indique 1 amigo — 1/1 ✓ Concluída' : 'Indique 1 amigo — 0/1'}</p>
          </div>
        </section>
      )}

      {gamificacao?.missaoSemanal?.status === 'desbloqueada' && (
        <section className="cf-ranking-note cf-ranking-missao" aria-label="Missão semanal">
          <span aria-hidden="true">🎯</span>
          <div>
            <strong>Caçada ao Pódio liberada!</strong>
            <p>Seu próximo pedido vale 2x no Ranking desta temporada.</p>
            <small>Suas Estrelas normais da Fidelidade continuam as mesmas — o bônus 2x conta só para a disputa desta temporada.</small>
          </div>
        </section>
      )}

      {posPedido && (
        <section className="cf-ranking-note" aria-label="Resultado do pedido" style={{ marginTop: 0, marginBottom: 14 }}>
          <span aria-hidden="true">{posPedido.estado === 'creditado' ? '⭐' : '⏳'}</span>
          <div>
            {posPedido.estado === 'pendente' ? (
              <strong>Seu pedido foi recebido. Quando as estrelas forem confirmadas, seu progresso será atualizado.</strong>
            ) : (
              <>
                <strong>+{posPedido.estrelasGanhas ?? 0} estrelas</strong>
                <p>{mensagemMov ?? (mensagemMissao ? `Agora você está em #${ranking.participantes.posicao ?? ranking.posicao}. ${mensagemMissao}` : `Agora você está em #${ranking.participantes.posicao ?? ranking.posicao}.`)}</p>
              </>
            )}
          </div>
        </section>
      )}

      <section className="cf-ranking-current" aria-label="Seu status atual">
        <div><small>SUAS ESTRELAS</small><strong>{ranking.score}</strong></div>
        <div className="cf-ranking-current-user">
          <span aria-hidden="true">V</span>
          <b>Você<em>{ranking.participantes.variacaoPosicao && ranking.participantes.variacaoPosicao.direcao !== 'manteve'
            ? `${ranking.participantes.variacaoPosicao.direcao === 'subiu' ? '▲' : '▼'} ${ranking.participantes.variacaoPosicao.casas}`
            : '—'}</em></b>
        </div>
        <div><small>MISSÃO ATUAL</small><strong>{mensagemMissao ?? 'Continue acumulando estrelas.'}</strong></div>
      </section>

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
          Quero subir
        </button>
      )}

      {conquista && (
        <section className="cf-ranking-note" aria-label="Conquista recente">
          <span aria-hidden="true">🎉</span>
          <div>
            <strong>{textoConquistaRanking(conquista, ranking.participantes.posicao ?? ranking.posicao)}</strong>
            {podeCompartilharConquista && (
              <button
                type="button"
                className="cf-ranking-share-btn"
                disabled={compartilhando}
                onClick={() => { emit('compartilhamento_clicado'); onCompartilharConquista?.() }}
              >
                {compartilhando ? 'Preparando…' : 'Compartilhar'}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="cf-ranking-list" aria-label="Sua disputa agora">
        <p className="cf-ranking-footnote" style={{ marginTop: 0, fontWeight: 700, color: '#40536f' }}>SUA DISPUTA AGORA</p>
        {disputa ? (
          <>
            {disputa.acima && linhaDisputa(disputa.acima)}
            {linhaDisputa(disputa.voce)}
            {disputa.abaixo && linhaDisputa(disputa.abaixo)}
            {disputa.sozinho && <p className="cf-ranking-empty">Você é o único participante desta temporada até agora.</p>}
          </>
        ) : (
          <p className="cf-ranking-empty">Sua disputa aparece assim que você tiver uma posição entre participantes.</p>
        )}
      </section>

      <section className="cf-ranking-podium" aria-label="Melhores posições">
        {[2, 1, 3].map((posicao) => {
          const entrada = podium.find((item) => item.posicao === posicao)
          return (
            <div key={posicao} className={`cf-ranking-podium-item cf-ranking-podium-${posicao}`}>
              <div className="cf-ranking-medal">{posicao}</div>
              <div className="cf-ranking-avatar">{avatarSeguro(entrada) ?? <Star size={16} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />}</div>
              <strong>{entrada ? nomeSeguro(entrada) : `Posição ${posicao}`} {entrada && seloSocialCompacto(entrada.statusSocial)}</strong>
              <b>{entrada ? scoreSeguro(entrada.score) : 'Prêmio em breve'}</b>
            </div>
          )
        })}
      </section>

      <div className="cf-ranking-tabs" role="tablist" aria-label="Filtro do ranking">
        {([['participantes', 'Participando'], ['minha', 'Minha posição'], ['geral', 'Todos']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}>{label}</button>
        ))}
      </div>

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
        {aba === 'participantes' && <p className="cf-ranking-footnote">Mostrando posições próximas a você.</p>}
        {aba === 'geral' && <p className="cf-ranking-footnote">Quem não autorizou não concorre ao prêmio.</p>}
      </section>

      <section className="cf-ranking-note">
        <span>🏆</span>
        <div>
          <strong>{mensagemMov ?? 'Acumule estrelas para subir'}</strong>
          <p>{mensagemMissao ?? 'As estrelas desta temporada contam para sua posição.'}</p>
        </div>
      </section>

      {sheetSubirAberto && (
        <div className="cf-ranking-sheet-backdrop" role="presentation" onClick={() => setSheetSubirAberto(false)}>
          <div className="cf-ranking-sheet" role="dialog" aria-modal="true" aria-label="Como subir no ranking" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="cf-ranking-sheet-close" aria-label="Fechar" onClick={() => setSheetSubirAberto(false)}>×</button>
            <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Como subir</h2>
            <p style={{ margin: '0 0 4px', color: '#697588', fontSize: 13, lineHeight: 1.4 }}>
              {mensagemMissao ?? 'Continue acumulando estrelas para subir de posição.'}
            </p>
            <div className="cf-ranking-sheet-row">
              <span><strong>Fazer um novo pedido</strong><small>Cada pedido soma estrelas na temporada.</small></span>
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
                    {gamificacao?.missaoIndicacao?.concluida
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
                  onClick={() => { emit('indicacao_clicada'); onIndicarAmigo?.() }}
                >
                  {indicando ? 'Aguarde…' : 'Indicar'}
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
        .cf-ranking-share-btn { margin-top: 8px; padding: 8px 14px; border: 0; border-radius: 12px; background: #4f86ed; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; }.cf-ranking-share-btn:disabled { opacity: .6; cursor: wait; }
        .cf-ranking-cta-primary { display: block; width: 100%; min-height: 46px; margin: 0 0 14px; border: 0; border-radius: 13px; background: #ffc900; color: #252a30; font-weight: 700; font-size: 14.5px; cursor: pointer; }
        .cf-ranking-sheet-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; padding: 18px; background: rgba(20,27,37,.38); }
        .cf-ranking-sheet { position: relative; width: 100%; max-width: 390px; max-height: min(560px, 80dvh); overflow: auto; box-sizing: border-box; padding: 24px 20px 20px; border-radius: 22px; background: #fff; color: #414851; box-shadow: 0 24px 60px rgba(0,0,0,.22); }
        .cf-ranking-sheet-close { position: absolute; top: 8px; right: 12px; border: 0; background: none; color: #7b8490; font-size: 28px; line-height: 1; cursor: pointer; }
        .cf-ranking-sheet-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid #edf0f4; font-size: 13px; }
        .cf-ranking-sheet-row span { display: flex; flex-direction: column; gap: 4px; }
        .cf-ranking-sheet-row small { color: #7b8490; font-size: 11px; }
        .cf-ranking-sheet-action { flex: none; padding: 9px 14px; border: 0; border-radius: 12px; background: #ffc900; color: #252a30; font-weight: 700; font-size: 12.5px; cursor: pointer; white-space: nowrap; }.cf-ranking-sheet-action:disabled { opacity: .6; cursor: wait; }
        @media (prefers-reduced-motion: reduce) { .cf-ranking-screen * { transition: none !important; } }
        @media (max-width: 420px) {
          .cf-ranking-current { grid-template-columns: .72fr 1.08fr 1.2fr; gap: 7px; padding: 12px 11px; border-radius: 17px; }
          .cf-ranking-current small { font-size: 11px; }.cf-ranking-current>div>strong { font-size: 27px; }
          .cf-ranking-current-user { gap: 6px; padding: 0 6px; }.cf-ranking-current-user>span { width: 33px; height: 33px; }.cf-ranking-current-user b { font-size: 13px; }.cf-ranking-current-user em { font-size: 11px; }
          .cf-ranking-current>div:last-child strong { font-size: 13px; line-height: 1.15; }
          .cf-ranking-season { min-width: 98px; padding: 8px 9px; border-radius: 16px; font-size: 10px; }.cf-ranking-season small { font-size: 11px; margin-top: 2px; }
        }
      `}</style>
    </main>
  )
}
