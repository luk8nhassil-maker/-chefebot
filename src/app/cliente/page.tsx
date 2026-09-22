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
    entorno: { posicao: number; eVoce: boolean }[]
    lista: { posicao: number; score: number; eVoce: boolean }[]
  } | null
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
    entorno: [
      { posicao: 7, eVoce: false },
      { posicao: 8, eVoce: true },
      { posicao: 9, eVoce: false },
    ],
    lista: [
      { posicao: 7, score: 22, eVoce: false },
      { posicao: 8, score: 20, eVoce: true },
      { posicao: 9, score: 18, eVoce: false },
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
  const progresso = Math.max(0, Math.min(100, FIDELIDADE_PREVIEW.progressoPercentual))
  const nome = PERFIL_PREVIEW.cliente.nome ?? 'Cliente'
  const primeiroNome = nome.split(' ')[0]
  const inicial = primeiroNome.slice(0, 1).toUpperCase()

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

      <button type="button" className="cf-preview-ranking" onClick={() => onAviso('Pódio Chefe aberto em modo demonstrativo, sem consultar dados reais.')}>
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
  onClose: () => void
}

/** Pódio detalhado: scores são reais; nomes, fotos e variações de terceiros
 * não são expostos porque a API do cliente deliberadamente não fornece PII. */
