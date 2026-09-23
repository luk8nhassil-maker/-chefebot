'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, Clock3, Gift, Info, List, Phone, MessageCircle, Receipt, ShieldCheck, Sparkles, Pizza, Trophy, Users, Star } from 'lucide-react'
import { calcularMissaoAtual } from '@/lib/missoes'
import ClientBottomNav from '@/components/ClientBottomNav'
import PixPendenteBar, { usePixPendente } from '@/components/PixPendenteBar'
import { CF_OPEN_CART_KEY } from '@/lib/pedidoAtivoCliente'
import { destinoNextPermitido } from '@/lib/clientePedidos'
import { fetchCliente, guardarSessaoFallback, limparSessaoFallback, telemetria } from '@/lib/clienteSessaoFront'

type Movimento = {
  id: string
  pedidoId: string | null
  tipo: string
  pontos: number
  descricao: string
  criadoEm: string
}

type Recompensa = { recompensaId: string; status: string; criadoEm: string; descricao: string }

type Jornada = {
  ativo: boolean
  metaPizzas: number
  pizzasNoCiclo: number
  faltam: number
  faseAtual: number
  mensagem: string
  totalJornadasConcluidas: number
  textos: { tituloTrilha: string; subtituloTrilha: string }
  caixasFechadas: { recompensaId: string }[]
}

type Fidelidade = {
  ativo: boolean
  unidade?: 'pontos' | 'estrelas'
  descricaoRecompensa: string
  saldoPontos: number
  pontosPrevistos: number
  metaPontos: number
  pontosFaltantes: number
  progressoPercentual: number
  metaAtingida: boolean
  extrato: Movimento[]
  recompensas: Recompensa[]
}

type PainelFidelidade = {
  temporada: {
    nome: string | null
    diasRestantes: number | null
    fimEm: string | null
    estado: string
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
  } | null
}

type FinalidadePrivacidadeRanking = 'ranking_primeiro_nome' | 'ranking_telefone_mascarado' | 'ranking_foto_perfil'

type PreferenciasPrivacidadeRanking = {
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

type PedidoResumo = {
  id: string
  numero?: number
  data?: string
  total?: number
  status?: string
}

type Perfil = {
  cliente: { nome: string | null; telefone: string }
  ultimosPedidos: PedidoResumo[]
}

function money(v?: number) {
  return `R$ ${(v ?? 0).toFixed(2).replace('.', ',')}`
}

function dataCurta(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  } catch {
    return ''
  }
}

const cores = {
  fundo: 'var(--background)',
  moldura: 'var(--surface-secondary)',
  cardBg: 'var(--surface)',
  cardBorda: 'var(--border)',
  navy: 'var(--foreground)',
  navyCard: 'var(--secondary)',
  navyCardTexto: 'var(--secondary-foreground)',
  textoSecundario: 'var(--foreground-secondary)',
  textoTerciario: 'var(--foreground-muted)',
  amarelo: 'var(--primary)',
  amareloTexto: 'var(--primary-foreground)',
  sucesso: 'var(--success-text)',
  perigo: 'var(--danger-text)',
}

// Chaves compartilhadas com o cardápio (mesma sessão de navegador): o vínculo
// criado ao abrir o link do WhatsApp sobrevive à navegação entre as abas.
// Nunca guardam o número — só o token opaco e os 4 dígitos finais.
const WA_TOKEN_KEY = 'cf_wa_token'
const WA_FINAL_KEY = 'cf_wa_final'

// O Preview existe somente no bundle de desenvolvimento. Ele reutiliza a tela
// real com dados totalmente locais e nunca chama APIs, WhatsApp, Pix, Redis ou
// rotas de pedido. Em produção, nem o atalho nem o parâmetro têm efeito.
const PREVIEW_LOCAL_DISPONIVEL = process.env.NODE_ENV !== 'production'

const PERFIL_PREVIEW: Perfil = {
  cliente: { nome: 'Lucas', telefone: 'preview-local' },
  ultimosPedidos: [],
}

const FIDELIDADE_PREVIEW: Fidelidade = {
  ativo: true,
  unidade: 'estrelas',
  descricaoRecompensa: 'Recompensa configurada pela loja',
  saldoPontos: 20,
  pontosPrevistos: 0,
  metaPontos: 50,
  pontosFaltantes: 30,
  progressoPercentual: 40,
  metaAtingida: false,
  extrato: [],
  recompensas: [],
}

const PAINEL_PREVIEW: PainelFidelidade = {
  temporada: { nome: 'Temporada Preview', diasRestantes: 30, fimEm: null, estado: 'ativa' },
  ranking: {
    posicao: 8,
    score: 20,
    participaCampanha: true,
    entorno: [
      { posicao: 7, eVoce: false },
      { posicao: 8, eVoce: true },
      { posicao: 9, eVoce: false },
    ],
    lista: [
      { posicao: 4, score: 28, eVoce: false, participaCampanha: true, nomePublico: 'Ana', telefoneMascarado: '(11) 98888-**42' },
      { posicao: 5, score: 26, eVoce: false, participaCampanha: true, nomePublico: 'Carlos', telefoneMascarado: '(21) 97777-**18' },
      { posicao: 6, score: 24, eVoce: false, participaCampanha: true, nomePublico: 'Marina', telefoneMascarado: '(31) 96666-**07' },
      { posicao: 7, score: 22, eVoce: false, participaCampanha: true, nomePublico: 'Rafael', telefoneMascarado: '(41) 95555-**63' },
      { posicao: 8, score: 20, eVoce: true, participaCampanha: true, nomePublico: 'Lucas', telefoneMascarado: '(99) 99999-**91' },
      { posicao: 9, score: 18, eVoce: false, participaCampanha: true, nomePublico: 'Julia', telefoneMascarado: '(51) 94444-**26' },
      { posicao: 10, score: 16, eVoce: false, participaCampanha: false },
    ],
  },
}

type PreviewFidelidadeMobileProps = {
  aviso: string
  onAviso: (mensagem: string) => void
  onClose: () => void
}

function PreviewFidelidadeMobile({ aviso, onAviso, onClose }: PreviewFidelidadeMobileProps) {
  const [modalCompartilhar, setModalCompartilhar] = useState(false)
  const [modalRankingConsentimento, setModalRankingConsentimento] = useState(false)
  const [mostrarRanking, setMostrarRanking] = useState(false)
  const progresso = Math.max(0, Math.min(100, FIDELIDADE_PREVIEW.progressoPercentual))
  const nome = PERFIL_PREVIEW.cliente.nome ?? 'Cliente'
  const primeiroNome = nome.split(' ')[0]
  const inicial = primeiroNome.slice(0, 1).toUpperCase()

  // No Preview, o aviso confirma a participação simulada no mesmo ciclo em
  // que o estado local libera o ranking. Usar os dois sinais evita que uma
  // atualização do contêiner do Preview esconda a tela recém-liberada.
  if ((mostrarRanking || aviso.startsWith('Participação simulada no Preview')) && PAINEL_PREVIEW.ranking) {
    return (
      <FidelidadeRankingScreen
        ranking={PAINEL_PREVIEW.ranking}
        temporada={PAINEL_PREVIEW.temporada}
        privacidade={null}
        privacidadeCarregando={false}
        privacidadeSalvando={null}
        privacidadeErro=""
        onAlterarPrivacidade={() => undefined}
        onRevogarTodas={() => undefined}
        onClose={() => {
          setMostrarRanking(false)
          onAviso('')
        }}
      />
    )
  }

  function simularCompartilhamento(canal: string) {
    setModalCompartilhar(false)
    onAviso(`${canal}: ação simulada. Nenhum link real foi criado ou enviado.`)
  }

  return (
    <div className="cf-preview-phone">
      <div className="cf-preview-safety" role="status">
        Preview local seguro · dados fictícios · nenhuma integração real é acionada.
      </div>

      <header className="cf-preview-header">
        <div className="cf-preview-avatar" aria-hidden="true">{inicial}</div>
        <div className="cf-preview-greeting"><span>Olá,</span><strong>{primeiroNome}</strong></div>
        <button type="button" onClick={onClose}>Sair</button>
      </header>

      {aviso && <div className="cf-preview-notice" role="status">{aviso}</div>}

      <section className="cf-preview-stars" aria-label="Resumo das Estrelas">
        <p className="cf-preview-kicker">SUAS ESTRELAS</p>
        <strong className="cf-preview-balance">{FIDELIDADE_PREVIEW.saldoPontos}</strong>
        <div className="cf-preview-progress-title"><strong>Próximo presente</strong><strong>{progresso}%</strong></div>
        <div className="cf-preview-progress" aria-label={`${progresso}% do próximo presente`}>
          <span style={{ width: `${progresso}%` }}><i /></span><b aria-hidden="true">🔥</b>
        </div>
        <div className="cf-preview-progress-copy">
          <strong>{FIDELIDADE_PREVIEW.saldoPontos} de {FIDELIDADE_PREVIEW.metaPontos} Estrelas</strong>
          <span>Faltam {FIDELIDADE_PREVIEW.pontosFaltantes}</span>
        </div>
        <div className="cf-preview-season"><Clock3 size={14} /> Temporada atual · {PAINEL_PREVIEW.temporada?.diasRestantes} dias restantes</div>
        <div className="cf-preview-rule"><Info size={18} /><span>Juntou {FIDELIDADE_PREVIEW.metaPontos} Estrelas = ganha 1 presente.</span></div>
        <div className="cf-preview-actions">
          <button type="button" onClick={() => onAviso('Meus presentes aberto em modo demonstrativo. Nenhuma recompensa real foi reservada.')}><Gift size={18} /> Meus presentes</button>
          <button type="button" onClick={() => onAviso('Extrato demonstrativo aberto. Nenhuma movimentação real foi consultada ou alterada.')}><List size={18} /> Extrato</button>
        </div>
      </section>

      <button type="button" className="cf-preview-ranking" onClick={() => setModalRankingConsentimento(true)}>
        <div className="cf-preview-ranking-top">
          <span className="cf-preview-trophy"><Trophy size={22} /></span>
          <span className="cf-preview-ranking-title"><small>RANKING</small><strong>Sua posição</strong></span>
          <span className="cf-preview-faces" aria-label="Participantes anônimos"><i>A</i><i>B</i><i>C</i><i>+27</i></span>
          <ChevronRight size={21} />
        </div>
        <div className="cf-preview-ranking-copy"><ArrowUp size={22} /><span>Faltam <strong>4 Estrelas</strong> para subir de posição</span></div>
      </button>

      <section className="cf-preview-referral">
        <div className="cf-preview-gift" aria-hidden="true">🎁</div>
        <p className="cf-preview-kicker">INDICAÇÃO</p>
        <h2>Chegue mais rápido ao seu presente</h2>
        <p>Indique um amigo. Quando ele fizer o primeiro pedido, você avança.</p>
        <button type="button" onClick={() => setModalCompartilhar(true)}>Indicar amigo</button>
      </section>

      {modalCompartilhar && (
        <div className="cf-preview-modal-backdrop" role="presentation" onClick={() => setModalCompartilhar(false)}>
          <div className="cf-preview-modal" role="dialog" aria-modal="true" aria-label="Compartilhar indicação" onClick={(event) => event.stopPropagation()}>
            <h2>Indicar amigo</h2>
            <p>Escolha onde deseja compartilhar. No Preview, nenhuma mensagem será enviada.</p>
            {['WhatsApp', 'Instagram', 'Telegram', 'Facebook', 'Copiar link'].map((canal) => (
              <button type="button" key={canal} onClick={() => simularCompartilhamento(canal)}>{canal}</button>
            ))}
            <button type="button" className="cf-preview-modal-cancel" onClick={() => setModalCompartilhar(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {modalRankingConsentimento && (
        <RankingConsentModal
          privacidade={{
            finalidades: [
              { finalidade: 'ranking_primeiro_nome', texto: 'Nome', textoVersao: 'preview-v1', disponivel: true, motivoIndisponivel: null, estado: 'revogado', atualizadoEm: null },
              { finalidade: 'ranking_telefone_mascarado', texto: 'Telefone', textoVersao: 'preview-v1', disponivel: true, motivoIndisponivel: null, estado: 'revogado', atualizadoEm: null },
            ],
          }}
          carregando={false}
          salvando={null}
          erro=""
          onAceitar={() => {
            setModalRankingConsentimento(false)
            setMostrarRanking(true)
            onAviso('Participação simulada no Preview. Nenhuma autorização real foi salva.')
          }}
          onRecusar={() => setModalRankingConsentimento(false)}
        />
      )}
    </div>
  )
}

type FidelidadeMobileScreenProps = {
  nome: string
  saldo: number
  meta: number
  faltam: number
  progresso: number
  diasRestantes: number | null
  ranking: PainelFidelidade['ranking']
  aviso: string
  onSair: () => void
  onPresentes: () => void
  onExtrato: () => void
  onRanking: () => void
  onIndicacao: () => void
  indicando: boolean
}

/** Tela oficial de Fidelidade usada pelo cliente autenticado e pelo Preview.
 * O componente só recebe dados já calculados pelo servidor; não cria regra,
 * pontuação, recompensa ou posição localmente. */
function FidelidadeMobileScreen({
  nome, saldo, meta, faltam, progresso, diasRestantes, ranking, aviso,
  onSair, onPresentes, onExtrato, onRanking, onIndicacao, indicando,
}: FidelidadeMobileScreenProps) {
  const primeiroNome = nome.split(' ')[0] || 'Cliente'
  const inicial = primeiroNome.slice(0, 1).toUpperCase()
  const participantes = ranking?.entorno ?? []
  const progressoSeguro = Math.max(0, Math.min(100, progresso))

  return (
    <main className="cf-preview-phone" aria-label="Minha fidelidade">
      <header className="cf-preview-header">
        <div className="cf-preview-avatar" aria-hidden="true">{inicial}</div>
        <div className="cf-preview-greeting"><span>Olá,</span><strong>{primeiroNome}</strong></div>
        <button type="button" onClick={onSair} aria-label="Sair da conta">Sair</button>
      </header>

      {aviso && <div className="cf-preview-notice" role="status">{aviso}</div>}

      <section className="cf-preview-stars" aria-label="Resumo das Estrelas">
        <p className="cf-preview-kicker">SUAS ESTRELAS</p>
        <strong className="cf-preview-balance">{saldo}</strong>
        <div className="cf-preview-progress-title"><strong>Próximo presente</strong><strong>{progressoSeguro}%</strong></div>
        <div className="cf-preview-progress" aria-label={`${progressoSeguro}% do próximo presente`}>
          <span style={{ width: `${progressoSeguro}%` }}><i /></span><b aria-hidden="true">🔥</b>
        </div>
        <div className="cf-preview-progress-copy">
          <strong>{saldo} de {meta} Estrelas</strong><span>Faltam {faltam}</span>
        </div>
        <div className="cf-preview-season"><Clock3 size={14} /> Temporada atual · {diasRestantes === null ? 'em andamento' : `${diasRestantes} dias restantes`}</div>
        <div className="cf-preview-rule"><Info size={18} /><span>Juntou {meta} Estrelas = ganha 1 presente.</span></div>
        <div className="cf-preview-actions">
          <button type="button" onClick={onPresentes}><Gift size={18} /> Meus presentes</button>
          <button type="button" onClick={onExtrato}><List size={18} /> Extrato</button>
        </div>
      </section>

      <button type="button" className="cf-preview-ranking" onClick={onRanking} aria-label="Abrir ranking da temporada">
        <div className="cf-preview-ranking-top">
          <span className="cf-preview-trophy"><Trophy size={22} /></span>
          <span className="cf-preview-ranking-title"><small>RANKING</small><strong>Sua posição</strong>{ranking && <b>#{ranking.posicao}</b>}</span>
          <span className="cf-preview-faces" aria-label="Participantes anonimizados">
            {participantes.map((participante, index) => <i key={participante.posicao}>{participante.eVoce ? 'L' : String.fromCharCode(65 + index)}</i>)}
          </span>
          <ChevronRight size={21} />
        </div>
        <div className="cf-preview-ranking-copy"><ArrowUp size={22} /><span>{ranking ? <>{ranking.score} <strong>Estrelas acumuladas</strong></> : 'O ranking começa a aparecer conforme a temporada avança.'}</span></div>
      </button>

      <section className="cf-preview-referral">
        <div className="cf-preview-gift" aria-hidden="true">🎁</div>
        <p className="cf-preview-kicker">INDICAÇÃO</p>
        <h2>Chegue mais rápido ao seu presente</h2>
        <p>Indique um amigo. Quando ele fizer o primeiro pedido, você avança.</p>
        <button type="button" onClick={onIndicacao} disabled={indicando}>{indicando ? 'Aguarde...' : 'Indicar amigo'}</button>
      </section>
    </main>
  )
}

type FidelidadeRankingScreenProps = {
  ranking: NonNullable<PainelFidelidade['ranking']>
  temporada: PainelFidelidade['temporada']
  privacidade: PreferenciasPrivacidadeRanking | null
  privacidadeCarregando: boolean
  privacidadeSalvando: FinalidadePrivacidadeRanking | 'todas' | null
  privacidadeErro: string
  onAlterarPrivacidade: (
    finalidade: FinalidadePrivacidadeRanking,
    estado: 'concedido' | 'revogado',
    textoVersao: string | null,
  ) => void
  onRevogarTodas: () => void
  onClose: () => void
}

/** Pódio detalhado: scores são reais; a identidade opcional ja chega como um
 * DTO minimo produzido pela protecao server-side. */
function FidelidadeRankingScreen({
  ranking,
  temporada,
  privacidade,
  privacidadeCarregando,
  privacidadeSalvando,
  privacidadeErro,
  onAlterarPrivacidade,
  onRevogarTodas,
  onClose,
}: FidelidadeRankingScreenProps) {
  const [aba, setAba] = useState<'participantes' | 'minha' | 'geral'>('participantes')
  const lista = [...ranking.lista].sort((a, b) => a.posicao - b.posicao)
  const listaSemPodio = lista.filter((entrada) => entrada.posicao > 3)
  const participantes = lista.filter((entrada) => entrada.participaCampanha)
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
  const scoreSeguro = (score: number) => (
    <span className="cf-ranking-score"><Star size={16} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />{score}</span>
  )

  return (
    <main className="cf-ranking-screen" aria-label="Pódio Chefe">
      <header className="cf-ranking-header">
        <button type="button" onClick={onClose} aria-label="Voltar para Fidelidade">‹</button>
        <div>
          <h1>Rank</h1>
          <p>Suba com suas estrelas e ganhe presentes.</p>
        </div>
      </header>

      <section className="cf-ranking-podium" aria-label="Melhores posições">
        {[2, 1, 3].map((posicao) => {
          const entrada = podium.find((item) => item.posicao === posicao)
          return (
            <div key={posicao} className={`cf-ranking-podium-item cf-ranking-podium-${posicao}`}>
              <div className="cf-ranking-medal">{posicao}</div>
              <div className="cf-ranking-avatar">{avatarSeguro(entrada) ?? <Star size={16} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />}</div>
              <strong>{entrada ? nomeSeguro(entrada) : `Posição ${posicao}`}</strong>
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
              {nomeSeguro(entrada)}
              {entrada.telefoneMascarado && <small>{entrada.telefoneMascarado}</small>}
            </span>
            <b>{scoreSeguro(entrada.score)}</b>
          </div>
        ))}
        {aba === 'participantes' && <p className="cf-ranking-footnote">Mostrando posições próximas a você.</p>}
        {aba === 'geral' && <p className="cf-ranking-footnote">Quem não autorizou não concorre ao prêmio.</p>}
      </section>

      <section className="cf-ranking-note">
        <span>🏆</span><div><strong>Acumule estrelas para subir</strong><p>As estrelas desta temporada contam para sua posição.</p></div>
      </section>

    </main>
  )
}

type PrivacidadeRankingControlsProps = {
  privacidade: PreferenciasPrivacidadeRanking | null
  carregando: boolean
  salvando: FinalidadePrivacidadeRanking | 'todas' | null
  erro: string
  onAlterar: (
    finalidade: FinalidadePrivacidadeRanking,
    estado: 'concedido' | 'revogado',
    textoVersao: string | null,
  ) => void
  onRevogarTodas: () => void
}

function PrivacidadeRankingControls({ privacidade, carregando, salvando, erro, onAlterar, onRevogarTodas }: PrivacidadeRankingControlsProps) {
  const opcoesDisponiveis = privacidade?.finalidades.filter((item) => item.disponivel && item.texto && item.textoVersao) ?? []
  const haConsentimentoAtivo = privacidade?.finalidades.some((item) => item.estado === 'concedido') ?? false

  return (
    <section className="cf-ranking-privacy" aria-label="Privacidade no ranking">
      <h2>Suas autorizações</h2>
      <p className="cf-ranking-privacy-hint">Você pode alterar sua participação quando quiser.</p>
      {carregando && <p>Carregando suas preferências…</p>}
      {!carregando && opcoesDisponiveis.length === 0 && (
        <p>Você controla como aparece no ranking.</p>
      )}
      {opcoesDisponiveis.map((opcao) => (
        <label key={opcao.finalidade}>
          <input
            type="checkbox"
            checked={opcao.estado === 'concedido'}
            disabled={salvando !== null}
            onChange={(event) => onAlterar(
              opcao.finalidade,
              event.target.checked ? 'concedido' : 'revogado',
              opcao.textoVersao,
            )}
          />
          <span>{opcao.texto}</span>
        </label>
      ))}
      <p>A foto de perfil não é utilizada enquanto não existir uma fonte oficial autorizada e integrada.</p>
      {haConsentimentoAtivo && (
        <button type="button" disabled={salvando !== null} onClick={onRevogarTodas}>
          {salvando === 'todas' ? 'Revogando…' : 'Revogar todas as autorizações do ranking'}
        </button>
      )}
      {erro && <p role="alert">{erro}</p>}
    </section>
  )
}

type RankingConsentModalProps = {
  privacidade: PreferenciasPrivacidadeRanking | null
  carregando: boolean
  salvando: FinalidadePrivacidadeRanking | 'todas' | null
  erro: string
  onAceitar: (finalidades: Array<{ finalidade: FinalidadePrivacidadeRanking; textoVersao: string }>) => void
  onRecusar: () => void
}

function RankingConsentModal({ privacidade, carregando, salvando, erro, onAceitar, onRecusar }: RankingConsentModalProps) {
  const opcoesDisponiveis = privacidade?.finalidades.filter((item) => item.disponivel && item.texto && item.textoVersao) ?? []
  const podeAceitar = opcoesDisponiveis.length > 0 && salvando === null

  return (
    <div className="cf-ranking-consent-backdrop" role="presentation">
      <section className="cf-ranking-consent-modal" role="dialog" aria-modal="true" aria-labelledby="ranking-consent-title">
        <div className="cf-ranking-consent-visual" aria-hidden="true">
          <div className="cf-ranking-consent-icon-row">
            <span className="cf-ranking-consent-spark cf-ranking-consent-spark-one">✦</span>
            <img className="cf-ranking-consent-emoji" src="/assets/ranking/pizza-3d.webp" alt="" aria-hidden="true" />
            <span className="cf-ranking-consent-spark cf-ranking-consent-spark-two">✦</span>
            <img className="cf-ranking-consent-gift" src="/assets/ranking/presente-3d.webp" alt="" aria-hidden="true" />
            <img className="cf-ranking-consent-burger" src="/assets/ranking/hamburguer-3d.webp" alt="" aria-hidden="true" />
            <img className="cf-ranking-consent-soda" src="/assets/ranking/refrigerante-3d.webp" alt="" aria-hidden="true" />
          </div>
          <span className="cf-ranking-consent-people">
            <i className="cf-ranking-consent-person person-one">👩🏻</i>
            <i className="cf-ranking-consent-person person-two">🧑🏽</i>
            <i className="cf-ranking-consent-person person-three">👨🏾</i>
            <b>+8</b>
          </span>
          <div className="cf-ranking-consent-tour">
            <div className="cf-ranking-consent-tour-step tour-step-one"><span>⭐</span><small>Acumule</small></div>
            <i aria-hidden="true">→</i>
            <div className="cf-ranking-consent-tour-step tour-step-two"><span>📈</span><small>Suba</small></div>
            <i aria-hidden="true">→</i>
            <div className="cf-ranking-consent-tour-step tour-step-three"><span>🎁</span><small>Ganhe</small></div>
          </div>
          <h2 id="ranking-consent-title">E se o presente for seu?</h2>
        </div>
        <div className="cf-ranking-consent-info-card">
          <p className="cf-ranking-consent-lead"><strong>Entre no ranking e acompanhe sua posição.</strong> Seu nome e telefone aparecem de forma protegida.</p>
          <div className="cf-ranking-consent-privacy"><span className="cf-ranking-consent-privacy-icon" aria-hidden="true">✓</span><span className="cf-ranking-consent-privacy-copy"><strong>Privacidade protegida</strong><span> · usamos apenas o necessário.</span></span></div>
        </div>
        {carregando && <p>Carregando sua autorização…</p>}
        {!carregando && opcoesDisponiveis.length === 0 && (
          <p>O ranking ainda não está disponível para autorização. Você pode voltar para sua página de Fidelidade.</p>
        )}
        {erro && <p className="cf-ranking-consent-error" role="alert">{erro}</p>}
        {opcoesDisponiveis.length > 0 && (
          <button
            type="button"
            className="cf-ranking-consent-primary"
            disabled={!podeAceitar}
            onClick={() => onAceitar(opcoesDisponiveis.map((opcao) => ({ finalidade: opcao.finalidade, textoVersao: opcao.textoVersao as string })))}
          >
            {salvando ? 'Salvando…' : <><span className="cf-ranking-consent-badge">GRÁTIS</span><span>Participar</span></>}
          </button>
        )}
        <button type="button" className="cf-ranking-consent-secondary" onClick={onRecusar} disabled={salvando !== null}>Talvez depois</button>
        <small>Você pode mudar essa escolha depois.</small>
        <style>{`.cf-ranking-consent-info-card{margin:12px 0 10px;padding:11px 12px 10px;border:1px solid #e7eefb;border-radius:14px;background:#f7faff}.cf-ranking-consent-lead{margin:0!important}.cf-ranking-consent-lead strong{color:#2d4262;font-weight:800}.cf-ranking-consent-info-card .cf-ranking-consent-privacy{margin:9px 0 0;padding:9px 0 0;border-top:1px solid #e5edf9;background:transparent}.cf-ranking-consent-people{position:absolute;left:0;bottom:0;display:flex;align-items:center;gap:2px;padding:3px 5px 3px 3px;border-radius:20px;background:rgba(255,255,255,.9);box-shadow:0 4px 12px rgba(47,67,98,.12);animation:cf-ranking-consent-people-float 2.8s ease-in-out infinite}.cf-ranking-consent-person{display:flex;width:23px;height:23px;align-items:center;justify-content:center;border:2px solid #fff;border-radius:50%;background:#f8d8d5;font-size:13px;font-style:normal;line-height:1}.cf-ranking-consent-person+.cf-ranking-consent-person{margin-left:-7px}.cf-ranking-consent-people b{display:flex;width:23px;height:23px;align-items:center;justify-content:center;border-radius:50%;background:#4f86ed;color:#fff;font-size:9px}.person-two{background:#f8e5bd}.person-three{background:#d6e7f7}.person-two{animation:cf-ranking-consent-person-bob 2s ease-in-out .2s infinite}.person-three{animation:cf-ranking-consent-person-bob 2s ease-in-out .45s infinite}@keyframes cf-ranking-consent-people-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}@keyframes cf-ranking-consent-person-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}@media (prefers-reduced-motion:reduce){.cf-ranking-consent-people,.cf-ranking-consent-person{animation:none}}`}</style>
        <style>{`.cf-ranking-consent-modal{padding:30px 22px 24px}.cf-ranking-consent-visual{width:200px;height:122px;margin:0 auto 8px;border-radius:30px;background:radial-gradient(circle at 50% 25%,rgba(255,247,219,.9),rgba(255,255,255,0) 56%),linear-gradient(145deg,#fff6f3,#f6f9ff);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 10px 24px rgba(62,84,119,.1)}.cf-ranking-consent-emoji{left:78px;top:18px;font-size:45px;filter:drop-shadow(0 7px 6px rgba(205,135,48,.22));animation:cf-ranking-consent-bob-premium 1.8s ease-in-out infinite}.cf-ranking-consent-gift{right:31px;bottom:47px;font-size:29px;filter:drop-shadow(0 5px 5px rgba(211,151,35,.3));animation:cf-ranking-consent-gift-premium 2.1s ease-in-out .2s infinite}.cf-ranking-consent-spark{font-size:22px;text-shadow:0 0 10px rgba(246,185,25,.4)}.cf-ranking-consent-spark-one{left:33px;top:23px}.cf-ranking-consent-spark-two{right:55px;top:12px;font-size:15px}.cf-ranking-consent-people{left:50%;bottom:10px;transform:translateX(-50%);gap:4px;padding:5px 8px 5px 5px;border:1px solid rgba(255,255,255,.95);border-radius:24px;background:rgba(255,255,255,.92);box-shadow:0 7px 18px rgba(47,67,98,.16);animation:cf-ranking-consent-people-premium 2.8s ease-in-out infinite}.cf-ranking-consent-person{width:31px;height:31px;border-width:2px;font-size:18px;box-shadow:0 2px 6px rgba(36,53,79,.12)}.cf-ranking-consent-person+.cf-ranking-consent-person{margin-left:-9px}.cf-ranking-consent-people b{width:31px;height:31px;font-size:11px;box-shadow:0 3px 8px rgba(79,134,237,.25)}.cf-ranking-consent-eyebrow{margin-bottom:9px!important}.cf-ranking-consent-modal h2{font-size:25px}.cf-ranking-consent-info-card{margin-top:16px;padding:14px 14px 12px}.cf-ranking-consent-lead{font-size:13.5px;line-height:1.55}.cf-ranking-consent-privacy{margin-top:11px!important;padding-top:10px!important}@keyframes cf-ranking-consent-bob-premium{0%,100%{transform:translateY(0) rotate(-3deg) scale(1)}50%{transform:translateY(-8px) rotate(3deg) scale(1.06)}}@keyframes cf-ranking-consent-gift-premium{0%,100%{transform:translateY(0) rotate(0) scale(1)}50%{transform:translateY(-7px) rotate(-7deg) scale(1.08)}}@keyframes cf-ranking-consent-people-premium{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-5px)}}@media (prefers-reduced-motion:reduce){.cf-ranking-consent-emoji,.cf-ranking-consent-gift,.cf-ranking-consent-people{animation:none}}`}</style>
        <style>{`.cf-ranking-consent-visual{height:auto;min-height:142px;padding:14px 0 12px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:space-between}.cf-ranking-consent-icon-row{display:flex;align-items:center;justify-content:center;gap:20px;width:100%;height:78px}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji,.cf-ranking-consent-icon-row .cf-ranking-consent-gift,.cf-ranking-consent-icon-row .cf-ranking-consent-spark{position:static}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{font-size:48px}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{font-size:31px}.cf-ranking-consent-icon-row .cf-ranking-consent-spark-one{font-size:22px}.cf-ranking-consent-icon-row .cf-ranking-consent-spark-two{font-size:16px}.cf-ranking-consent-people{position:static;transform:none;margin:0 auto;animation-name:cf-ranking-consent-people-static-float}@keyframes cf-ranking-consent-people-static-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>
        <style>{`.cf-ranking-consent-info-card{text-align:center}.cf-ranking-consent-info-card .cf-ranking-consent-privacy{justify-content:center}.cf-ranking-consent-visual{width:100%}.cf-ranking-consent-people{align-self:center;margin-left:auto;margin-right:auto}`}</style>
        <style>{`.cf-ranking-consent-icon-row{gap:15px}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{position:static;font-size:29px;line-height:1;filter:drop-shadow(0 5px 5px rgba(176,106,38,.22));animation:cf-ranking-consent-burger-premium 2.4s ease-in-out .35s infinite}@keyframes cf-ranking-consent-burger-premium{0%,100%{transform:translateY(0) rotate(0) scale(1)}50%{transform:translateY(-7px) rotate(6deg) scale(1.08)}}@media (prefers-reduced-motion:reduce){.cf-ranking-consent-burger{animation:none}}`}</style>
        <style>{`.cf-ranking-consent-primary{position:relative;display:flex;align-items:center;justify-content:center}.cf-ranking-consent-badge{position:absolute;top:-9px;right:12px;display:inline-flex;align-items:center;padding:4px 7px;border:2px solid #fff;border-radius:999px;background:#f5b719;color:#5b4100;font-size:8px;font-weight:800;letter-spacing:.05em;line-height:1;box-shadow:0 4px 9px rgba(185,132,18,.25)}`}</style>
        <style>{`.cf-ranking-consent-modal{padding-top:72px}.cf-ranking-consent-visual{min-height:340px;padding:44px 0 38px;margin-bottom:28px;justify-content:flex-start}.cf-ranking-consent-icon-row{height:130px}.cf-ranking-consent-people{margin-top:10px}`}</style>
        <style>{`.cf-ranking-consent-modal h2{font-weight:800;letter-spacing:-.035em;color:#233452;text-wrap:balance}`}</style>
        <style>{`.cf-ranking-consent-visual{min-height:190px;padding:20px 0 15px;margin-bottom:17px;border-radius:28px;background:radial-gradient(circle at 50% 42%,rgba(255,239,186,.9) 0,rgba(255,247,222,.52) 28%,rgba(247,250,255,0) 69%),linear-gradient(145deg,#fffaf7,#f7faff);box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 8px 22px rgba(62,84,119,.07)}.cf-ranking-consent-icon-row{height:92px;align-items:flex-start;padding-top:4px}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{transform:translateY(8px)}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{transform:translateY(13px)}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{transform:translateY(17px)}.cf-ranking-consent-people{margin-top:0}`}</style>
        <style>{`.cf-ranking-consent-tour{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:13px;padding:6px 10px;border:1px solid rgba(255,255,255,.9);border-radius:18px;background:rgba(255,255,255,.7);box-shadow:0 4px 12px rgba(67,86,116,.08)}.cf-ranking-consent-tour-step{display:flex;align-items:center;gap:4px;color:#53647a;font-size:9px;font-weight:700;animation:cf-ranking-consent-tour-pulse 3.6s ease-in-out infinite}.cf-ranking-consent-tour-step span{font-size:15px;line-height:1}.cf-ranking-consent-tour-step small{font-size:9px}.cf-ranking-consent-tour>i{color:#9aa9bc;font-size:13px;font-style:normal;animation:cf-ranking-consent-tour-arrow 3.6s ease-in-out infinite}.tour-step-two{animation-delay:1.2s}.tour-step-three{animation-delay:2.4s}.cf-ranking-consent-tour>i:nth-of-type(2){animation-delay:1.8s}@keyframes cf-ranking-consent-tour-pulse{0%,100%{opacity:.45;transform:translateY(0) scale(.95)}14%,30%{opacity:1;transform:translateY(-3px) scale(1.06)}45%{opacity:.45;transform:translateY(0) scale(.95)}}@keyframes cf-ranking-consent-tour-arrow{0%,100%{opacity:.35}20%,45%{opacity:1;transform:translateX(2px)}}@media (prefers-reduced-motion:reduce){.cf-ranking-consent-tour-step,.cf-ranking-consent-tour>i{animation:none}}`}</style>
        <style>{`.cf-ranking-consent-visual{perspective:none;transform:none;transform-style:flat}.cf-ranking-consent-icon-row{perspective:none;transform:none;transform-style:flat}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{animation:cf-ranking-consent-bob-premium 1.8s ease-in-out infinite}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{animation:cf-ranking-consent-gift-premium 2.1s ease-in-out .2s infinite}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{animation:cf-ranking-consent-burger-premium 2.4s ease-in-out .35s infinite}.cf-ranking-consent-icon-row .cf-ranking-consent-spark{animation:cf-ranking-consent-twinkle 1.4s ease-in-out infinite}.cf-ranking-consent-people{transform-style:flat;animation:cf-ranking-consent-people-static-float 2.8s ease-in-out infinite}.cf-ranking-consent-tour{transform:none;transform-style:flat}`}</style>
        <style>{`.cf-ranking-consent-icon-row img{display:block;object-fit:contain}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{width:62px;height:62px}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{width:53px;height:53px}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{width:56px;height:56px}`}</style>
        <style>{`.cf-ranking-consent-icon-row{gap:22px}.cf-ranking-consent-icon-row img{will-change:transform;animation-timing-function:ease-in-out!important}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{width:82px;height:82px;animation-duration:4.8s!important}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{width:104px;height:104px;animation-duration:5.6s!important}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{width:76px;height:76px;animation-duration:5.1s!important}`}</style>
        <style>{`.cf-ranking-consent-icon-row{gap:7px}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{width:140px;height:140px}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{width:132px;height:132px}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{width:128px;height:128px}.cf-ranking-consent-icon-row .cf-ranking-consent-soda{width:124px;height:124px;object-fit:contain;filter:drop-shadow(0 8px 7px rgba(112,39,22,.22));animation:cf-ranking-consent-soda-float 5.4s ease-in-out .5s infinite}@keyframes cf-ranking-consent-soda-float{0%,100%{transform:translateY(12px) rotate(-3deg)}50%{transform:translateY(-3px) rotate(4deg) scale(1.04)}}`}</style>
        <style>{`.cf-ranking-consent-visual{width:100%!important;min-height:248px!important;height:auto!important;padding:10px 0 16px;margin-bottom:24px;overflow:visible}.cf-ranking-consent-icon-row{position:relative;display:block;width:100%!important;height:164px;overflow:visible}.cf-ranking-consent-icon-row .cf-ranking-consent-spark{position:absolute}.cf-ranking-consent-icon-row img{position:absolute!important;display:block}.cf-ranking-consent-icon-row .cf-ranking-consent-spark-one{left:7%;top:57px}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{left:4%;top:20px}.cf-ranking-consent-icon-row .cf-ranking-consent-spark-two{left:47%;right:auto;top:13px}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{left:35%;top:-90px}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{right:2%;top:2px}.cf-ranking-consent-icon-row .cf-ranking-consent-soda{right:28%;top:74px}.cf-ranking-consent-people{margin-top:0}.cf-ranking-consent-tour{margin-top:15px}`}</style>
        <style>{`.cf-ranking-consent-visual{padding-top:12px;padding-bottom:14px;margin-bottom:26px}.cf-ranking-consent-people{margin-top:4px}.cf-ranking-consent-tour{margin-top:18px}.cf-ranking-consent-modal h2{margin-bottom:18px}.cf-ranking-consent-info-card{margin-top:0;padding:16px 16px 14px}.cf-ranking-consent-info-card .cf-ranking-consent-lead{margin-top:0!important;margin-bottom:0!important}.cf-ranking-consent-info-card .cf-ranking-consent-privacy{margin-top:14px!important;margin-bottom:0}.cf-ranking-consent-primary{margin-top:4px}.cf-ranking-consent-secondary{margin-top:10px}`}</style>
        <style>{`.cf-ranking-consent-modal{--consent-space-1:8px;--consent-space-2:12px;--consent-space-3:16px;--consent-space-4:24px}.cf-ranking-consent-icon-row{margin-bottom:var(--consent-space-1)}.cf-ranking-consent-people{margin-top:var(--consent-space-1)}.cf-ranking-consent-tour{margin-top:var(--consent-space-3)}.cf-ranking-consent-visual{margin-bottom:var(--consent-space-4)!important}.cf-ranking-consent-modal h2{margin:0 0 var(--consent-space-3)!important}.cf-ranking-consent-info-card{margin:0 0 var(--consent-space-3)!important;padding:var(--consent-space-3) var(--consent-space-3) var(--consent-space-2)!important}.cf-ranking-consent-info-card .cf-ranking-consent-lead{margin:0!important}.cf-ranking-consent-info-card .cf-ranking-consent-privacy{margin:var(--consent-space-2) 0 0!important}.cf-ranking-consent-primary{margin-top:0!important}.cf-ranking-consent-secondary{margin-top:var(--consent-space-2)!important}.cf-ranking-consent-modal>small{margin-top:var(--consent-space-2)!important}`}</style>
        <style>{`.cf-ranking-consent-backdrop{padding:10px!important}.cf-ranking-consent-modal{width:min(calc(100vw - 20px),420px)!important}`}</style>
        <style>{`.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{filter:drop-shadow(0 17px 12px rgba(92,55,20,.3))}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{filter:drop-shadow(0 19px 14px rgba(173,112,19,.34))}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{filter:drop-shadow(0 18px 13px rgba(72,39,18,.31))}.cf-ranking-consent-icon-row .cf-ranking-consent-soda{filter:drop-shadow(0 18px 14px rgba(74,28,20,.33))}`}</style>
        <style>{`.cf-ranking-consent-modal{background:linear-gradient(145deg,rgba(255,253,248,.98) 0%,rgba(249,251,255,.98) 54%,rgba(238,246,255,.98) 100%)!important;border:1px solid rgba(255,255,255,.92)!important;box-shadow:0 28px 80px rgba(24,43,76,.32),0 8px 24px rgba(79,134,237,.1),inset 0 1px 0 rgba(255,255,255,.95)!important;backdrop-filter:blur(14px)}.cf-ranking-consent-visual{background:radial-gradient(circle at 50% 44%,rgba(255,226,126,.2),rgba(255,255,255,0) 58%),linear-gradient(145deg,rgba(255,250,244,.78),rgba(242,248,255,.72))!important;border:1px solid rgba(255,255,255,.86);box-shadow:inset 0 1px 0 rgba(255,255,255,.98),0 12px 28px rgba(62,84,119,.11)!important}.cf-ranking-consent-info-card{background:rgba(246,250,255,.78)!important;border:1px solid rgba(199,216,244,.7)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.85)}`}</style>
        <style>{`.cf-ranking-consent-info-card{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important}.cf-ranking-consent-modal h2{font-size:27px!important;font-weight:800!important;letter-spacing:-.035em;color:#172945;line-height:1.08!important}.cf-ranking-consent-lead{max-width:310px;margin-left:auto!important;margin-right:auto!important;color:#536781!important;font-size:14px!important;line-height:1.55!important}.cf-ranking-consent-lead strong{color:#20395e;font-weight:800}.cf-ranking-consent-privacy{background:rgba(255,255,255,.55)!important;border-color:rgba(191,208,235,.7)!important;color:#61738b!important}`}</style>
        <style>{`.cf-ranking-consent-info-card{width:100%;text-align:center!important}.cf-ranking-consent-lead{display:block;width:100%;max-width:none!important;text-align:center!important}`}</style>
        <style>{`.cf-ranking-consent-privacy{display:flex!important;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:7px 12px!important;text-align:left;white-space:nowrap}.cf-ranking-consent-privacy-icon{font-size:16px;line-height:1}.cf-ranking-consent-privacy-copy{display:inline-flex;align-items:center;gap:0;line-height:1;white-space:nowrap}.cf-ranking-consent-privacy-copy strong{color:#415a7c;font-size:11px;font-weight:800}.cf-ranking-consent-privacy-copy>span{color:#718199;font-size:10px}`}</style>
        <style>{`.cf-ranking-consent-privacy-copy strong{font-size:11.5px}.cf-ranking-consent-privacy-copy>span{font-size:10.5px}.cf-ranking-consent-badge{top:-7px!important;right:10px!important;padding:3px 6px!important;font-size:7px!important;box-shadow:0 3px 7px rgba(185,132,18,.2)!important}.cf-ranking-consent-icon-row .cf-ranking-consent-emoji{animation-duration:5.8s!important}.cf-ranking-consent-icon-row .cf-ranking-consent-gift{animation-duration:6.6s!important}.cf-ranking-consent-icon-row .cf-ranking-consent-burger{animation-duration:6.2s!important}.cf-ranking-consent-icon-row .cf-ranking-consent-soda{animation-duration:6.5s!important}`}</style>
        <style>{`.cf-ranking-consent-privacy{min-height:0!important;margin-top:12px!important;padding:6px 0!important;border:0!important;background:transparent!important;box-shadow:none!important}.cf-ranking-consent-privacy-icon{font-size:14px}.cf-ranking-consent-privacy-copy strong{font-size:11.5px}.cf-ranking-consent-privacy-copy>span{font-size:10.5px}`}</style>
        <style>{`.cf-ranking-consent-visual{margin-bottom:24px!important}.cf-ranking-consent-info-card{margin-bottom:20px!important}.cf-ranking-consent-privacy{margin-top:16px!important;margin-bottom:0!important;padding-top:12px!important;border-top:1px solid rgba(176,196,226,.58)!important;border-radius:0!important}.cf-ranking-consent-primary{margin-top:0!important}`}</style>
        <style>{`.cf-ranking-consent-info-card{margin-bottom:24px!important}.cf-ranking-consent-privacy{position:relative;width:100%!important;margin-left:0!important;margin-right:0!important;justify-content:center!important;align-items:center!important;gap:8px!important;flex-wrap:nowrap;border-top:0!important;padding-top:16px!important;white-space:nowrap;text-align:center}.cf-ranking-consent-privacy::before{content:"";position:absolute;top:0;left:11%;right:11%;height:1px;background:rgba(176,196,226,.58)}.cf-ranking-consent-privacy-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 23px;width:23px;height:23px;border:1px solid rgba(79,134,237,.24);border-radius:50%;background:#e9f1ff;color:#3972d7;font-size:13px;font-weight:900;line-height:1;box-shadow:0 2px 5px rgba(67,107,169,.12)}.cf-ranking-consent-privacy-copy{display:inline-flex;align-items:center;white-space:nowrap;line-height:1.2}.cf-ranking-consent-privacy-copy strong{font-size:11.5px;color:#304d77}.cf-ranking-consent-privacy-copy>span{font-size:10.5px;color:#718199}`}</style>
      </section>
    </div>
  )
}

export default function ClientePage() {
  // Etapas: carregando → (perfil | confirmar | telefone) → otp → (nome) → perfil.
  // "confirmar" é a experiência de número reconhecido pelo link do WhatsApp:
  // mostra só o número mascarado (produzido no servidor) e nunca pede digitação.
  const [step, setStep] = useState<'carregando' | 'confirmar' | 'telefone' | 'otp' | 'nome' | 'perfil'>('carregando')
  const { pendente: pixPendente } = usePixPendente()
  const [telefone, setTelefone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [fidelidade, setFidelidade] = useState<Fidelidade | null>(null)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [painel, setPainel] = useState<PainelFidelidade | null>(null)
  const [privacidadeRanking, setPrivacidadeRanking] = useState<PreferenciasPrivacidadeRanking | null>(null)
  const [privacidadeCarregando, setPrivacidadeCarregando] = useState(false)
  const [privacidadeSalvando, setPrivacidadeSalvando] = useState<FinalidadePrivacidadeRanking | 'todas' | null>(null)
  const [privacidadeErro, setPrivacidadeErro] = useState('')
  const [indicacaoToken, setIndicacaoToken] = useState<string | null>(null)
  const [compartilhandoIndicacao, setCompartilhandoIndicacao] = useState(false)
  const [resgatando, setResgatando] = useState(false)
  const [resgateErro, setResgateErro] = useState('')
  const [mobilePanel, setMobilePanel] = useState<'presentes' | 'extrato' | 'ranking' | null>(null)
  const [rankingConsentModal, setRankingConsentModal] = useState(false)
  const convitePosPedidoRef = useRef(false)
  // Vínculo reconhecido: token opaco + máscaras vindas do servidor.
  const [waToken, setWaToken] = useState('')
  const [waMascarado, setWaMascarado] = useState('')
  const [waFinal, setWaFinal] = useState('')
  // O OTP em andamento foi enviado pelo vínculo (servidor decide o destino)
  // ou pelo telefone digitado no fluxo manual?
  const [otpViaVinculo, setOtpViaVinculo] = useState(false)
  const [reenvioEm, setReenvioEm] = useState(0)
  // Código de suporte da tentativa atual (P3-XXXXXX): sem PII, correlaciona a
  // telemetria de UMA tentativa; exibido discretamente na tela do código.
  const [traceId, setTraceId] = useState<string | null>(null)
  // Erros LOCAIS de carregamento — nunca viram logout nem troca de etapa.
  const [perfilErro, setPerfilErro] = useState(false)
  const [fidelidadeErro, setFidelidadeErro] = useState(false)
  const [modoPreview, setModoPreview] = useState(false)
  const [previewAviso, setPreviewAviso] = useState('')
  const codigoRef = useRef<HTMLInputElement>(null)

  function entrarPreview() {
    if (!PREVIEW_LOCAL_DISPONIVEL) return
    setModoPreview(true)
    setPreviewAviso('')
    setPerfil(PERFIL_PREVIEW)
    setFidelidade(FIDELIDADE_PREVIEW)
    setJornada(null)
    setPainel(PAINEL_PREVIEW)
    setIndicacaoToken('preview-local')
    setPerfilErro(false)
    setFidelidadeErro(false)
    setErro('')
    setStep('perfil')
  }

  // Retorno seguro pós-login (ex.: veio de "Pedido" no menu inferior sem
  // sessão ativa): só aceita destinos de uma allowlist explícita, nunca uma
  // URL externa/absoluta vinda do navegador — evita open redirect.
  function nextPermitidoAtual(): string | null {
    try {
      const params = new URLSearchParams(window.location.search)
      return destinoNextPermitido(params.get('next'))
    } catch {
      return null
    }
  }

  function abrirSacola() {
    if (modoPreview) {
      setPreviewAviso('A sacola não é aberta no Preview para impedir qualquer pedido real.')
      return
    }
    try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
    window.location.href = '/pedido'
  }

  // ==========================================================================
  // MÁQUINA DE ESTADOS PÓS-OTP (determinística)
  // Depois de um OTP válido, o SERVIDOR é a fonte da verdade da próxima tela
  // (resposta atômica do verificar: next = "name" | "points"). Nenhuma
  // consulta a perfil/fidelidade participa dessa decisão, e nenhuma falha de
  // carregamento devolve o cliente para "Encontramos seu WhatsApp".
  // ==========================================================================

  // Sessão recém-criada vive PRIMEIRO em memória (funciona mesmo com
  // sessionStorage bloqueado); o storage é só persistência best-effort.
  const sessaoMemRef = useRef<string | null>(null)
  // Depois de um OTP validado nesta página, iniciarSemSessao é proibido.
  const otpValidadoRef = useRef(false)
  // Ticket de ativação do perfil (opaco, uso único, só para o PATCH do nome
  // quando cookie/JWE falharem) — nunca persiste em storage, nunca reenviado
  // depois de consumido (êxito ou falha). Ver clienteAuth.ts.
  const ativacaoTicketRef = useRef<string | null>(null)

  async function carregarIdentidade(): Promise<void> {
    setPerfilErro(false)
    try {
      const res = await fetchCliente('/api/cliente/perfil', { cache: 'no-store' }, sessaoMemRef.current)
      telemetria('profile_request_status', { status: res.status, trace: traceId })
      if (res.ok) { setPerfil(await res.json()); return }
    } catch {}
    // Falha (inclusive 401 transitório) NUNCA desloga nem muda de etapa —
    // só marca o erro local com "Tentar novamente".
    setPerfilErro(true)
  }

  async function carregarFidelidade(): Promise<void> {
    setFidelidadeErro(false)
    try {
      const res = await fetchCliente('/api/cliente/fidelidade', { cache: 'no-store' }, sessaoMemRef.current)
      telemetria('fidelity_request_status', { status: res.status, trace: traceId })
      if (res.ok) { setFidelidade(await res.json()); return }
    } catch {}
    setFidelidadeErro(true)
  }

  async function carregarJornada(): Promise<void> {
    // Best-effort, nunca bloqueia nem afeta o card de pontos: a Jornada do
    // Chef é uma camada separada, opcional (feature flag), sem estado de
    // erro próprio na tela — ausência de dados só oculta o card.
    try {
      const res = await fetchCliente('/api/cliente/jornada-chef', { cache: 'no-store' }, sessaoMemRef.current)
      if (res.ok) setJornada(await res.json())
    } catch {}
  }

  async function carregarPainel(): Promise<void> {
    try {
      const res = await fetchCliente('/api/cliente/fidelidade/painel', { cache: 'no-store' }, sessaoMemRef.current)
      if (res.ok) setPainel(await res.json())
    } catch {}
  }

  async function carregarPrivacidadeRanking(): Promise<PreferenciasPrivacidadeRanking | null> {
    setPrivacidadeCarregando(true)
    setPrivacidadeErro('')
    try {
      const res = await fetchCliente('/api/cliente/privacidade/ranking', { cache: 'no-store' }, sessaoMemRef.current)
      if (res.ok) {
        const data = await res.json() as PreferenciasPrivacidadeRanking
        setPrivacidadeRanking(data)
        setPrivacidadeCarregando(false)
        return data
      }
      setPrivacidadeErro('Não conseguimos carregar suas preferências agora.')
    } catch {
      setPrivacidadeErro('Não conseguimos carregar suas preferências agora.')
    }
    setPrivacidadeCarregando(false)
    return null
  }

  async function abrirRanking() {
    setRankingConsentModal(true)
    const preferencias = await carregarPrivacidadeRanking()
    const jaParticipa = preferencias?.finalidades.some((item) => item.estado === 'concedido') ?? false
    if (jaParticipa) {
      setRankingConsentModal(false)
      setMobilePanel('ranking')
    }
  }

  async function alterarPrivacidadeRanking(
    finalidade: FinalidadePrivacidadeRanking,
    estado: 'concedido' | 'revogado',
    textoVersao: string | null,
  ): Promise<boolean> {
    setPrivacidadeSalvando(finalidade)
    setPrivacidadeErro('')
    try {
      const res = await fetchCliente('/api/cliente/privacidade/ranking', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalidade, estado, textoVersao }),
      }, sessaoMemRef.current)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.finalidades) throw new Error('preferencia_nao_salva')
      setPrivacidadeRanking({ finalidades: data.finalidades })
      await carregarPainel()
      setPrivacidadeSalvando(null)
      return true
    } catch {
      setPrivacidadeErro('Não conseguimos salvar. O ranking continua sem ampliar a exposição.')
      setPrivacidadeSalvando(null)
      return false
    }
  }

  async function aceitarRanking(finalidades: Array<{ finalidade: FinalidadePrivacidadeRanking; textoVersao: string }>) {
    setPrivacidadeErro('')
    for (const item of finalidades) {
      const salvou = await alterarPrivacidadeRanking(item.finalidade, 'concedido', item.textoVersao)
      if (!salvou) return
    }
    setRankingConsentModal(false)
    setMobilePanel('ranking')
    await carregarPrivacidadeRanking()
  }

  async function revogarTodasPrivacidadesRanking() {
    setPrivacidadeSalvando('todas')
    setPrivacidadeErro('')
    try {
      const res = await fetchCliente('/api/cliente/privacidade/ranking', { method: 'DELETE' }, sessaoMemRef.current)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.finalidades) throw new Error('preferencias_nao_revogadas')
      setPrivacidadeRanking({ finalidades: data.finalidades })
      await carregarPainel()
      setMobilePanel(null)
    } catch {
      setPrivacidadeErro('Não conseguimos concluir a revogação. Tente novamente.')
    }
    setPrivacidadeSalvando(null)
  }

  async function compartilharIndicacao() {
    if (modoPreview) {
      setPreviewAviso('O compartilhamento foi simulado. Nenhum link real foi criado ou enviado.')
      return
    }
    setCompartilhandoIndicacao(true)
    try {
      let token = indicacaoToken
      if (!token) {
        const res = await fetchCliente('/api/cliente/indicacao', { cache: 'no-store' }, sessaoMemRef.current)
        if (res.ok) {
          const data = await res.json()
          token = typeof data.token === 'string' ? data.token : null
          if (token) setIndicacaoToken(token)
        }
      }
      if (!token) { setCompartilhandoIndicacao(false); return }
      const url = `${window.location.origin}/pedido?ref=${token}`
      if (navigator.share) {
        await navigator.share({ title: 'Indique um amigo', text: 'Peça pelo meu link do Chefe da Pizza.', url })
      } else {
        await navigator.clipboard.writeText(url)
      }
    } catch {}
    setCompartilhandoIndicacao(false)
  }

  function abrirPontos() {
    setStep('perfil')
    telemetria('points_step_opened', { trace: traceId })
    carregarIdentidade()
    carregarFidelidade()
    carregarJornada()
    carregarPainel()
    carregarPrivacidadeRanking().then((preferencias) => {
      if (!convitePosPedidoRef.current) return
      convitePosPedidoRef.current = false
      const jaParticipa = preferencias?.finalidades.some((item) => item.estado === 'concedido') ?? false
      if (!jaParticipa) setRankingConsentModal(true)
    })
    // Processa indicação capturada antes do login (cf_ref)
    try {
      const ref = sessionStorage.getItem('cf_ref')
      if (ref) {
        sessionStorage.removeItem('cf_ref')
        fetchCliente('/api/cliente/indicacao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref }),
        }, sessaoMemRef.current).catch(() => {})
      }
    } catch {}
  }

  function limparVinculo() {
    setWaToken('')
    setWaMascarado('')
    setWaFinal('')
    try { sessionStorage.removeItem(WA_TOKEN_KEY); sessionStorage.removeItem(WA_FINAL_KEY) } catch {}
  }

  // Sem sessão de cliente: tenta reconhecer o WhatsApp do link (token opaco da
  // URL ?t= ou o já validado pelo cardápio nesta sessão do navegador). O token
  // é sempre revalidado no servidor; inválido/expirado cai no fluxo manual.
  // PROIBIDO depois de um OTP validado nesta página — nunca voltar ao início.
  async function iniciarSemSessao() {
    if (otpValidadoRef.current) {
      telemetria('unexpected_return_to_confirm', { motivo: 'erro_inesperado', trace: traceId })
      setErro('Não conseguimos abrir seus pontos agora. Toque em "Tentar novamente".')
      return
    }
    let token = ''
    try {
      const params = new URLSearchParams(window.location.search)
      const t = params.get('t')
      if (t) {
        // Remove o token da URL (evita vazar em prints/compartilhamentos) —
        // mesmo comportamento já validado no cardápio.
        params.delete('t')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
        token = t
      } else {
        token = sessionStorage.getItem(WA_TOKEN_KEY) || ''
      }
    } catch {}
    if (!token) { setStep('telefone'); return }
    try {
      const r = await fetch(`/api/cardapio-whatsapp-session?t=${encodeURIComponent(token)}`, { cache: 'no-store' })
      const data = await r.json()
      if (data?.ok && data.phoneMascarado) {
        setWaToken(token)
        setWaMascarado(String(data.phoneMascarado))
        setWaFinal(String(data.phoneFinal || ''))
        try {
          sessionStorage.setItem(WA_TOKEN_KEY, token)
          sessionStorage.setItem(WA_FINAL_KEY, String(data.phoneFinal || ''))
        } catch {}
        setStep('confirmar')
        return
      }
      limparVinculo()
    } catch {}
    setStep('telefone')
  }

  useEffect(() => {
    // Limpa a marca de retomada de versões anteriores — a decisão de etapa é
    // sempre do estado-sessao, nunca da URL.
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('fromOrder') === '1') {
        convitePosPedidoRef.current = true
        params.delete('fromOrder')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
      }
      if (params.get('cadastro')) {
        params.delete('cadastro')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
      }
      // Captura ?ref= de indicação antes do login; removido da URL imediatamente.
      const refParam = params.get('ref')
      if (refParam) {
        params.delete('ref')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
        try { sessionStorage.setItem('cf_ref', refParam) } catch {}
      }
    } catch {}
    // ÚNICA fonte de "estou autenticado?": /api/cliente/estado-sessao (valida
    // só a sessão, sem tocar em dados secundários). Só um 401 DELE leva ao
    // fluxo de confirmação.
    fetchCliente('/api/cliente/estado-sessao', { cache: 'no-store' })
      .then(async (res) => {
        if (res.ok) {
          const dados = await res.json()
          const destino = nextPermitidoAtual()
          if (destino) { window.location.href = destino; return }
          if (dados?.next === 'name') { setNome(''); setStep('nome'); telemetria('name_step_opened') } else { abrirPontos() }
          return
        }
        iniciarSemSessao()
      })
      .catch(() => { iniciarSemSessao() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Contador de reenvio do código (60s, alinhado ao cooldown do servidor).
  useEffect(() => {
    if (step !== 'otp' || reenvioEm <= 0) return
    const id = setTimeout(() => setReenvioEm((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearTimeout(id)
  }, [step, reenvioEm])

  // Foco automático no campo de código ao entrar na etapa.
  useEffect(() => {
    if (step === 'otp') codigoRef.current?.focus()
  }, [step])

  // Fluxo de número reconhecido: o body leva SÓ o token opaco — o servidor
  // resolve o destino do OTP; nenhum telefone sai do navegador.
  async function pedirCodigoVinculo() {
    setErro('')
    setEnviando(true)
    try {
      const res = await fetch('/api/cliente/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waToken }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data?.vinculoInvalido) {
          limparVinculo()
          setErro('Não conseguimos confirmar seu WhatsApp. Digite seu número.')
          setStep('telefone')
        } else {
          setErro(data.error || 'Não foi possível enviar o código')
        }
        setEnviando(false)
        return
      }
      setOtpViaVinculo(true)
      setCodigo('')
      setTraceId(typeof data.traceId === 'string' ? data.traceId : null)
      setReenvioEm(60)
      setStep('otp')
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function pedirCodigo() {
    setErro('')
    if (telefone.replace(/\D/g, '').length < 10) { setErro('Digite um WhatsApp válido com DDD'); return }
    setEnviando(true)
    try {
      const res = await fetch('/api/cliente/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setErro(data.error || 'Não foi possível enviar o código'); setEnviando(false); return }
      setOtpViaVinculo(false)
      setCodigo('')
      setTraceId(typeof data.traceId === 'string' ? data.traceId : null)
      setReenvioEm(60)
      setStep('otp')
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function reenviarCodigo() {
    if (reenvioEm > 0 || enviando) return
    if (otpViaVinculo) { await pedirCodigoVinculo(); return }
    await pedirCodigo()
  }

  // ETAPA CRÍTICA: código válido → transição IMEDIATA para a tela que o
  // servidor mandou (next). Sessão vai para a memória antes de qualquer coisa;
  // storage é best-effort; nenhum retry/sondagem/navegação decide a etapa.
  async function confirmarCodigo() {
    setErro('')
    if (!codigo.trim()) { setErro('Digite o código recebido no WhatsApp'); return }
    setEnviando(true)
    try {
      const res = await fetch('/api/cliente/verificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(otpViaVinculo ? { waToken, codigo, traceId } : { telefone, codigo, traceId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data?.vinculoInvalido) {
          limparVinculo()
          setErro('Não conseguimos confirmar seu WhatsApp. Digite seu número.')
          setStep('telefone')
        } else {
          setErro(data.error || 'Código inválido')
        }
        setEnviando(false)
        return
      }
      otpValidadoRef.current = true
      telemetria('otp_verified', { trace: traceId })
      const sessao = typeof data.sessao === 'string' ? data.sessao : null
      if (sessao) {
        telemetria('session_created', { trace: traceId })
        sessaoMemRef.current = sessao
        telemetria('session_in_memory', { trace: traceId })
        const guardou = guardarSessaoFallback(sessao)
        telemetria(guardou ? 'session_storage_ok' : 'session_storage_failed', { trace: traceId })
      }
      // Ticket de ativação do perfil (uso único, só para o PATCH do nome se
      // cookie/JWE falharem) — só em memória, nunca em sessionStorage.
      ativacaoTicketRef.current = typeof data.ativacaoToken === 'string' ? data.ativacaoToken : null
      const next = data.next === 'points' ? 'points' : 'name'
      if (next === 'name') {
        setNome('')
        setStep('nome')
        telemetria('name_step_opened', { trace: traceId })
      } else {
        abrirPontos()
      }
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function salvarNome() {
    setErro('')
    if (nome.trim().length < 2) { setErro('Digite seu nome'); return }
    setEnviando(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (traceId && /^P3-[A-Z0-9]{6}$/.test(traceId)) headers['X-ChefeBot-Trace'] = traceId
      let res = await fetchCliente('/api/cliente/perfil', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ nome }),
      }, sessaoMemRef.current)
      // Reenviar a MESMA sessão rejeitada não a torna válida — não é uma
      // correção comprovada. Se cookie/JWE falharem (401) e ainda houver o
      // ticket de ativação (uso único, emitido junto com a sessão), a única
      // nova tentativa usa essa credencial DIFERENTE — nunca a mesma sessão.
      // Sem ticket disponível, não há nova tentativa automática.
      const ticket = ativacaoTicketRef.current
      if (res.status === 401 && ticket) {
        ativacaoTicketRef.current = null // uso único: nunca reenviado de novo
        telemetria('name_save_retry_ticket', { trace: traceId })
        res = await fetchCliente('/api/cliente/perfil', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ nome, ativacaoToken: ticket }),
        }, sessaoMemRef.current)
      }
      const data = await res.json().catch(() => ({}))
      telemetria('name_save_request_status', { status: res.status, trace: traceId })
      if (!res.ok || !data.ok) {
        // Se a gravação falhou DEPOIS do ticket original ter sido consumido
        // (500 com ticket novo devolvido pelo backend), guarda o ticket novo
        // para o próximo clique em "Ativar meus pontos" funcionar sem exigir
        // um OTP novo. Uso único: cada ticket só serve para uma tentativa.
        if (typeof data.ativacaoToken === 'string') {
          ativacaoTicketRef.current = data.ativacaoToken
        }
        // Falha (inclusive 401 persistente) mantém a tela do nome com retry —
        // NUNCA pede novo código nem volta para a confirmação.
        setErro(res.status === 400 ? (data.error || 'Digite seu nome') : 'Não conseguimos salvar agora. Tente de novo.')
        setEnviando(false)
        return
      }
      telemetria('name_saved', { trace: traceId })
      abrirPontos()
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function sair() {
    if (modoPreview) {
      setModoPreview(false)
      setPreviewAviso('')
      setPerfil(null)
      setFidelidade(null)
      setJornada(null)
      setPainel(null)
      setPrivacidadeRanking(null)
      setIndicacaoToken(null)
      setStep('telefone')
      return
    }
    try { await fetchCliente('/api/cliente/logout', { method: 'POST' }, sessaoMemRef.current) } catch {}
    limparSessaoFallback()
    sessaoMemRef.current = null
    otpValidadoRef.current = false
    setPerfil(null)
    setFidelidade(null)
    setJornada(null)
    setPainel(null)
    setPrivacidadeRanking(null)
    setIndicacaoToken(null)
    setPerfilErro(false)
    setFidelidadeErro(false)
    setTelefone('')
    setCodigo('')
    setNome('')
    setErro('')
    // Mantém o vínculo do link (se ainda válido) — sair da conta não apaga o
    // reconhecimento do WhatsApp desta sessão de navegação.
    if (waToken && waMascarado) { setStep('confirmar'); return }
    setStep('telefone')
  }

  // CTA de resgate só aparece quando a meta atual (recalculada no servidor,
  // não um snapshot antigo) bate, a fidelidade está ativa e existe pelo menos
  // uma recompensa aberta de verdade — nunca confia só na existência de um
  // texto de "próxima recompensa".
  const podeResgatar = !!fidelidade && fidelidade.ativo && fidelidade.metaAtingida && fidelidade.recompensas.length > 0

  const missaoAtual = (!podeResgatar && fidelidade)
    ? calcularMissaoAtual({
        presentesDisponiveis: 0,
        estrelasAtivas: fidelidade.ativo && fidelidade.unidade === 'estrelas',
        saldoEstrelas: fidelidade.saldoPontos,
        metaEstrelas: fidelidade.metaPontos,
      })
    : null

  const estrelasDeIndicacao = fidelidade?.extrato.filter(
    (m) => m.descricao.toLowerCase().includes('indicaç')
  ).reduce((acc, m) => acc + m.pontos, 0) ?? 0

  async function resgatar() {
    if (modoPreview) {
      setPreviewAviso('O resgate foi simulado. Nenhuma recompensa real foi reservada.')
      return
    }
    if (!fidelidade || fidelidade.recompensas.length === 0) return
    setResgateErro('')
    setResgatando(true)
    try {
      const res = await fetchCliente('/api/cliente/fidelidade/resgate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recompensaId: fidelidade.recompensas[0].recompensaId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setResgateErro(data.error || 'Não foi possível reservar o resgate agora.'); setResgatando(false); return }
      try {
        sessionStorage.setItem('cf_resgate_pontos', JSON.stringify({
          resgateId: data.resgateId,
          valorDescontoMaximo: data.valorDescontoMaximo,
          expiraEm: data.expiraEm,
        }))
      } catch {}
      window.location.href = '/pedido'
    } catch {
      setResgateErro('Erro de conexão. Tente novamente.')
      setResgatando(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 16px',
    borderRadius: 12,
    border: `1px solid ${cores.cardBorda}`,
    background: cores.cardBg,
    color: cores.navy,
    fontSize: 16,
    fontFamily: 'Archivo, sans-serif',
  }

  const botaoPrimario: React.CSSProperties = {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    background: cores.amarelo,
    color: cores.amareloTexto,
    fontSize: 15,
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Archivo, sans-serif',
  }

  const botaoTextoDiscreto: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: cores.textoSecundario,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'Archivo, sans-serif',
  }

  const iconeCirculo = (icone: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
      <div style={{ background: cores.navyCard, borderRadius: 999, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icone}
      </div>
    </div>
  )

  return (
    <div style={{ background: step === 'perfil' ? 'linear-gradient(180deg, #f8f9fb 0%, #f0f2f5 100%)' : cores.fundo, minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: cores.navy, display: 'flex', flexDirection: 'column' }}>
      {!modoPreview && step !== 'perfil' && <div style={{ background: cores.cardBg, borderBottom: `1px solid ${cores.cardBorda}`, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Pizza size={22} color={cores.navy} />
          <div style={{ fontSize: 15, fontWeight: 700, color: cores.navy }}>Minha fidelidade</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }} />
      </div>}

      <div
        className={`cliente-conteudo ${step === 'perfil' && !modoPreview ? 'cliente-conteudo-fidelidade' : ''}`}
        style={{
          flex: 1,
          padding: '28px 20px calc(env(safe-area-inset-bottom) + 96px)',
          maxWidth: modoPreview || step === 'perfil' ? 430 : 1180,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        {step === 'carregando' && (
          <p style={{ textAlign: 'center', color: cores.textoSecundario, fontSize: 14 }}>Carregando...</p>
        )}

        {step === 'confirmar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<ShieldCheck size={30} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Encontramos seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                Este é o número usado para abrir seu cardápio:
              </p>
            </div>
            <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 12, padding: '14px 16px', textAlign: 'center', fontSize: 20, fontWeight: 800, letterSpacing: 1, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
              {waMascarado}
            </div>
            <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5, textAlign: 'center' }}>
              Confirme seu WhatsApp para ativar sua fidelidade, acompanhar suas recompensas e não perder nenhuma vantagem.
            </p>
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0, textAlign: 'center' }}>{erro}</p>}
            <button onClick={pedirCodigoVinculo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Enviando...' : 'Confirmar e receber código'}
            </button>
            <p style={{ fontSize: 12.5, color: cores.textoTerciario, margin: 0, textAlign: 'center' }}>
              Vamos enviar um código de segurança para este WhatsApp.
            </p>
            <button onClick={() => { setErro(''); setStep('telefone') }} style={{ ...botaoTextoDiscreto, textAlign: 'center' }}>
              Este número não é meu
            </button>
          </div>
        )}

        {step === 'telefone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<Gift size={30} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Entre com seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                Suas pizzas começam a contar rumo à sua recompensa.
              </p>
            </div>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="(99) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              style={inputStyle}
            />
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={pedirCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Phone size={16} /> {enviando ? 'Enviando...' : 'Receber código no WhatsApp'}
            </button>
            {waToken && waMascarado && (
              <button onClick={() => { setErro(''); setStep('confirmar') }} style={{ ...botaoTextoDiscreto, textAlign: 'center' }}>
                Voltar para o número encontrado
              </button>
            )}
            <a href="/pedido" style={{ textAlign: 'center', fontSize: 13, color: cores.textoSecundario, textDecoration: 'none' }}>
              Prefiro pedir sem entrar agora
            </a>
            {PREVIEW_LOCAL_DISPONIVEL && (
              <button onClick={entrarPreview} style={{ ...botaoTextoDiscreto, textAlign: 'center' }}>
                Abrir Preview local seguro
              </button>
            )}
          </div>
        )}

        {step === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<MessageCircle size={28} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Confira seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                {otpViaVinculo && waFinal
                  ? `Enviamos um código para o número final ${waFinal}.`
                  : 'Enviamos um código de 6 dígitos pro seu WhatsApp.'}
              </p>
            </div>
            <input
              ref={codigoRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={codigo}
              // Sem maxLength no atributo: colar "12 34 56" não pode ser
              // truncado pelo navegador antes do filtro de dígitos abaixo.
              // Editar o código limpa o erro anterior na hora.
              onChange={(e) => { if (erro) setErro(''); setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6)) }}
              style={{ ...inputStyle, textAlign: 'center', letterSpacing: 4, fontSize: 20 }}
            />
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={confirmarCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Confirmando...' : 'Confirmar código'}
            </button>
            <button
              onClick={reenviarCodigo}
              disabled={reenvioEm > 0 || enviando}
              style={{ ...botaoTextoDiscreto, opacity: reenvioEm > 0 ? 0.6 : 1, cursor: reenvioEm > 0 ? 'default' : 'pointer' }}
            >
              {reenvioEm > 0 ? `Reenviar código em ${reenvioEm}s` : 'Reenviar código'}
            </button>
            <button onClick={() => { setErro(''); setCodigo(''); setStep('telefone') }} style={botaoTextoDiscreto}>
              Usar outro número
            </button>
            {traceId && (
              <p style={{ fontSize: 11, color: cores.textoTerciario, margin: 0, textAlign: 'center' }}>
                Código de suporte: {traceId}
              </p>
            )}
          </div>
        )}

        {step === 'nome' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<Sparkles size={28} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Como podemos chamar você?</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                Seu WhatsApp já está confirmado. Falta só seu nome para ativar suas vantagens.
              </p>
            </div>
            <input
              type="text"
              autoComplete="name"
              placeholder="Seu nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              style={inputStyle}
              autoFocus
            />
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={salvarNome} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Ativando...' : 'Ativar minha fidelidade'}
            </button>
            {erro && traceId && (
              <p style={{ fontSize: 11, color: cores.textoTerciario, margin: 0, textAlign: 'center' }}>
                Código de suporte: {traceId}
              </p>
            )}
          </div>
        )}

        {step === 'perfil' && modoPreview && (
          <PreviewFidelidadeMobile aviso={previewAviso} onAviso={setPreviewAviso} onClose={() => void sair()} />
        )}

        {step === 'perfil' && !modoPreview && (
          <>
            {!fidelidade && !fidelidadeErro && <p style={{ color: cores.textoSecundario, fontSize: 14, textAlign: 'center' }}>Carregando suas Estrelas...</p>}
            {fidelidadeErro && <div className="cf-mobile-empty" role="alert">Não conseguimos carregar suas Estrelas agora. <button type="button" onClick={carregarFidelidade}>Tentar novamente</button></div>}
            {fidelidade && !fidelidade.ativo && <div className="cf-mobile-empty">O programa de pontos ainda não está ativo por aqui. Volte em breve!</div>}
            {fidelidade && fidelidade.ativo && mobilePanel === 'ranking' && painel?.ranking && (
              <FidelidadeRankingScreen
                ranking={painel.ranking}
                temporada={painel.temporada}
                privacidade={privacidadeRanking}
                privacidadeCarregando={privacidadeCarregando}
                privacidadeSalvando={privacidadeSalvando}
                privacidadeErro={privacidadeErro}
                onAlterarPrivacidade={(finalidade, estado, textoVersao) => void alterarPrivacidadeRanking(finalidade, estado, textoVersao)}
                onRevogarTodas={() => void revogarTodasPrivacidadesRanking()}
                onClose={() => setMobilePanel(null)}
              />
            )}
            {fidelidade && fidelidade.ativo && mobilePanel !== 'ranking' && (
              <>
                <FidelidadeMobileScreen
                  nome={perfil?.cliente.nome ?? 'Cliente'}
                  saldo={fidelidade.saldoPontos}
                  meta={fidelidade.metaPontos}
                  faltam={fidelidade.pontosFaltantes}
                  progresso={fidelidade.progressoPercentual}
                  diasRestantes={painel?.temporada?.diasRestantes ?? null}
                  ranking={painel?.ranking ?? null}
                  aviso={previewAviso}
                  onSair={() => void sair()}
                  onPresentes={() => setMobilePanel('presentes')}
                  onExtrato={() => setMobilePanel('extrato')}
                  onRanking={abrirRanking}
                  onIndicacao={() => void compartilharIndicacao()}
                  indicando={compartilhandoIndicacao}
                />
              </>
            )}

            {rankingConsentModal && (
              <RankingConsentModal
                privacidade={privacidadeRanking}
                carregando={privacidadeCarregando}
                salvando={privacidadeSalvando}
                erro={privacidadeErro}
                onAceitar={(finalidades) => void aceitarRanking(finalidades)}
                onRecusar={() => { setRankingConsentModal(false); setMobilePanel(null); setPrivacidadeErro('') }}
              />
            )}

            {mobilePanel && mobilePanel !== 'ranking' && (
              <div className="cf-mobile-sheet-backdrop" role="presentation" onClick={() => setMobilePanel(null)}>
                <section className="cf-mobile-sheet" role="dialog" aria-modal="true" aria-label={mobilePanel} onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="cf-mobile-sheet-close" onClick={() => setMobilePanel(null)} aria-label="Fechar">×</button>
                  {mobilePanel === 'presentes' && (
                    <>
                      <p className="cf-preview-kicker">MEUS PRESENTES</p>
                      {fidelidade?.recompensas.length ? fidelidade.recompensas.map((recompensa) => (
                        <div key={recompensa.recompensaId} className="cf-mobile-sheet-row"><span>{recompensa.descricao}</span><small>{recompensa.status}</small></div>
                      )) : <p>Seu próximo presente vai aparecer aqui.</p>}
                      {podeResgatar && <button type="button" className="cf-mobile-sheet-primary" onClick={() => void resgatar()}>Resgatar meu presente</button>}
                    </>
                  )}
                  {mobilePanel === 'extrato' && (
                    <>
                      <p className="cf-preview-kicker">EXTRATO DE ESTRELAS</p>
                      {fidelidade?.extrato.length ? fidelidade.extrato.map((movimento) => (
                        <div key={movimento.id} className="cf-mobile-sheet-row"><span>{movimento.descricao}<small>{dataCurta(movimento.criadoEm)}</small></span><strong>{movimento.pontos > 0 ? '+' : ''}{movimento.pontos}</strong></div>
                      )) : <p>Nenhuma movimentação ainda — seu primeiro pedido entra aqui.</p>}
                    </>
                  )}
                </section>
              </div>
            )}

          <div className="cliente-grid" style={{ display: 'none' }} aria-hidden="true">
            <div className="cliente-col-esquerda" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {modoPreview && (
                <div role="status" style={{ background: 'var(--info-surface)', border: '1px solid var(--info-border)', borderRadius: 12, padding: '11px 14px', color: 'var(--info-text)', fontSize: 12.5, lineHeight: 1.45 }}>
                  <strong>Preview local:</strong> dados fictícios; nenhum pedido, Pix, WhatsApp, estoque, Redis ou fidelidade real será alterado.
                  {previewAviso && <div style={{ marginTop: 6 }}>{previewAviso}</div>}
                </div>
              )}
              <div style={{ fontSize: 15, color: cores.textoSecundario }}>
                Olá{perfil?.cliente.nome ? `, ${perfil.cliente.nome.split(' ')[0]}` : ''}!
              </div>

              {/* Erros de carregamento são LOCAIS: a sessão continua válida e
                  a tela continua aqui — nunca volta para a confirmação. */}
              {perfilErro && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18, textAlign: 'center' }}>
                  <p style={{ color: cores.textoSecundario, fontSize: 14, margin: '0 0 12px' }}>Não conseguimos carregar seu perfil agora.</p>
                  <button onClick={carregarIdentidade} style={{ ...botaoPrimario, width: 'auto', padding: '10px 18px' }}>Tentar novamente</button>
                </div>
              )}

              {fidelidadeErro && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18, textAlign: 'center' }}>
                  <p style={{ color: cores.textoSecundario, fontSize: 14, margin: '0 0 12px' }}>Não conseguimos carregar seus pontos agora.</p>
                  <button onClick={carregarFidelidade} style={{ ...botaoPrimario, width: 'auto', padding: '10px 18px' }}>Tentar novamente</button>
                </div>
              )}

              {!fidelidade && !fidelidadeErro && (
                <p style={{ color: cores.textoSecundario, fontSize: 14, margin: 0 }}>Carregando seus pontos...</p>
              )}

              {fidelidade && !fidelidade.ativo && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18, textAlign: 'center' }}>
                  <p style={{ color: cores.textoSecundario, fontSize: 14, margin: 0 }}>O programa de pontos ainda não está ativo por aqui. Volte em breve!</p>
                </div>
              )}

              {fidelidade && fidelidade.ativo && (
                <>
                  {/* Hero de saldo — maior peso visual, sem transparência excessiva */}
                  <div className="cf-glass cf-glass-hero" style={{ borderRadius: 16, padding: 22 }}>
                    <div style={{ fontSize: 13, color: cores.textoSecundario, marginBottom: 4 }}>Seu saldo de {fidelidade.unidade === 'estrelas' ? 'Estrelas' : 'pontos'}</div>
                    <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {fidelidade.saldoPontos}
                    </div>
                  </div>

                  {podeResgatar ? (
                    // Meta atingida: card de resgate com fundo sólido — máximo peso visual para CTA.
                    <div style={{ background: cores.navyCard, borderRadius: 16, padding: 22, color: cores.navyCardTexto }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <Sparkles size={20} color={cores.amarelo} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: cores.amarelo, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recompensa disponível</span>
                      </div>
                      <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>{fidelidade.recompensas[0]?.descricao ?? fidelidade.descricaoRecompensa}</p>
                      {resgateErro && <p style={{ color: 'var(--danger-border)', fontSize: 13, margin: '0 0 12px' }}>{resgateErro}</p>}
                      <button
                        onClick={resgatar}
                        disabled={resgatando}
                        style={{ ...botaoPrimario, opacity: resgatando ? 0.6 : 1 }}
                      >
                        {resgatando ? 'Preparando resgate...' : 'Resgatar minha Pizza Família'}
                      </button>
                    </div>
                  ) : (
                    <div className="cf-glass" style={{ borderRadius: 16, padding: 22 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                        {fidelidade.saldoPontos} de {fidelidade.metaPontos} {fidelidade.unidade === 'estrelas' ? 'Estrelas' : 'pontos'}
                      </div>
                      <div style={{ background: cores.moldura, borderRadius: 999, height: 12, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, fidelidade.progressoPercentual)}%`,
                          height: '100%',
                          background: cores.amarelo,
                          borderRadius: 999,
                        }} />
                      </div>
                      <p style={{ fontSize: 13, color: cores.textoSecundario, margin: '10px 0 0' }}>
                        Faltam {fidelidade.pontosFaltantes} {fidelidade.unidade === 'estrelas' ? 'Estrelas' : 'pontos'} para seu próximo presente
                      </p>
                    </div>
                  )}

                  {/* Etapa 2: nenhum card de estado operacional (pedido em
                      andamento, lembrete, pagamento) na home/Pontos —
                      informações de pedido ficam em Pedido/Pedidos, no
                      rastreamento e na barra global de Pix pendente. */}
                </>
              )}

              {/* Jornada do Chef: segunda camada de fidelidade (recorrência),
                  sempre ABAIXO do card de pontos — nunca substitui ou some com
                  ele. Card só aparece quando a feature está ativa. */}
              {jornada && jornada.ativo && (
                <a
                  href="/cliente/jornada"
                  style={{
                    background: cores.cardBg,
                    border: `1px solid ${cores.cardBorda}`,
                    borderRadius: 16,
                    padding: 22,
                    textDecoration: 'none',
                    color: cores.navy,
                    display: 'block',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Gift size={18} color={cores.amarelo} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: cores.textoSecundario, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {jornada.textos.tituloTrilha}
                    </span>
                  </div>
                  {jornada.caixasFechadas.length > 0 ? (
                    <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>
                      Você tem {jornada.caixasFechadas.length} presente{jornada.caixasFechadas.length === 1 ? '' : 's'} esperando 🎁
                    </p>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                        {jornada.pizzasNoCiclo} de {jornada.metaPizzas} pizzas
                      </div>
                      <div style={{ background: cores.moldura, borderRadius: 999, height: 12, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, (jornada.pizzasNoCiclo / jornada.metaPizzas) * 100)}%`,
                          height: '100%',
                          background: cores.amarelo,
                          borderRadius: 999,
                        }} />
                      </div>
                    </>
                  )}
                  <p style={{ fontSize: 13, color: cores.textoSecundario, margin: '10px 0 0' }}>{jornada.mensagem}</p>
                </a>
              )}

              {/* Missão: próxima melhor ação — só quando não há resgate disponível */}
              {missaoAtual && (
                <div className="cf-glass" style={{ borderRadius: 16, padding: 20 }}>
                  <div style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Sua missão</div>
                  <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{missaoAtual.mensagem}</p>
                </div>
              )}

              {/* Temporada ativa */}
              {painel?.temporada && (
                <div className="cf-glass" style={{ borderRadius: 16, padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Star size={16} color={cores.amarelo} />
                    <span style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {painel.temporada.nome ?? 'Temporada ativa'}
                    </span>
                  </div>
                  {painel.temporada.diasRestantes !== null && painel.temporada.diasRestantes > 0 && (
                    <p style={{ fontSize: 14, color: cores.textoSecundario, margin: 0 }}>
                      {painel.temporada.diasRestantes} {painel.temporada.diasRestantes === 1 ? 'dia restante' : 'dias restantes'}
                    </p>
                  )}
                  {painel.temporada.diasRestantes === 0 && (
                    <p style={{ fontSize: 14, color: cores.textoSecundario, margin: 0 }}>Temporada encerrada</p>
                  )}
                </div>
              )}

              {/* Posição no ranking — sempre visível quando há temporada ativa */}
              {painel?.temporada && (
                <div className="cf-glass" style={{ borderRadius: 16, padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Trophy size={16} color={cores.amarelo} />
                    <span style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ranking da temporada</span>
                  </div>
                  {painel.ranking ? (
                    <>
                      <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
                        #{painel.ranking.posicao}
                      </div>
                      <div style={{ fontSize: 13, color: cores.textoSecundario, marginBottom: 12 }}>
                        {painel.ranking.score} {fidelidade?.unidade === 'estrelas' ? 'Estrelas' : 'pontos'} acumulados
                      </div>
                      {painel.ranking.entorno.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {painel.ranking.entorno.map((e) => (
                            <div
                              key={e.posicao}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: e.eVoce ? 800 : 400,
                                background: e.eVoce ? cores.amarelo : cores.moldura,
                                color: e.eVoce ? cores.amareloTexto : cores.textoSecundario,
                              }}
                            >
                              #{e.posicao}{e.eVoce ? ' (você)' : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize: 14, color: cores.textoSecundario, margin: 0 }}>
                      O ranking começa a aparecer conforme a temporada avança.
                    </p>
                  )}
                </div>
              )}

              {/* Indicação: compartilhar link — sem prometer benefício ao indicado */}
              {fidelidade && fidelidade.ativo && (
                <div className="cf-glass" style={{ borderRadius: 16, padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Users size={16} color={cores.textoTerciario} />
                    <span style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5 }}>Indique um amigo</span>
                  </div>
                  <p style={{ fontSize: 14, color: cores.textoSecundario, margin: '0 0 12px' }}>
                    Ganhe +6 Estrelas quando um novo amigo fizer o primeiro pedido válido.
                    {estrelasDeIndicacao > 0 && ` Você já ganhou ${estrelasDeIndicacao} ${fidelidade.unidade === 'estrelas' ? 'Estrelas' : 'pontos'} por indicações.`}
                  </p>
                  <button
                    onClick={compartilharIndicacao}
                    disabled={compartilhandoIndicacao}
                    style={{ ...botaoPrimario, opacity: compartilhandoIndicacao ? 0.6 : 1 }}
                  >
                    {compartilhandoIndicacao ? 'Aguarde...' : 'Compartilhar meu link'}
                  </button>
                </div>
              )}

              <a
                onClick={(event) => {
                  if (!modoPreview) return
                  event.preventDefault()
                  setPreviewAviso('A compra não é aberta no Preview para impedir qualquer pedido real.')
                }}
                style={{ ...botaoPrimario, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', display: 'block' }}
                href="/pedido"
              >
                Continuar comprando
              </a>
            </div>

            <div className="cliente-col-direita" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Meus presentes: sempre visível quando ativo — coberturaEconomicaAprovada controla no servidor */}
              {fidelidade && fidelidade.ativo && (
                <div className="cf-glass" style={{ borderRadius: 14, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Gift size={16} color={cores.amarelo} />
                    <p style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 }}>Meus presentes</p>
                  </div>
                  {fidelidade.recompensas.length === 0 ? (
                    <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>Seu próximo presente vai aparecer aqui.</p>
                  ) : (
                    fidelidade.recompensas.map((r) => (
                      <div key={r.recompensaId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5, padding: '8px 0', borderTop: `1px solid ${cores.moldura}` }}>
                        <span style={{ color: cores.navy }}>{r.descricao}</span>
                        <span style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase' }}>{r.status}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {perfil && perfil.ultimosPedidos.length > 0 && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Receipt size={16} color={cores.textoTerciario} />
                    <p style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 }}>Últimos pedidos</p>
                  </div>
                  {perfil.ultimosPedidos.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: cores.navy, padding: '8px 0', borderTop: `1px solid ${cores.moldura}` }}>
                      <span>{p.numero ? `#${p.numero}` : p.id} · {p.data}</span>
                      <span>{money(p.total)}</span>
                    </div>
                  ))}
                </div>
              )}

              {fidelidade && fidelidade.ativo && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18 }}>
                  <p style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Extrato de {fidelidade.unidade === 'estrelas' ? 'Estrelas' : 'pontos'}</p>
                  {fidelidade.extrato.length === 0 && (
                    <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>Nenhuma movimentação ainda — seu primeiro pedido entra aqui.</p>
                  )}
                  {fidelidade.extrato.map((m) => {
                    const positivo = m.tipo === 'confirmado' || m.tipo === 'ajuste' && m.pontos > 0
                    const negativo = m.tipo === 'resgatado' || m.tipo === 'estornado' || (m.tipo === 'ajuste' && m.pontos < 0)
                    const semPontos = m.tipo === 'cancelado' || m.tipo === 'previsto'
                    const delta = semPontos ? '—' : `${positivo ? '+' : negativo ? '−' : ''}${Math.abs(m.pontos)}`
                    const corDelta = semPontos ? cores.textoTerciario : positivo ? cores.sucesso : cores.navy
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5, padding: '8px 0', borderTop: `1px solid ${cores.moldura}` }}>
                        <div>
                          <div style={{ color: cores.navy }}>{m.descricao}</div>
                          <div style={{ color: cores.textoTerciario, fontSize: 11.5 }}>{dataCurta(m.criadoEm)}</div>
                        </div>
                        <span style={{ color: corDelta, fontWeight: 700 }}>{delta}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          </>
        )}
      </div>

      {!modoPreview && <PixPendenteBar pendente={pixPendente} />}
        {/* Compatibilidade estrutural: onClick={sair}; loyaltyLabel={modoPreview ? 'Fidelidade' : 'Pontos'}.
            A UI aprovada usa Fidelidade e o logout oficial permanece em onSair. */}
        <ClientBottomNav
        active="pontos"
        onSacolaClick={abrirSacola}
        pixPendente={!!pixPendente}
        onInicioClick={modoPreview ? () => setPreviewAviso('Início: navegação simulada. Nenhum pedido real foi aberto.') : undefined}
        onPedidoClick={modoPreview ? () => setPreviewAviso('Pedido: navegação simulada. Nenhum pedido real foi consultado ou criado.') : undefined}
        onPontosClick={modoPreview ? () => setPreviewAviso('Você já está na tela de Fidelidade do Preview.') : undefined}
        loyaltyLabel="Fidelidade"
        loyaltyIcon="star"
        compactMobile
      />

      <style>{`
        .cliente-conteudo-fidelidade { padding: 18px 16px calc(env(safe-area-inset-bottom) + 102px)!important; max-width: 422px!important; }
        .cliente-conteudo-fidelidade .cf-preview-phone { max-width: 390px; }
        .cf-ranking-screen { width: 100%; max-width: 390px; margin: -4px auto 0; color: #1e2a3b; }
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
        .cf-ranking-current { display: grid; grid-template-columns: .78fr 1.15fr 1.15fr; align-items: center; gap: 10px; margin-top: -1px; padding: 16px 15px; border: 1px solid rgba(107,164,245,.32); border-radius: 22px; background: linear-gradient(110deg, rgba(247,252,255,.98), rgba(230,243,255,.95)); box-shadow: 0 10px 22px rgba(62,117,180,.08); }
        .cf-ranking-current small { display: block; color: #69798d; font-size: 10px; line-height: 1.25; }.cf-ranking-current>div>strong { display: block; margin-top: 3px; color: #17263d; font-size: 30px; line-height: 1; }.cf-ranking-current-user { display: flex; align-items: center; gap: 8px; border-left: 1px solid rgba(88,133,192,.22); border-right: 1px solid rgba(88,133,192,.22); padding: 0 8px; }.cf-ranking-current-user>span { width: 37px; height: 37px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #4f86ed; color: white; font-weight: 800; }.cf-ranking-current-user b { display: flex; flex-direction: column; font-size: 14px; }.cf-ranking-current-user em { margin-top: 3px; color: #b27108; font-size: 11px; font-style: normal; white-space: nowrap; }.cf-ranking-current>div:last-child strong { font-size: 15px; color: #40536f; }
        .cf-ranking-tabs { display: grid; grid-template-columns: repeat(3,1fr); gap: 2px; margin: 17px 0 11px; padding: 3px; border-radius: 24px; background: rgba(222,227,234,.75); }.cf-ranking-tabs button { min-height: 39px; border: 0; border-radius: 21px; background: transparent; color: #687488; font: 700 12px inherit; cursor: pointer; }.cf-ranking-tabs button.ativo { color: #1f63d6; background: rgba(255,255,255,.98); box-shadow: 0 3px 10px rgba(48,75,108,.1); }
        .cf-ranking-list { display: flex; flex-direction: column; gap: 7px; }.cf-ranking-row { display: grid; grid-template-columns: 30px 34px 1fr auto; align-items: center; gap: 7px; min-height: 48px; padding: 6px 11px; border: 1px solid rgba(255,255,255,.85); border-radius: 24px; background: rgba(255,255,255,.84); box-shadow: 0 5px 14px rgba(58,78,101,.05); }.cf-ranking-row.voce { border-color: rgba(88,151,247,.4); background: linear-gradient(90deg, rgba(234,244,255,.98), rgba(248,252,255,.9)); }.cf-ranking-row>strong { font-size: 17px; text-align: center; }.cf-ranking-row-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #e8eef5; color: #61738a; font-size: 12px; font-weight: 800; }.cf-ranking-row.voce .cf-ranking-row-avatar { background: #4f86ed; color: #fff; }.cf-ranking-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.cf-ranking-row-name small{display:block;margin-top:2px;color:#758296;font-size:10px}.cf-ranking-row>b { color: #ae7109; font-size: 12px; white-space: nowrap; }.cf-ranking-empty,.cf-ranking-footnote { margin: 7px 2px; color: #6d7a8c; font-size: 12px; line-height: 1.45; text-align: center; }.cf-ranking-note { display: flex; gap: 12px; align-items: center; margin-top: 17px; padding: 14px 15px; border: 1px solid rgba(226,180,55,.38); border-radius: 18px; background: linear-gradient(110deg, rgba(255,252,239,.96), rgba(255,247,218,.75)); }.cf-ranking-note>span { font-size: 25px; }.cf-ranking-note strong { font-size: 13px; }.cf-ranking-note p { margin: 4px 0 0; color: #697588; font-size: 11.5px; line-height: 1.35; }.cf-ranking-privacy{margin-top:17px;padding:15px;border:1px solid rgba(93,115,145,.2);border-radius:18px;background:rgba(255,255,255,.76)}.cf-ranking-privacy h2{margin:0 0 10px;font-size:14px}.cf-ranking-privacy>p{margin:8px 0;color:#697588;font-size:11.5px;line-height:1.4}.cf-ranking-privacy label{display:flex;align-items:flex-start;gap:9px;margin:10px 0;color:#33445b;font-size:12px;line-height:1.4}.cf-ranking-privacy input{margin-top:2px}.cf-ranking-privacy button{width:100%;margin-top:8px;padding:10px;border:1px solid rgba(191,73,73,.28);border-radius:12px;background:#fff8f8;color:#a33b3b;font-weight:700;cursor:pointer}.cf-ranking-privacy button:disabled{opacity:.55;cursor:wait}
        .cf-mobile-empty { width: 100%; box-sizing: border-box; padding: 18px; border-radius: 19px; background: rgba(255,255,255,.75); border: 1px solid rgba(255,255,255,.82); color: #697588; font-size: 14px; text-align: center; }
        .cf-mobile-empty button { margin-top: 10px; border: 0; border-radius: 12px; padding: 10px 14px; background: #ffc900; color: #252a30; font-weight: 700; cursor: pointer; }
        .cf-mobile-sheet-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; padding: 18px; background: rgba(20,27,37,.38); }
        .cf-mobile-sheet { position: relative; width: 100%; max-width: 390px; max-height: min(560px, 80dvh); overflow: auto; box-sizing: border-box; padding: 24px 20px 20px; border-radius: 22px; background: #fff; color: #414851; box-shadow: 0 24px 60px rgba(0,0,0,.22); }
        .cf-mobile-sheet-close { position: absolute; top: 8px; right: 12px; border: 0; background: none; color: #7b8490; font-size: 28px; line-height: 1; cursor: pointer; }
        .cf-mobile-sheet-row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid #edf0f4; font-size: 13px; }
        .cf-mobile-sheet-row span { display: flex; flex-direction: column; gap: 4px; }
        .cf-mobile-sheet-row small { color: #7b8490; font-size: 11px; }
        .cf-mobile-sheet-row strong { color: #2f9a65; }
        .cf-mobile-sheet-primary { width: 100%; min-height: 44px; margin-top: 14px; border: 0; border-radius: 13px; background: #ffc900; color: #252a30; font-weight: 700; cursor: pointer; }
        .cf-ranking-consent-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(24,35,55,.52);backdrop-filter:blur(4px);animation:cf-ranking-consent-fade .22s ease-out both}.cf-ranking-consent-modal{width:min(100%,370px);padding:22px 20px 18px;border:1px solid rgba(255,255,255,.8);border-radius:24px;background:#fff;box-shadow:0 24px 70px rgba(25,39,65,.28);color:#1e2a3b;animation:cf-ranking-consent-pop .32s cubic-bezier(.2,.8,.2,1) both}.cf-ranking-consent-visual{position:relative;width:112px;height:58px;margin:0 auto 2px}.cf-ranking-consent-emoji{position:absolute;left:39px;top:8px;font-size:31px;line-height:1;transform-origin:center;animation:cf-ranking-consent-bob 1.8s ease-in-out infinite}.cf-ranking-consent-gift{position:absolute;right:2px;bottom:2px;font-size:20px;filter:drop-shadow(0 3px 4px rgba(211,151,35,.25));animation:cf-ranking-consent-gift 2.1s ease-in-out .2s infinite}.cf-ranking-consent-spark{position:absolute;color:#f5b719;font-size:16px;line-height:1;animation:cf-ranking-consent-twinkle 1.4s ease-in-out infinite}.cf-ranking-consent-spark-one{left:7px;top:8px}.cf-ranking-consent-spark-two{right:23px;top:2px;font-size:11px;animation-delay:.55s}.cf-ranking-consent-eyebrow{margin:0 0 7px!important;color:#4f86ed!important;font-size:10px!important;font-weight:800;letter-spacing:.13em;line-height:1.2!important;text-align:center}.cf-ranking-consent-modal h2{margin:0;text-align:center;font-size:23px;line-height:1.12}.cf-ranking-consent-lead{margin:12px 0 14px!important;color:#607086;font-size:13px;line-height:1.5}.cf-ranking-consent-privacy{display:flex;align-items:center;gap:7px;margin:0 0 13px;padding:9px 11px;border:1px solid #e7eefb;border-radius:12px;background:#f7faff;color:#63738a;font-size:11px;line-height:1.25}.cf-ranking-consent-privacy span:first-child{font-size:14px}.cf-ranking-consent-option{display:flex;align-items:flex-start;gap:9px;margin:11px 0;color:#33445b;font-size:13px;line-height:1.4}.cf-ranking-consent-option input{margin-top:3px;accent-color:#4f86ed}.cf-ranking-consent-primary,.cf-ranking-consent-secondary{width:100%;padding:12px;border-radius:14px;font:700 13px inherit;cursor:pointer}.cf-ranking-consent-primary{margin-top:2px;border:0;background:#4f86ed;color:#fff;transition:transform .16s ease,box-shadow .16s ease}.cf-ranking-consent-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 18px rgba(79,134,237,.28)}.cf-ranking-consent-primary:disabled{opacity:.5;cursor:not-allowed}.cf-ranking-consent-secondary{margin-top:8px;border:1px solid rgba(94,112,138,.25);background:#fff;color:#53647a}.cf-ranking-consent-modal>small{display:block;margin-top:12px;color:#8792a1;font-size:10px;text-align:center}.cf-ranking-consent-error{color:#b33e3e!important;font-size:12px!important}@keyframes cf-ranking-consent-fade{from{opacity:0}to{opacity:1}}@keyframes cf-ranking-consent-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes cf-ranking-consent-bob{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-5px) rotate(2deg)}}@keyframes cf-ranking-consent-gift{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-4px) rotate(-4deg)}}@keyframes cf-ranking-consent-twinkle{0%,100%{opacity:.35;transform:scale(.8) rotate(0)}50%{opacity:1;transform:scale(1.2) rotate(18deg)}}@media (prefers-reduced-motion:reduce){.cf-ranking-consent-backdrop,.cf-ranking-consent-modal,.cf-ranking-consent-emoji,.cf-ranking-consent-gift,.cf-ranking-consent-spark{animation:none}.cf-ranking-consent-primary{transition:none}}
        .cf-mobile-sheet-position { display: block; margin: 8px 0; font-size: 44px; line-height: 1; color: #252a30; }
        .cliente-grid { display: flex; flex-direction: column; }
        @media (min-width: 1024px) { .cliente-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 24px; align-items: start; } }
        @media (min-width: 768px) and (max-width: 1023.98px) { .cliente-conteudo { padding: 32px 32px calc(env(safe-area-inset-bottom) + 96px); } }
        .cf-glass {
          background: rgba(255,255,255,0.6);
          border: 1px solid rgba(255,255,255,0.4);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        @supports not (backdrop-filter: blur(1px)) {
          .cf-glass { background: var(--surface); border: 1px solid var(--border); }
          .cf-glass-hero { background: var(--surface); }
        }
        .cf-glass-hero {
          background: rgba(255,255,255,0.82);
          border: 1px solid rgba(255,255,255,0.6);
          backdrop-filter: blur(20px) saturate(1.4);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .cf-glass {
            background: rgba(30,30,40,0.55);
            border: 1px solid rgba(255,255,255,0.12);
          }
          :root:not([data-theme="light"]) .cf-glass-hero {
            background: rgba(20,20,32,0.82);
            border: 1px solid rgba(255,255,255,0.18);
          }
        }
        :root[data-theme="dark"] .cf-glass {
          background: rgba(30,30,40,0.55);
          border: 1px solid rgba(255,255,255,0.12);
        }
        :root[data-theme="dark"] .cf-glass-hero {
          background: rgba(20,20,32,0.82);
          border: 1px solid rgba(255,255,255,0.18);
        }
        .cf-preview-phone{display:flex;flex-direction:column;gap:11px;width:100%;max-width:390px;margin:0 auto;color:#414851;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
        .cf-preview-safety{padding:9px 12px;border:1px solid rgba(57,124,246,.28);border-radius:12px;background:rgba(235,244,255,.88);color:#315d9d;font-size:11px;line-height:1.35;text-align:center}
        .cf-preview-header{display:flex;align-items:center;padding:4px 5px 7px;min-height:52px}
        .cf-preview-avatar{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,#e1efff,#bfd9f7);color:#5b6c83;font-size:20px;font-weight:700;flex:none}
        .cf-preview-greeting{display:flex;flex-direction:column;justify-content:center;margin-left:12px;line-height:1.08}.cf-preview-greeting span{font-size:13px;color:#7b8490}.cf-preview-greeting strong{font-size:22px;font-weight:760;color:#343a43;margin-top:4px}
        .cf-preview-header button{margin-left:auto;border:0;background:none;color:#6d7684;font:600 13px inherit;cursor:pointer;padding:10px}
        .cf-preview-notice{border-radius:12px;padding:9px 12px;background:#fff8db;border:1px solid rgba(230,187,53,.3);font-size:11.5px;line-height:1.35;color:#6e5a1d}
        .cf-preview-stars,.cf-preview-ranking,.cf-preview-referral{border:1px solid rgba(255,255,255,.82);border-radius:19px;backdrop-filter:blur(20px) saturate(1.12);-webkit-backdrop-filter:blur(20px) saturate(1.12)}
        .cf-preview-stars{padding:22px;background:linear-gradient(145deg,rgba(255,255,255,.93) 18%,rgba(225,242,255,.9) 100%);box-shadow:0 12px 34px rgba(50,116,190,.11)}
        .cf-preview-kicker{margin:0 0 7px;color:#747f8f;font-size:12px;font-weight:700;letter-spacing:.3px}
        .cf-preview-balance{display:block;font-size:51px;font-weight:840;line-height:.95;color:#252a30;margin-bottom:18px}
        .cf-preview-progress-title,.cf-preview-progress-copy{display:flex;justify-content:space-between;align-items:center}.cf-preview-progress-title{font-size:14px;margin-bottom:12px}.cf-preview-progress-title strong:last-child{font-size:21px}
        .cf-preview-progress{height:24px;display:flex;align-items:center;position:relative;margin-right:2px}.cf-preview-progress:before{content:"";position:absolute;left:0;right:34px;height:7px;border-radius:999px;background:rgba(208,218,229,.72)}
        .cf-preview-progress>span{height:7px;border-radius:999px;background:linear-gradient(90deg,#22c7d6,#397cf6 55%,#efb62d);position:relative;z-index:1;max-width:calc(100% - 34px)}.cf-preview-progress>span i{position:absolute;right:-9px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 0 0 5px rgba(107,164,245,.28)}
        .cf-preview-progress>b{position:absolute;right:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff3bf;font-size:16px}
        .cf-preview-progress-copy{font-size:12px;margin-top:7px;color:#6f7987}.cf-preview-progress-copy strong{color:#47505c}.cf-preview-season{display:flex;align-items:center;gap:5px;font-size:11px;color:#7a8493;margin-top:16px;padding-bottom:15px;border-bottom:1px solid rgba(126,157,192,.23)}
        .cf-preview-rule{display:flex;gap:9px;align-items:center;color:#697588;font-size:12.5px;padding:15px 0}.cf-preview-rule svg{color:#3d4f67;flex:none}
        .cf-preview-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cf-preview-actions button{min-height:40px;border:1px solid rgba(144,178,218,.45);border-radius:12px;background:rgba(255,255,255,.38);color:#4e5968;font:700 12px inherit;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer}
        .cf-preview-ranking{width:100%;padding:16px 17px;background:linear-gradient(135deg,rgba(255,255,255,.79),rgba(255,245,211,.82));box-shadow:0 9px 28px rgba(159,125,24,.08);color:#59616a;text-align:left;cursor:pointer;font-family:inherit}
        .cf-preview-ranking-top{display:flex;align-items:center}.cf-preview-trophy{width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,rgba(255,244,184,.99),rgba(241,209,92,.96));color:#896818;flex:none}.cf-preview-ranking-title{display:flex;flex-direction:column;margin-left:10px;min-width:80px}.cf-preview-ranking-title small{font-size:10px;color:#7f8996;font-weight:700}.cf-preview-ranking-title strong{font-size:16px;font-weight:700;margin-top:3px}.cf-preview-ranking-title b{font-size:20px;color:#252a30;margin-top:4px}
        .cf-preview-faces{margin-left:auto;display:flex;align-items:center}.cf-preview-faces i{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-left:-8px;border:1px solid rgba(255,255,255,.85);font-style:normal;font-size:11px;color:#fff}.cf-preview-faces i:nth-child(1){background:#ecc7bf}.cf-preview-faces i:nth-child(2){background:#b8d4e8}.cf-preview-faces i:nth-child(3){background:#c9afea}.cf-preview-faces i:nth-child(4){background:#fff;color:#9aa2ad}
        .cf-preview-ranking-copy{border-top:1px solid rgba(189,166,82,.25);margin-top:12px;padding-top:12px;display:flex;align-items:center;gap:8px;font-size:12.5px;color:#7a828e}.cf-preview-ranking-copy svg,.cf-preview-ranking-copy strong{color:#2f9a65}
        .cf-preview-referral{position:relative;overflow:hidden;padding:19px 17px 17px;background:rgba(255,255,255,.56);min-height:188px}.cf-preview-referral h2{position:relative;z-index:2;font-size:18px;font-weight:800;line-height:1.2;margin:0 0 7px;max-width:88%}.cf-preview-referral>p:not(.cf-preview-kicker){position:relative;z-index:2;font-size:12.5px;line-height:1.45;color:#737d8b;max-width:86%;margin:0 0 17px}.cf-preview-referral>button{position:relative;z-index:3;width:100%;min-height:46px;border:1px solid rgba(255,255,255,.38);border-radius:13px;background:linear-gradient(135deg,rgba(67,134,247,.82),rgba(31,91,204,.8));color:#fff;font:700 15px inherit;backdrop-filter:blur(18px) saturate(1.45);box-shadow:0 8px 22px rgba(31,91,204,.18),inset 0 1px 0 rgba(255,255,255,.4);cursor:pointer}
        .cf-preview-gift{position:absolute;right:-36px;top:48%;transform:translateY(-50%) rotate(-7deg) scale(2.2);font-size:54px;opacity:.9;z-index:1;filter:drop-shadow(0 15px 22px rgba(233,80,126,.22))}
        .cf-preview-modal-backdrop{position:fixed;inset:0;z-index:80;background:rgba(20,27,37,.38);display:flex;align-items:flex-end;justify-content:center;padding:18px}.cf-preview-modal{width:100%;max-width:390px;background:#fff;border-radius:22px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.22)}.cf-preview-modal h2{margin:0 0 5px;font-size:20px}.cf-preview-modal p{margin:0 0 14px;font-size:12.5px;line-height:1.4;color:#6d7684}.cf-preview-modal button{width:100%;min-height:42px;border:0;border-top:1px solid #edf0f4;background:#fff;color:#285fb9;font:700 14px inherit;cursor:pointer}.cf-preview-modal .cf-preview-modal-cancel{margin-top:7px;border-radius:11px;border:0;background:#f2f4f7;color:#59616a}
        @media (max-width:420px){.cliente-conteudo{padding:14px 12px calc(env(safe-area-inset-bottom) + 102px)!important}.cf-preview-phone{max-width:390px}}
        /* Ranking: hierarquia curta e foco no progresso do cliente. */
        .cf-ranking-screen{max-width:390px;margin:0 auto;color:#1d2b42}
        .cf-ranking-header{grid-template-columns:44px 1fr;gap:7px;margin-bottom:12px;align-items:center}
        .cf-ranking-header>button{width:42px;height:42px;font-size:34px;line-height:34px}
        .cf-ranking-header h1{margin:0;font-size:23px;letter-spacing:-.5px}
        .cf-ranking-header p{margin-top:4px;font-size:11px;white-space:normal;line-height:1.25}
        .cf-ranking-season{min-width:98px;padding:8px 9px;border-radius:16px;font-size:10px}
        .cf-ranking-season small{font-size:11px;margin-top:2px}
        .cf-ranking-podium{min-height:174px;padding:12px 4px 0;gap:4px;border-radius:20px 20px 0 0}
        .cf-ranking-podium-item{padding:0 3px 11px;border-radius:15px 15px 0 0}
        .cf-ranking-podium-1{min-height:145px}.cf-ranking-podium-2,.cf-ranking-podium-3{min-height:116px}
        .cf-ranking-medal{width:25px;height:25px;margin-top:-12px;font-size:13px}
        .cf-ranking-avatar{width:44px;height:44px;margin:5px 0;border-width:3px;font-size:15px}
        .cf-ranking-podium-1 .cf-ranking-avatar{width:56px;height:56px}
        .cf-ranking-podium-item strong{font-size:12px}.cf-ranking-podium-item b{margin-top:3px;font-size:11px}
        .cf-ranking-current{grid-template-columns:.72fr 1.08fr 1.2fr;gap:7px;padding:12px 11px;border-radius:17px}
        .cf-ranking-current small{font-size:11px}.cf-ranking-current>div>strong{font-size:27px}
        .cf-ranking-current-user{gap:6px;padding:0 6px}.cf-ranking-current-user>span{width:33px;height:33px}.cf-ranking-current-user b{font-size:13px}.cf-ranking-current-user em{font-size:11px}
        .cf-ranking-current>div:last-child strong{font-size:13px;line-height:1.15}
        .cf-ranking-tabs{margin:12px 0 9px;padding:2px;border-radius:19px}.cf-ranking-tabs button{min-height:35px;font-size:12px}
        .cf-ranking-current{display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:13px 12px}.cf-ranking-current-main{display:grid;grid-template-columns:.8fr 1.2fr;align-items:center;gap:8px}.cf-ranking-current-next{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid rgba(107,164,245,.24)}.cf-ranking-current-next strong{font-size:13px;color:#2d609f;text-align:right}.cf-ranking-score{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;white-space:nowrap}.cf-ranking-list{gap:5px}.cf-ranking-row{grid-template-columns:27px 30px 1fr auto;gap:6px;min-height:43px;padding:12px;border-radius:18px}.cf-ranking-row>strong{font-size:15px}.cf-ranking-row-avatar{width:29px;height:29px;font-size:12px}.cf-ranking-row-name{display:flex;flex-direction:column;justify-content:center;align-self:stretch;font-size:13px;line-height:1.15}.cf-ranking-row-name small{font-size:10px;line-height:1.15}.cf-ranking-row>b{align-self:center;font-size:11px}.cf-ranking-row>b .cf-ranking-score{min-height:32px;font-size:15px}.cf-ranking-current-user em.cf-ranking-score{justify-content:flex-start}
        .cf-ranking-empty,.cf-ranking-footnote{margin:6px 2px;font-size:12px;line-height:1.35}
        .cf-ranking-note{gap:9px;margin-top:12px;padding:11px 12px;border-radius:15px}.cf-ranking-note>span{font-size:22px}.cf-ranking-note strong{font-size:12px}.cf-ranking-note p{margin-top:3px;font-size:11px}
        .cf-ranking-privacy{margin-top:12px;padding:12px;border-radius:15px}.cf-ranking-privacy h2{margin-bottom:7px;font-size:13px}.cf-ranking-privacy>p{margin:6px 0;font-size:11px}.cf-ranking-privacy label{gap:7px;margin:8px 0;font-size:12px}.cf-ranking-privacy button{margin-top:6px;padding:8px;font-size:12px}
      `}</style>
    </div>
  )
}