function FidelidadeRankingScreen({ ranking, temporada, onClose }: FidelidadeRankingScreenProps) {
  const [aba, setAba] = useState<'top10' | 'minha'>('top10')
  const lista = ranking.lista
  const podium = lista.filter((entrada) => entrada.posicao <= 3)
  const linhas = aba === 'minha' ? lista.filter((entrada) => entrada.eVoce) : lista
  const nomeSeguro = (entrada: { eVoce: boolean; posicao: number }) => entrada.eVoce ? 'Você' : `Participante ${entrada.posicao}`

  return (
    <main className="cf-ranking-screen" aria-label="Pódio Chefe">
      <header className="cf-ranking-header">
        <button type="button" onClick={onClose} aria-label="Voltar para Fidelidade">‹</button>
        <div>
          <h1>Pódio Chefe</h1>
          <p>Os clientes que mais brilham nesta temporada!</p>
        </div>
        <span className="cf-ranking-season"><strong>♛ Temporada atual</strong><small>{temporada?.diasRestantes == null ? 'em andamento' : `${temporada.diasRestantes} dias restantes`}</small></span>
      </header>

      <section className="cf-ranking-podium" aria-label="Melhores posições">
        {[2, 1, 3].map((posicao) => {
          const entrada = podium.find((item) => item.posicao === posicao)
          return (
            <div key={posicao} className={`cf-ranking-podium-item cf-ranking-podium-${posicao}`}>
              <div className="cf-ranking-medal">{posicao}</div>
              <div className="cf-ranking-avatar">{entrada?.eVoce ? 'Você'.slice(0, 1) : '★'}</div>
              <strong>{entrada ? nomeSeguro(entrada) : `Posição ${posicao}`}</strong>
              <b>{entrada ? `${entrada.score} Estrelas` : 'Aguardando dados'}</b>
            </div>
          )
        })}
      </section>

      <section className="cf-ranking-current" aria-label="Minha posição no ranking">
        <div><small>Sua posição</small><strong>{ranking.posicao}º</strong></div>
        <div className="cf-ranking-current-user"><span>{'Você'.slice(0, 1)}</span><b>Você<em>{ranking.score} Estrelas</em></b></div>
        <div><small>{ranking.posicao > 1 ? 'Continue acumulando Estrelas' : 'Você está no topo'}</small><strong>{ranking.posicao > 1 ? 'para subir' : 'parabéns!'}</strong></div>
      </section>

      <div className="cf-ranking-tabs" role="tablist" aria-label="Filtro do ranking">
        {([['top10', 'Top 10'], ['minha', 'Minha posição']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}>{label}</button>
        ))}
      </div>

      <section className="cf-ranking-list" aria-label="Lista de posições">
        {linhas.length === 0 ? <p className="cf-ranking-empty">Sua posição ainda não apareceu no ranking desta temporada.</p> : linhas.map((entrada) => (
          <div key={entrada.posicao} className={`cf-ranking-row ${entrada.eVoce ? 'voce' : ''}`}>
            <strong>{entrada.posicao}</strong>
            <span className="cf-ranking-row-avatar">{entrada.eVoce ? 'V' : '★'}</span>
            <span className="cf-ranking-row-name">{nomeSeguro(entrada)}</span>
            <b className="cf-ranking-row-score"><Star size={14} aria-hidden="true" /> {entrada.score}</b>
          </div>
        ))}
      </section>

      <section className="cf-ranking-note">
        <span>🏆</span><div><strong>Acumule Estrelas para subir</strong><p>A posição considera apenas as Estrelas válidas da temporada atual.</p></div>
      </section>
    </main>
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
  const [indicacaoToken, setIndicacaoToken] = useState<string | null>(null)
  const [compartilhandoIndicacao, setCompartilhandoIndicacao] = useState(false)
  const [resgatando, setResgatando] = useState(false)
  const [resgateErro, setResgateErro] = useState('')
  const [mobilePanel, setMobilePanel] = useState<'presentes' | 'extrato' | 'ranking' | null>(null)
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
          maxWidth: modoPreview ? 430 : step === 'perfil' ? 760 : 1180,
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
                onClose={() => setMobilePanel(null)}
              />
            )}
            {fidelidade && fidelidade.ativo && mobilePanel !== 'ranking' && (
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
                onRanking={() => setMobilePanel('ranking')}
                onIndicacao={() => void compartilharIndicacao()}
                indicando={compartilhandoIndicacao}
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
        .cliente-conteudo-fidelidade { padding: 18px 16px calc(env(safe-area-inset-bottom) + 102px)!important; max-width: 760px!important; }
        .cliente-conteudo-fidelidade .cf-preview-phone { max-width: 390px; }
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
        .cf-ranking-current { display: grid; grid-template-columns: .78fr 1.15fr 1.15fr; align-items: center; gap: 10px; margin-top: -1px; padding: 16px 15px; border: 1px solid rgba(107,164,245,.32); border-radius: 22px; background: linear-gradient(110deg, rgba(247,252,255,.98), rgba(230,243,255,.95)); box-shadow: 0 10px 22px rgba(62,117,180,.08); }
        .cf-ranking-current small { display: block; color: #69798d; font-size: 10px; line-height: 1.25; }.cf-ranking-current>div>strong { display: block; margin-top: 3px; color: #17263d; font-size: 30px; line-height: 1; }.cf-ranking-current-user { display: flex; align-items: center; gap: 8px; border-left: 1px solid rgba(88,133,192,.22); border-right: 1px solid rgba(88,133,192,.22); padding: 0 8px; }.cf-ranking-current-user>span { width: 37px; height: 37px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #4f86ed; color: white; font-weight: 800; }.cf-ranking-current-user b { display: flex; flex-direction: column; font-size: 14px; }.cf-ranking-current-user em { margin-top: 3px; color: #b27108; font-size: 11px; font-style: normal; white-space: nowrap; }.cf-ranking-current>div:last-child strong { font-size: 15px; color: #40536f; }
        .cf-ranking-tabs { display: grid; grid-template-columns: repeat(2,1fr); gap: 2px; margin: 17px 0 11px; padding: 3px; border-radius: 24px; background: rgba(222,227,234,.75); }.cf-ranking-tabs button { min-height: 39px; border: 0; border-radius: 21px; background: transparent; color: #687488; font: 700 12px inherit; cursor: pointer; }.cf-ranking-tabs button.ativo { color: #1f63d6; background: rgba(255,255,255,.98); box-shadow: 0 3px 10px rgba(48,75,108,.1); }
        .cf-ranking-list { display: flex; flex-direction: column; gap: 7px; }.cf-ranking-row { display: grid; grid-template-columns: 30px 34px 1fr auto; align-items: center; gap: 7px; min-height: 48px; padding: 6px 11px; border: 1px solid rgba(255,255,255,.85); border-radius: 24px; background: rgba(255,255,255,.84); box-shadow: 0 5px 14px rgba(58,78,101,.05); }.cf-ranking-row.voce { border-color: rgba(88,151,247,.4); background: linear-gradient(90deg, rgba(234,244,255,.98), rgba(248,252,255,.9)); }.cf-ranking-row>strong { font-size: 17px; text-align: center; }.cf-ranking-row-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #e8eef5; color: #61738a; font-size: 12px; font-weight: 800; }.cf-ranking-row.voce .cf-ranking-row-avatar { background: #4f86ed; color: #fff; }.cf-ranking-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.cf-ranking-row-score { display: inline-flex; align-items: center; gap: 4px; color: #ae7109; font-size: 12px; white-space: nowrap; }.cf-ranking-empty { margin: 7px 2px; color: #6d7a8c; font-size: 12px; line-height: 1.45; text-align: center; }.cf-ranking-note { display: flex; gap: 12px; align-items: center; margin-top: 17px; padding: 14px 15px; border: 1px solid rgba(226,180,55,.38); border-radius: 18px; background: linear-gradient(110deg, rgba(255,252,239,.96), rgba(255,247,218,.75)); }.cf-ranking-note>span { font-size: 25px; }.cf-ranking-note strong { font-size: 13px; }.cf-ranking-note p { margin: 4px 0 0; color: #697588; font-size: 11.5px; line-height: 1.35; }
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
        @media (max-width:420px){.cliente-conteudo{padding:14px 12px calc(env(safe-area-inset-bottom) + 102px)!important}.cliente-conteudo-fidelidade{max-width:430px!important}.cf-preview-phone,.cf-ranking-screen{max-width:390px}}
        @media (min-width:421px){.cf-ranking-podium{min-height:270px;padding-left:24px;padding-right:24px}.cf-ranking-podium-1{min-height:230px}.cf-ranking-podium-2,.cf-ranking-podium-3{min-height:190px}.cf-ranking-current{padding-left:24px;padding-right:24px}.cf-ranking-list{max-width:680px;margin-left:auto;margin-right:auto}}
      `}</style>
    </div>
  )
}
