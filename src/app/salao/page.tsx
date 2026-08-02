"use client"

// Interface do Módulo Salão — comandas de mesa, completamente separada do
// painel administrativo (/pedidos). Reaproveita EXCLUSIVAMENTE o catálogo, o
// motor de preço e o motor de pedido já oficiais (src/lib/montagemManual.ts e
// POST /api/pedido-app, chamado internamente pelas rotas de envio do Salão) —
// nenhuma lógica de catálogo/preço/pedido paralela vive aqui.
//
// Fluxo direto ao catálogo: "Começar novo atendimento" abre a comanda (ainda
// anônima — sem cliente/mesa) direto na tela de produtos, nunca num
// formulário antes. Cliente/mesa/WhatsApp só são pedidos na revisão, depois
// que já existe pelo menos um item — a identificação é a ÚLTIMA etapa antes
// do envio, nunca a primeira. A estrutura técnica de rodadas continua
// exatamente a mesma no backend; esta tela só decide como e quando chamar
// cada rota já existente.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Printer,
  ReceiptText,
  Search,
  Users,
  X,
} from "lucide-react"
import type { ItemApp } from "@/lib/pedidoAppItens"
import { gerarClientRequestId } from "@/survival/clientRequestId"
import {
  CATEGORIAS,
  listarProdutosManuais,
  buscarProdutos,
  montarEtapas,
  etapaSatisfeita,
  indiceEtapaPendente,
  montagemCompleta,
  motivoBloqueio,
  resumoEtapa,
  alternarSabor,
  construirItemManual,
  selecaoVazia,
  adaptarCardapioParaMontagem,
  type CategoriaManual,
  type MenuManual,
  type ProdutoManual,
  type SelecaoMontagem,
} from "@/lib/montagemManual"

// ---------------------------------------------------------------------------
// Modelo de dados (espelha src/lib/comandas.ts) — nomes técnicos só aqui;
// toda a UI abaixo fala "Pedido inicial"/"Complemento N"/estados humanos.
// ---------------------------------------------------------------------------

type StatusComanda = "aberta" | "enviada" | "fechada"
type StatusRodada = "rascunho" | "enviando" | "enviada" | "falha_envio"

type Rodada = {
  id: string
  numero: number
  status: StatusRodada
  itens: ItemApp[]
  observacao?: string
  subtotal: number
  criadaEm: string
  atualizadaEm: string
  enviadaEm?: string
  pedidoId?: string
  pedidoNumero?: number
  erroUltimaTentativa?: string
}

type Comanda = {
  id: string
  numero: number
  cliente?: string
  mesa?: string
  whatsapp?: string
  complemento?: string
  itens: ItemApp[]
  observacao?: string
  status: StatusComanda
  abertaEm: string
  pedidoId?: string
  pedidoNumero?: number
  rodadas?: Rodada[]
  totalParcial?: number
}

// ---------------------------------------------------------------------------
// Utilidades de exibição — nenhuma delas decide preço/estoque, só como
// mostrar o que o backend já calculou.
// ---------------------------------------------------------------------------

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",")

function tempoDecorrido(desdeIso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(desdeIso).getTime()) / 60000))
  if (min < 1) return "agora"
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${m.toString().padStart(2, "0")}`
}

function identificacaoCliente(c: Pick<Comanda, "cliente" | "mesa">): string {
  return c.cliente || (c.mesa ? `Mesa ${c.mesa}` : "Cliente")
}

function identificacaoMesa(c: Pick<Comanda, "mesa" | "complemento">): string {
  if (!c.mesa) return "Sem mesa"
  return c.complemento ? `Mesa ${c.mesa} (${c.complemento})` : `Mesa ${c.mesa}`
}

function rotuloRodada(r: Pick<Rodada, "numero">): string {
  return r.numero === 1 ? "Pedido inicial" : `Complemento ${r.numero}`
}

/** A rodada "em andamento" (nunca mais de uma) — undefined quando tudo já
 *  foi enviado e nenhuma nova ainda foi montada. */
function rodadaAtiva(comanda: Comanda): Rodada | undefined {
  return comanda.rodadas?.find((r) => r.status !== "enviada")
}

/** Estado humano da comanda para a lista de Pedidos abertos — nunca expõe
 *  status técnico bruto. */
function estadoHumano(comanda: Comanda): string {
  const ativa = rodadaAtiva(comanda)
  if (!ativa) return "Aguardando cozinha"
  if (ativa.status === "falha_envio") return "Falha ao enviar"
  if (ativa.status === "enviando") return "Enviando para cozinha"
  if (ativa.itens.length > 0) return "Montando novo pedido"
  return "Em atendimento"
}

/** Prioridade de ordenação da lista de Pedidos abertos: 1) falha que precisa
 *  de ação; 2) rascunho em andamento; 3) mais antigas primeiro. */
function prioridadeOrdenacao(comanda: Comanda): number {
  const ativa = rodadaAtiva(comanda)
  if (ativa?.status === "falha_envio") return 0
  if (ativa && (ativa.status === "rascunho" || ativa.status === "enviando") && ativa.itens.length > 0) return 1
  return 2
}

/** Endpoint de itens da rodada ativa — a Rodada 1 ainda vive nos campos
 *  "raiz" da comanda (rota .../comandas/[id]); Rodada 2+ tem rota própria.
 *  Nunca um segundo motor: só decide qual rota oficial já existente chamar. */
function urlItensRodada(comandaId: string, rodada: Rodada): string {
  return rodada.numero === 1 ? `/api/salao/comandas/${comandaId}` : `/api/salao/comandas/${comandaId}/rodadas/${rodada.id}`
}
function urlEnviarRodada(comandaId: string, rodada: Rodada): string {
  return rodada.numero === 1
    ? `/api/salao/comandas/${comandaId}/enviar`
    : `/api/salao/comandas/${comandaId}/rodadas/${rodada.id}/enviar`
}

// ---------------------------------------------------------------------------
// Tokens visuais
// ---------------------------------------------------------------------------

const FONT = "'Archivo', sans-serif"
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 14, padding: 14 }
const input: React.CSSProperties = { width: "100%", height: 48, background: "var(--background)", border: "1px solid var(--surface-secondary)", borderRadius: 10, padding: "0 14px", color: "var(--foreground)", fontSize: 15, fontWeight: 600, fontFamily: FONT, outline: "none", boxSizing: "border-box" }
const textarea: React.CSSProperties = { ...input, height: 72, padding: "10px 14px", resize: "vertical" as const }
const btnPrimario: React.CSSProperties = { height: 48, borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: FONT, border: "none", background: "var(--primary)", color: "var(--background)" }
const btnSecundario: React.CSSProperties = { height: 48, borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: FONT, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }
const btnDesabilitado: React.CSSProperties = { opacity: 0.5, cursor: "not-allowed" }
const rotulo: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--foreground-muted)", margin: "0 0 6px" }

/** Estilos globais do módulo Salão — a navegação em si é decidida em JS
 *  (ver useEhDesktop/NavegacaoPrincipal), nunca duplicada no DOM por CSS: um
 *  controle "escondido" só por display:none continuaria focável por teclado,
 *  então cada render só coloca UMA navegação na árvore. */
function EstiloSalao() {
  return (
    <style>{`
      .sal-shell{min-height:100svh;background:var(--background);font-family:${FONT};display:flex;flex-direction:column}
      .sal-content{flex:1;width:100%;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;gap:14px}
      .sal-topnav{display:flex;gap:6px;border:1px solid var(--surface-secondary);border-radius:12px;padding:4px;max-width:420px}
      .sal-bottomnav{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:60;background:var(--surface);border-top:1px solid var(--surface-secondary);padding:6px 8px calc(env(safe-area-inset-bottom) + 6px)}
      .sal-bottomnav-spacer{height:64px}
      .sal-navitem{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:48px;border:none;background:none;color:var(--foreground-secondary);font-family:${FONT};font-size:11.5px;font-weight:700;border-radius:12px;cursor:pointer;position:relative}
      .sal-navitem.ativo{color:var(--brand-text);font-weight:900}
      .sal-badge{position:absolute;top:2px;right:22%;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--primary);color:var(--background);font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center}
      .sal-catalogo-grid{display:grid;gap:8px}
      @media (min-width: 768px){
        .sal-content{max-width:760px;margin:0 auto;padding:24px}
      }
      @media (min-width: 1024px){
        .sal-catalogo-shell{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start;max-width:1080px;margin:0 auto;width:100%;padding:20px 24px}
        .sal-catalogo-grid{grid-template-columns:repeat(2,1fr)}
        .sal-catalogo-resumo{position:sticky;top:20px}
      }
    `}</style>
  )
}

/** true em tablet/desktop (>=768px) — decide qual navegação renderizar
 *  (nunca as duas ao mesmo tempo). Assume mobile até o primeiro efeito
 *  rodar (seguro para SSR: o servidor não sabe a largura real da tela). */
function useEhDesktop(min = 768): boolean {
  const [ehDesktop, setEhDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`)
    const ouvir = (e: MediaQueryListEvent) => setEhDesktop(e.matches)
    queueMicrotask(() => ouvir({ matches: mq.matches } as MediaQueryListEvent))
    mq.addEventListener("change", ouvir)
    return () => mq.removeEventListener("change", ouvir)
  }, [min])
  return ehDesktop
}

function NavegacaoPrincipal({
  aba,
  setAba,
  badge,
  className,
  iconSize,
}: {
  aba: Aba
  setAba: (a: Aba) => void
  badge: number
  className: string
  iconSize: number
}) {
  return (
    <nav className={className} aria-label="Navegação principal">
      <button onClick={() => setAba("pedido")} className={`sal-navitem ${aba === "pedido" ? "ativo" : ""}`} style={{ minHeight: 44 }}>
        <ClipboardList size={iconSize} aria-hidden="true" />
        Fazer pedido
      </button>
      <button onClick={() => setAba("abertos")} className={`sal-navitem ${aba === "abertos" ? "ativo" : ""}`} style={{ minHeight: 44 }}>
        <ReceiptText size={iconSize} aria-hidden="true" />
        Pedidos abertos
        {badge > 0 && <span className="sal-badge">{badge}</span>}
      </button>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Página principal — só decide QUAL tela mostrar; cada tela é seu próprio
// componente abaixo.
// ---------------------------------------------------------------------------

type Aba = "pedido" | "abertos"

type Tela =
  | { tipo: "home" }
  | { tipo: "catalogo"; comandaId: string }
  | { tipo: "revisao"; comandaId: string }
  | { tipo: "enviado"; comandaId: string; rotulo: string; pedidoNumero?: number; total: number }
  | { tipo: "comanda"; comandaId: string }

export default function SalaoPage() {
  const router = useRouter()
  const [carregando, setCarregando] = useState(true)
  const [naoAutorizado, setNaoAutorizado] = useState(false)
  const [erroCarregar, setErroCarregar] = useState(false)
  const [menu, setMenu] = useState<MenuManual | null>(null)
  const [comandas, setComandas] = useState<Comanda[]>([])
  const [aba, setAba] = useState<Aba>("pedido")
  const [tela, setTela] = useState<Tela>({ tipo: "home" })
  const [abrindoAtendimento, setAbrindoAtendimento] = useState(false)
  const ehDesktop = useEhDesktop()

  const carregarComandas = useCallback(async (): Promise<Comanda[] | null> => {
    const r = await fetch("/api/salao/comandas", { cache: "no-store" })
    if (r.status === 401) { setNaoAutorizado(true); return null }
    const data = await r.json().catch(() => null)
    if (data?.ok) { setComandas(data.comandas); return data.comandas as Comanda[] }
    return null
  }, [])

  const carregarTudo = useCallback(async () => {
    try {
      const [rCardapio] = await Promise.all([fetch("/api/cardapio", { cache: "no-store" }), carregarComandas()])
      setErroCarregar(false)
      if (rCardapio.ok) {
        const validado = adaptarCardapioParaMontagem(await rCardapio.json())
        if (validado) setMenu(validado)
      }
    } catch {
      setErroCarregar(true)
    } finally {
      setCarregando(false)
    }
  }, [carregarComandas])

  useEffect(() => {
    (async () => { await carregarTudo() })()
  }, [carregarTudo])

  function tentarNovamenteCarregar() {
    setCarregando(true)
    carregarTudo()
  }

  useEffect(() => {
    if (naoAutorizado) router.replace("/salao/login")
  }, [naoAutorizado, router])

  async function sair() {
    await fetch("/api/salao/logout", { method: "POST" }).catch(() => {})
    router.replace("/salao/login")
  }

  function voltarParaInicio() {
    setTela({ tipo: "home" })
    carregarComandas()
  }

  const comandaAtual = (id: string) => comandas.find((c) => c.id === id) || null
  const abertasParaBadge = comandas.filter((c) => c.status !== "fechada").length

  /** "Começar novo atendimento": abre a comanda AINDA ANÔNIMA (sem
   *  cliente/mesa) e vai direto para o catálogo — nenhum formulário antes.
   *  Cliente/mesa só são pedidos na revisão, no fim do fluxo. */
  async function comecarNovoAtendimento() {
    if (abrindoAtendimento) return
    setAbrindoAtendimento(true)
    try {
      const r = await fetch("/api/salao/comandas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await r.json().catch(() => null)
      if (r.ok && data?.ok) {
        setTela({ tipo: "catalogo", comandaId: data.comanda.id })
        carregarComandas()
      }
    } finally {
      setAbrindoAtendimento(false)
    }
  }

  if (carregando) {
    return (
      <div className="sal-shell" style={{ alignItems: "center", justifyContent: "center" }}>
        <EstiloSalao />
        <p style={{ color: "var(--foreground-secondary)", fontFamily: FONT }}>Carregando…</p>
      </div>
    )
  }

  if (erroCarregar) {
    return (
      <div className="sal-shell" style={{ alignItems: "center", justifyContent: "center", padding: 20, gap: 12 }}>
        <EstiloSalao />
        <p style={{ color: "var(--foreground)", fontFamily: FONT, fontWeight: 800, textAlign: "center" }}>Não consegui carregar os dados agora.</p>
        <button onClick={tentarNovamenteCarregar} style={{ ...btnPrimario, width: 220 }}>Tentar novamente</button>
      </div>
    )
  }

  // Qualquer sub-fluxo (catálogo, revisão, enviado, detalhe da comanda)
  // ocupa a tela inteira, como já acontecia antes — só a tela "home" mostra
  // o cabeçalho com as duas abas.
  if (tela.tipo === "catalogo" && menu) {
    const comanda = comandaAtual(tela.comandaId)
    const ativa = comanda ? rodadaAtiva(comanda) : undefined
    if (!comanda || !ativa) {
      return <TelaSemDados onVoltar={voltarParaInicio} />
    }
    return (
      <ProdutoSelector
        comanda={comanda}
        rodada={ativa}
        menu={menu}
        ehDesktop={ehDesktop}
        onFechado={voltarParaInicio}
        onRevisar={() => setTela({ tipo: "revisao", comandaId: comanda.id })}
        onAtualizado={carregarComandas}
      />
    )
  }

  if (tela.tipo === "revisao") {
    const comanda = comandaAtual(tela.comandaId)
    const ativa = comanda ? rodadaAtiva(comanda) : undefined
    if (!comanda || !ativa) {
      return <TelaSemDados onVoltar={voltarParaInicio} />
    }
    return (
      <PedidoReview
        comanda={comanda}
        rodada={ativa}
        onAdicionarMaisItens={() => setTela({ tipo: "catalogo", comandaId: comanda.id })}
        onEnviado={(pedidoNumero, total) => {
          setTela({ tipo: "enviado", comandaId: comanda.id, rotulo: rotuloRodada(ativa), pedidoNumero, total })
          carregarComandas()
        }}
      />
    )
  }

  if (tela.tipo === "enviado") {
    const comanda = comandaAtual(tela.comandaId)
    return (
      <PedidoEnviadoScreen
        comanda={comanda}
        rotulo={tela.rotulo}
        pedidoNumero={tela.pedidoNumero}
        total={tela.total}
        onVerPedidosAbertos={() => { setAba("abertos"); voltarParaInicio() }}
        onAdicionarMaisItens={async () => {
          const atualizada = await garantirRodadaEmAndamento(tela.comandaId)
          if (atualizada) { setTela({ tipo: "catalogo", comandaId: tela.comandaId }); carregarComandas() }
        }}
      />
    )
  }

  if (tela.tipo === "comanda") {
    const comanda = comandaAtual(tela.comandaId)
    if (!comanda) return <TelaSemDados onVoltar={voltarParaInicio} />
    return (
      <ComandaDetail
        comanda={comanda}
        onVoltar={voltarParaInicio}
        onAtualizado={carregarComandas}
        onAdicionarItens={async () => {
          const ok = await garantirRodadaEmAndamento(comanda.id)
          if (ok) setTela({ tipo: "catalogo", comandaId: comanda.id })
        }}
        onContinuarPedido={() => setTela({ tipo: "catalogo", comandaId: comanda.id })}
        onRevisarETentarNovamente={() => setTela({ tipo: "revisao", comandaId: comanda.id })}
      />
    )
  }

  // tela === "home"
  return (
    <div className="sal-shell">
      <EstiloSalao />
      <div className="sal-content" style={{ paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: "var(--foreground)" }}>ChefeBot <span style={{ color: "var(--foreground-muted)", fontWeight: 700 }}>· Terminal do salão</span></span>
          <button onClick={sair} style={{ background: "none", border: "none", color: "var(--foreground-muted)", fontSize: 13, fontWeight: 800, cursor: "pointer", minHeight: 44 }}>Sair</button>
        </div>

        {ehDesktop && <NavegacaoPrincipal aba={aba} setAba={setAba} badge={abertasParaBadge} className="sal-topnav" iconSize={18} />}

        {aba === "pedido" && menu && (
          <HomeFazerPedido
            comandas={comandas}
            abrindo={abrindoAtendimento}
            onComecarNovoAtendimento={comecarNovoAtendimento}
            onContinuarPedido={(comandaId) => setTela({ tipo: "catalogo", comandaId })}
          />
        )}
        {aba === "abertos" && (
          <PedidosAbertosList comandas={comandas} onAbrirComanda={(id) => setTela({ tipo: "comanda", comandaId: id })} />
        )}
      </div>

      {!ehDesktop && (
        <>
          <div className="sal-bottomnav-spacer" />
          <NavegacaoPrincipal aba={aba} setAba={setAba} badge={abertasParaBadge} className="sal-bottomnav" iconSize={20} />
        </>
      )}
    </div>
  )

  /** Cria (ou recupera, se já existir) a rodada em rascunho da comanda —
   *  usado por "Adicionar mais itens"/"Adicionar itens", nunca expõe ao
   *  garçom o conceito de "criar rodada". */
  async function garantirRodadaEmAndamento(comandaId: string): Promise<boolean> {
    const lista = await carregarComandas()
    const comanda = lista?.find((c) => c.id === comandaId)
    if (comanda && rodadaAtiva(comanda)) return true
    try {
      const r = await fetch(`/api/salao/comandas/${comandaId}/rodadas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: gerarClientRequestId() }),
      })
      const data = await r.json().catch(() => null)
      return !!(r.ok && data?.ok)
    } catch {
      return false
    }
  }
}

function TelaSemDados({ onVoltar }: { onVoltar: () => void }) {
  return (
    <div className="sal-shell" style={{ alignItems: "center", justifyContent: "center", padding: 20, gap: 12 }}>
      <EstiloSalao />
      <p style={{ color: "var(--foreground)", fontFamily: FONT, fontWeight: 800, textAlign: "center" }}>Não encontrei esse pedido agora.</p>
      <button onClick={onVoltar} style={{ ...btnPrimario, width: 220 }}>Voltar para Pedidos abertos</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fluxo 1 — Fazer pedido (estado inicial)
// ---------------------------------------------------------------------------

function HomeFazerPedido({
  comandas,
  abrindo,
  onComecarNovoAtendimento,
  onContinuarPedido,
}: {
  comandas: Comanda[]
  abrindo: boolean
  onComecarNovoAtendimento: () => void
  onContinuarPedido: (comandaId: string) => void
}) {
  // "Rascunho em andamento" aqui é só o atendimento que AINDA NÃO virou
  // pedido nenhum (Pedido inicial em rascunho) — comandas que já enviaram ao
  // menos um pedido e têm um complemento em andamento aparecem em Pedidos
  // abertos (Fluxo 6/7), não duplicadas aqui.
  const emAndamento = comandas.filter((c) => c.status === "aberta")

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {emAndamento.length === 1 && (
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <p style={rotulo}>Você tem um pedido em andamento</p>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--foreground)" }}>
            {identificacaoCliente(emAndamento[0])} · {identificacaoMesa(emAndamento[0])}
          </p>
          <button onClick={() => onContinuarPedido(emAndamento[0].id)} style={btnPrimario}>Continuar pedido</button>
        </div>
      )}

      {emAndamento.length > 1 && (
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <p style={rotulo}>Você tem pedidos em andamento</p>
          {emAndamento.map((c) => (
            <button
              key={c.id}
              onClick={() => onContinuarPedido(c.id)}
              style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", minHeight: 48 }}
            >
              <span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{identificacaoCliente(c)} · {identificacaoMesa(c)}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>Continuar ›</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ ...card, display: "grid", gap: 10, textAlign: "center", padding: 24 }}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "var(--foreground)" }}>Novo atendimento</p>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--foreground-secondary)" }}>Escolha os produtos e envie o pedido para a cozinha.</p>
        <button onClick={onComecarNovoAtendimento} disabled={abrindo} style={{ ...btnPrimario, ...(abrindo ? btnDesabilitado : {}) }}>
          {abrindo ? "Abrindo…" : "Começar novo atendimento"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fluxo 2 — Escolher produtos (abre direto ao clicar em "Começar novo
// atendimento"/"Continuar pedido"/"Adicionar itens" — reaproveita o
// montador oficial)
// ---------------------------------------------------------------------------

function ContextoAtendimento({ comanda }: { comanda: Comanda }) {
  const identificado = !!comanda.cliente
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--surface)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 15, fontWeight: 900, color: "var(--foreground)", display: "flex", alignItems: "center", gap: 6 }}>
        <Users size={16} aria-hidden="true" /> {identificado ? identificacaoCliente(comanda) : "Novo atendimento"}
      </span>
      {identificado && (
        <span style={{ fontSize: 12.5, color: "var(--foreground-secondary)" }}>
          {identificacaoMesa(comanda)} · Comanda #{comanda.numero}
        </span>
      )}
    </div>
  )
}

/** Modal de confirmação ao fechar o catálogo com itens já adicionados —
 *  nunca perde o que já foi montado por engano (voltar/fechar/erro de
 *  rede). */
function ConfirmarSairModal({
  onContinuarMontando,
  onSalvarESair,
  onDescartar,
}: {
  onContinuarMontando: () => void
  onSalvarESair: () => void
  onDescartar: () => void
}) {
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)

  if (confirmandoDescarte) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Descartar pedido" style={{ position: "fixed", inset: 0, zIndex: 3100, background: "color-mix(in srgb, black 55%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ ...card, width: "100%", maxWidth: 380, display: "grid", gap: 12, background: "var(--background)" }}>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "var(--foreground)" }}>Descartar este pedido?</p>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--foreground-secondary)" }}>Os produtos adicionados serão perdidos. Esta ação não pode ser desfeita.</p>
          <button onClick={onDescartar} style={{ ...btnPrimario, background: "var(--danger)" }}>Descartar pedido</button>
          <button onClick={() => setConfirmandoDescarte(false)} style={btnSecundario}>Voltar</button>
        </div>
      </div>
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Sair deste pedido?" style={{ position: "fixed", inset: 0, zIndex: 3100, background: "color-mix(in srgb, black 55%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ ...card, width: "100%", maxWidth: 380, display: "grid", gap: 12, background: "var(--background)" }}>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "var(--foreground)" }}>Sair deste pedido?</p>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--foreground-secondary)" }}>Os produtos adicionados continuarão salvos.</p>
        <button onClick={onContinuarMontando} style={btnPrimario}>Continuar montando</button>
        <button onClick={onSalvarESair} style={btnSecundario}>Salvar e sair</button>
        <button onClick={() => setConfirmandoDescarte(true)} style={{ ...btnSecundario, color: "var(--danger)" }}>Descartar pedido</button>
      </div>
    </div>
  )
}

function ProdutoSelector({
  comanda,
  rodada,
  menu,
  ehDesktop,
  onFechado,
  onRevisar,
  onAtualizado,
}: {
  comanda: Comanda
  rodada: Rodada
  menu: MenuManual
  ehDesktop: boolean
  onFechado: () => void
  onRevisar: () => void
  onAtualizado: () => void
}) {
  const produtos = useMemo(() => listarProdutosManuais(menu), [menu])
  const [categoria, setCategoria] = useState<CategoriaManual>("pizza")
  const [termo, setTermo] = useState("")
  const buscando = termo.trim().length > 0
  const resultados = useMemo(() => buscarProdutos(produtos, termo, buscando ? "todas" : categoria), [produtos, termo, buscando, categoria])

  const [itens, setItens] = useState<ItemApp[]>(rodada.itens)
  const [confirmacao, setConfirmacao] = useState<string | null>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [mostrarConfirmarSair, setMostrarConfirmarSair] = useState(false)
  const [fechando, setFechando] = useState(false)

  const salvar = useCallback(async (novosItens: ItemApp[]) => {
    setErroSalvar(null)
    try {
      const r = await fetch(urlItensRodada(comanda.id, rodada), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: novosItens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty })) }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroSalvar(data?.error || "Não foi possível salvar agora.")
        return
      }
      onAtualizado()
    } catch {
      setErroSalvar("Não foi possível salvar agora. Verifique a conexão.")
    }
  }, [comanda.id, rodada, onAtualizado])

  const [produtoAberto, setProdutoAberto] = useState<ProdutoManual | null>(null)
  const [selecao, setSelecao] = useState<SelecaoMontagem>(selecaoVazia())
  const [etapaVisivel, setEtapaVisivel] = useState(0)
  const etapas = useMemo(() => (produtoAberto ? montarEtapas(produtoAberto, menu) : []), [produtoAberto, menu])
  const etapaAtual = etapas[etapaVisivel]
  const bloqueio = motivoBloqueio(etapaAtual, selecao)
  const completa = montagemCompleta(etapas, selecao)

  function confirmarAdicao(item: ItemApp) {
    const novos = [...itens, item]
    setItens(novos)
    salvar(novos)
    setConfirmacao(`${item.name} adicionado`)
    window.setTimeout(() => setConfirmacao(null), 1600)
  }

  function abrirProduto(produto: ProdutoManual) {
    if (produto.esgotado) return
    if (!produto.requerMontagem) {
      const item = construirItemManual(produto, selecaoVazia(), menu)
      if (item) confirmarAdicao(item)
      return
    }
    setProdutoAberto(produto)
    setSelecao(selecaoVazia())
    setEtapaVisivel(0)
    setCategoria(produto.categoria)
  }

  function confirmarMontagem() {
    if (!produtoAberto || !completa) return
    const item = construirItemManual(produtoAberto, selecao, menu)
    if (item) confirmarAdicao(item)
    setProdutoAberto(null)
    setTermo("")
  }

  function avancarEtapa() {
    if (!etapaAtual || !etapaSatisfeita(etapaAtual, selecao)) return
    if (etapaVisivel < etapas.length - 1) setEtapaVisivel(etapaVisivel + 1)
  }
  function voltarEtapa() {
    if (etapaVisivel > 0) setEtapaVisivel(etapaVisivel - 1)
    else setProdutoAberto(null)
  }
  function escolher(valor: string) {
    if (!etapaAtual) return
    if (etapaAtual.tipo === "sabores" || etapaAtual.tipo === "sabor_unico") {
      setSelecao((s) => alternarSabor(s, valor, etapaAtual.maxEscolhas))
    } else if (etapaAtual.tipo === "borda") {
      setSelecao((s) => ({ ...s, borda: valor === "" ? null : valor }))
    } else if (etapaAtual.tipo === "tamanho_item") {
      setSelecao((s) => ({ ...s, tamanhoItem: valor }))
    } else if (etapaAtual.tipo === "leite") {
      setSelecao((s) => ({ ...s, leite: valor === "com" ? "com" : "sem" }))
    }
  }
  function estaEscolhida(valor: string): boolean {
    if (!etapaAtual) return false
    switch (etapaAtual.tipo) {
      case "sabores": case "sabor_unico": return selecao.sabores.includes(valor)
      case "borda": return valor === "" ? selecao.borda === null : selecao.borda === valor
      case "tamanho_item": return selecao.tamanhoItem === valor
      case "leite": return selecao.leite === valor
      default: return false
    }
  }

  const total = itens.reduce((s, i) => s + i.price * i.qty, 0)

  function pedirFechar() {
    if (itens.length === 0) {
      descartarSemItens()
      return
    }
    setMostrarConfirmarSair(true)
  }

  async function descartarSemItens() {
    if (fechando) return
    setFechando(true)
    try {
      await fetch(`/api/salao/comandas/${comanda.id}/descartar`, { method: "POST" }).catch(() => {})
    } finally {
      setFechando(false)
      onFechado()
    }
  }

  async function descartarComItens() {
    if (fechando) return
    setFechando(true)
    try {
      await fetch(`/api/salao/comandas/${comanda.id}/descartar`, { method: "POST" }).catch(() => {})
    } finally {
      setFechando(false)
      setMostrarConfirmarSair(false)
      onFechado()
    }
  }

  return (
    <div className="sal-shell">
      <EstiloSalao />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 0" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: "var(--foreground)" }}>Adicionar produtos</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)" }}>Novo atendimento</span>
        </div>
        <button onClick={pedirFechar} aria-label="Fechar" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--foreground-secondary)", cursor: "pointer" }}>
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <ContextoAtendimento comanda={comanda} />

      <div className="sal-catalogo-shell" style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: 16, color: "var(--foreground-muted)" }} />
            <input style={{ ...input, paddingLeft: 36 }} placeholder="Buscar produto…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar produto" />
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {CATEGORIAS.map((c) => (
              <button key={c.id} onClick={() => setCategoria(c.id)} style={{ height: 40, padding: "0 14px", flexShrink: 0, borderRadius: 12, fontFamily: FONT, cursor: "pointer", border: "1px solid " + (categoria === c.id && !buscando ? "var(--primary)" : "var(--surface-secondary)"), background: categoria === c.id && !buscando ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", color: "var(--foreground)", fontSize: 13 }}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="sal-catalogo-grid">
            {resultados.map((p) => (
              <button key={p.id} onClick={() => abrirProduto(p)} disabled={p.esgotado} style={{ ...card, minHeight: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: p.esgotado ? "not-allowed" : "pointer", opacity: p.esgotado ? 0.5 : 1 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{p.nome}{p.esgotado ? " · esgotado" : ""}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: "var(--brand-text)" }}>{p.precoBase === null ? "" : money(p.precoBase)}</span>
              </button>
            ))}
            {resultados.length === 0 && <p style={{ fontSize: 13, color: "var(--foreground-muted)", textAlign: "center" }}>Nenhum produto encontrado.</p>}
          </div>
          <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "var(--success)", minHeight: 16 }}>{confirmacao || ""}</p>
          {erroSalvar && <p role="alert" style={{ fontSize: 12.5, color: "var(--danger)", margin: 0 }}>{erroSalvar}</p>}
        </div>

        {ehDesktop && (
          <div className="sal-catalogo-resumo" style={{ ...card, display: "grid", gap: 10 }}>
            <p style={rotulo}>Resumo do pedido</p>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 900 }}>
              <span style={{ color: "var(--foreground-secondary)" }}>{itens.length} item(ns)</span>
              <span>{money(total)}</span>
            </div>
            <button onClick={onRevisar} disabled={itens.length === 0} style={{ ...btnPrimario, ...(itens.length === 0 ? btnDesabilitado : {}) }}>
              {itens.length === 0 ? "Adicione pelo menos um produto" : "Revisar pedido"}
            </button>
          </div>
        )}
      </div>

      {!ehDesktop && (
        <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 900 }}>
            <span style={{ color: "var(--foreground-secondary)" }}>{itens.length} item(ns)</span>
            <span>{money(total)}</span>
          </div>
          <button onClick={onRevisar} disabled={itens.length === 0} style={{ ...btnPrimario, ...(itens.length === 0 ? btnDesabilitado : {}) }}>
            {itens.length === 0 ? "Adicione pelo menos um produto" : "Revisar pedido"}
          </button>
        </div>
      )}

      {produtoAberto && etapaAtual && (
        <div role="dialog" aria-modal="true" aria-label={`Montar ${produtoAberto.nome}`} style={{ position: "fixed", inset: 0, zIndex: 2900, background: "var(--background)", display: "flex", flexDirection: "column", fontFamily: FONT }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--surface)", flexShrink: 0 }}>
            <p style={{ ...rotulo, margin: 0 }}>{produtoAberto.nome} · passo {etapaVisivel + 1} de {etapas.length}</p>
            <p style={{ fontSize: 18, fontWeight: 900, color: "var(--foreground)", margin: "4px 0 2px" }}>{etapaAtual.titulo}</p>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--foreground-secondary)", margin: 0 }}>{etapaAtual.ajuda}</p>
          </div>
          <div style={{ padding: "8px 16px", display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {etapas.map((e, i) => {
              const resumo = resumoEtapa(e, selecao)
              if (!resumo) return null
              return (
                <button key={e.tipo} onClick={() => setEtapaVisivel(i)} style={{ height: 32, padding: "0 10px", fontSize: 11.5, borderRadius: 10, fontFamily: FONT, cursor: "pointer", border: "1px solid var(--surface-secondary)", background: "var(--surface)", color: "var(--foreground-secondary)" }}>
                  {e.titulo}: {resumo} ✎
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 16px", display: "grid", gap: 8, alignContent: "start" }}>
            {etapaAtual.opcoes.map((o) => {
              const sel = estaEscolhida(o.valor)
              return (
                <button key={o.valor || "__sem__"} onClick={() => !o.esgotado && escolher(o.valor)} disabled={o.esgotado} style={{ ...card, minHeight: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: o.esgotado ? "not-allowed" : "pointer", opacity: o.esgotado ? 0.45 : 1, borderColor: sel ? "var(--primary)" : "var(--surface-secondary)", background: sel ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "var(--surface)" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{o.label}{o.esgotado ? " · esgotado" : ""}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {o.extra ? <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--brand-text)" }}>+{money(o.extra)}</span> : null}
                    {sel ? <span style={{ fontSize: 14, color: "var(--primary)" }}>✓</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>
            {bloqueio && <p role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: 0, textAlign: "center" }}>{bloqueio}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={voltarEtapa} style={{ ...btnSecundario, flex: 1 }}>
                {etapaVisivel > 0 ? "Voltar" : "Cancelar item"}
              </button>
              {indiceEtapaPendente(etapas, selecao) === -1 ? (
                <button onClick={confirmarMontagem} style={{ ...btnPrimario, flex: 2 }}>Adicionar</button>
              ) : (
                <button onClick={avancarEtapa} disabled={!!bloqueio} style={{ ...btnPrimario, flex: 2, ...(bloqueio ? btnDesabilitado : {}) }}>
                  {etapaVisivel < etapas.length - 1 ? `Continuar para ${etapas[etapaVisivel + 1].titulo.toLowerCase()}` : "Continuar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {mostrarConfirmarSair && (
        <ConfirmarSairModal
          onContinuarMontando={() => setMostrarConfirmarSair(false)}
          onSalvarESair={() => { setMostrarConfirmarSair(false); onFechado() }}
          onDescartar={descartarComItens}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fluxo 3 — Revisar pedido (itens → observação → identificação → total →
// enviar). A identificação (cliente/mesa/WhatsApp) só é pedida aqui, no fim
// do fluxo — nunca antes do catálogo.
// ---------------------------------------------------------------------------

function PedidoReview({
  comanda,
  rodada,
  onAdicionarMaisItens,
  onEnviado,
}: {
  comanda: Comanda
  rodada: Rodada
  onAdicionarMaisItens: () => void
  onEnviado: (pedidoNumero: number | undefined, total: number) => void
}) {
  const [itens, setItens] = useState<ItemApp[]>(rodada.itens)
  const [observacao, setObservacao] = useState(rodada.observacao || "")
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const [cliente, setCliente] = useState(comanda.cliente || "")
  const [mesa, setMesa] = useState(comanda.mesa || "")
  const [semMesa, setSemMesa] = useState(false)
  const [whatsapp, setWhatsapp] = useState(comanda.whatsapp || "")
  const [erroIdentificacao, setErroIdentificacao] = useState<string | null>(null)
  const clienteRef = useRef<HTMLInputElement>(null)

  const [enviando, setEnviando] = useState(false)
  const [erroEnviar, setErroEnviar] = useState<string | null>(rodada.erroUltimaTentativa || null)
  const enviandoRef = useRef(false)
  const clientRequestIdRef = useRef<string | null>(null)

  const primeiraVez = rodada.numero === 1

  useEffect(() => {
    if (primeiraVez && !cliente) clienteRef.current?.focus()
  }, [primeiraVez, cliente])

  const salvar = useCallback(async (novosItens: ItemApp[], novaObservacao?: string) => {
    setErroSalvar(null)
    try {
      const r = await fetch(urlItensRodada(comanda.id, rodada), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: novosItens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty })),
          observacao: novaObservacao ?? observacao,
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroSalvar(data?.error || "Não foi possível salvar agora.")
      }
    } catch {
      setErroSalvar("Não foi possível salvar agora. Verifique a conexão.")
    }
  }, [comanda.id, rodada, observacao])

  function mudarQuantidade(i: number, delta: number) {
    const novos = itens.map((item, idx) => (idx === i ? { ...item, qty: item.qty + delta } : item)).filter((item) => item.qty > 0)
    setItens(novos)
    salvar(novos)
  }
  function removerItem(i: number) {
    const novos = itens.filter((_, idx) => idx !== i)
    setItens(novos)
    salvar(novos)
  }
  function salvarObservacao() {
    salvar(itens, observacao)
  }

  async function salvarIdentificacao(): Promise<boolean> {
    if (!primeiraVez) return true
    setErroIdentificacao(null)
    try {
      const r = await fetch(`/api/salao/comandas/${comanda.id}/identificacao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente, mesa, semMesa, whatsapp }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroIdentificacao(data?.error || "Não foi possível salvar a identificação agora.")
        return false
      }
      return true
    } catch {
      setErroIdentificacao("Não foi possível salvar a identificação agora. Verifique a conexão.")
      return false
    }
  }

  async function enviarParaCozinha() {
    if (enviandoRef.current || itens.length === 0) return
    if (primeiraVez && !cliente.trim()) {
      setErroIdentificacao("Informe o nome do cliente")
      clienteRef.current?.focus()
      return
    }
    enviandoRef.current = true
    setEnviando(true)
    setErroEnviar(null)
    try {
      if (primeiraVez) {
        const ok = await salvarIdentificacao()
        if (!ok) return
      }
      if (!clientRequestIdRef.current) clientRequestIdRef.current = gerarClientRequestId()
      const r = await fetch(urlEnviarRodada(comanda.id, rodada), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: clientRequestIdRef.current }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroEnviar(data?.error || "Não foi possível enviar agora.")
        return
      }
      onEnviado(data.pedidoNumero, itens.reduce((s, i) => s + i.price * i.qty, 0))
    } catch {
      setErroEnviar("Não foi possível enviar agora. Verifique a conexão.")
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  const total = itens.reduce((s, i) => s + i.price * i.qty, 0)
  const podeEnviar = itens.length > 0 && !enviando && (!primeiraVez || cliente.trim().length > 0)

  return (
    <div className="sal-shell">
      <EstiloSalao />
      <div style={{ padding: "14px 16px 0" }}>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "var(--foreground)" }}>Revisar pedido</p>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--foreground-secondary)" }}>
          {rotuloRodada(rodada)}{comanda.cliente ? ` · ${identificacaoCliente(comanda)}` : ""}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <p style={rotulo}>Itens do pedido</p>
          <div style={{ ...card, display: "grid", gap: 8 }}>
            {itens.map((item, i) => (
              <div key={`${item.name}-${item.detail}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "var(--foreground)" }}>{item.name}</span>
                  {item.detail && <span style={{ display: "block", fontSize: 11.5, color: "var(--foreground-secondary)" }}>{item.detail}</span>}
                  <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--brand-text)" }}>{money(item.price * item.qty)}</span>
                </span>
                <button onClick={() => mudarQuantidade(i, -1)} aria-label={`Diminuir ${item.name}`} style={{ height: 36, width: 36, borderRadius: 10, cursor: "pointer", border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>−</button>
                <span style={{ fontSize: 14, fontWeight: 900, minWidth: 20, textAlign: "center" }}>{item.qty}</span>
                <button onClick={() => mudarQuantidade(i, 1)} aria-label={`Aumentar ${item.name}`} style={{ height: 36, width: 36, borderRadius: 10, cursor: "pointer", border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>+</button>
                <button onClick={() => removerItem(i)} aria-label={`Remover ${item.name}`} style={{ height: 36, width: 36, borderRadius: 10, cursor: "pointer", border: "none", background: "transparent", color: "var(--danger)" }}>×</button>
              </div>
            ))}
          </div>
          {erroSalvar && <p role="alert" style={{ fontSize: 12.5, color: "var(--danger)", margin: 0 }}>{erroSalvar}</p>}
          <button onClick={onAdicionarMaisItens} style={{ ...btnSecundario, marginTop: 4 }}>Adicionar mais produtos</button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor="sal-observacao" style={rotulo}>Observação para a cozinha</label>
          <textarea
            id="sal-observacao"
            style={textarea}
            placeholder="Ex.: sem cebola, bem passado…"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            onBlur={salvarObservacao}
          />
        </div>

        {primeiraVez && (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={rotulo}>Identifique a comanda</p>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="sal-cliente" style={rotulo}>Nome do cliente</label>
              <input
                id="sal-cliente"
                ref={clienteRef}
                style={input}
                placeholder="Ex.: João"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                onBlur={salvarIdentificacao}
                aria-required="true"
                aria-invalid={!!erroIdentificacao}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="sal-mesa" style={rotulo}>Mesa (opcional)</label>
              <input
                id="sal-mesa"
                style={{ ...input, opacity: semMesa ? 0.5 : 1 }}
                placeholder="Ex.: 4"
                value={mesa}
                onChange={(e) => setMesa(e.target.value)}
                onBlur={salvarIdentificacao}
                disabled={semMesa}
              />
              <button
                onClick={() => { setSemMesa((v) => !v); window.setTimeout(salvarIdentificacao, 0) }}
                aria-pressed={semMesa}
                style={{ ...btnSecundario, height: 40, width: "fit-content", padding: "0 14px", border: "1px solid " + (semMesa ? "var(--primary)" : "var(--surface-secondary)"), background: semMesa ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }}
              >
                Sem mesa
              </button>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="sal-whatsapp" style={rotulo}>WhatsApp do cliente (opcional)</label>
              <input
                id="sal-whatsapp"
                style={input}
                placeholder="(11) 90000-0000"
                inputMode="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                onBlur={salvarIdentificacao}
              />
              <p style={{ margin: 0, fontSize: 12, color: "var(--foreground-muted)" }}>O link de acompanhamento é enviado depois que o pedido chega à cozinha.</p>
            </div>

            {erroIdentificacao && <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erroIdentificacao}</p>}
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900 }}>
          <span style={{ color: "var(--foreground-secondary)" }}>Total</span>
          <span>{money(total)}</span>
        </div>
        {erroEnviar && (
          <p role="alert" aria-live="assertive" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erroEnviar}</p>
        )}
        <button
          onClick={enviarParaCozinha}
          disabled={!podeEnviar}
          style={{ ...btnPrimario, ...(!podeEnviar ? btnDesabilitado : {}) }}
        >
          {enviando ? "Enviando para a cozinha…" : erroEnviar ? "Tentar novamente" : "Enviar para a cozinha"}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fluxo 4 — Pedido enviado
// ---------------------------------------------------------------------------

function PedidoEnviadoScreen({
  comanda,
  rotulo: rotuloEnviado,
  pedidoNumero,
  total,
  onVerPedidosAbertos,
  onAdicionarMaisItens,
}: {
  comanda: Comanda | null
  rotulo: string
  pedidoNumero: number | undefined
  total: number
  onVerPedidosAbertos: () => void
  onAdicionarMaisItens: () => void
}) {
  const [processando, setProcessando] = useState(false)
  async function adicionarMaisItens() {
    if (processando) return
    setProcessando(true)
    try {
      await onAdicionarMaisItens()
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div className="sal-shell" style={{ alignItems: "center", justifyContent: "center", padding: 20 }}>
      <EstiloSalao />
      <div style={{ ...card, width: "100%", maxWidth: 400, display: "grid", gap: 12, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <CheckCircle2 size={44} color="var(--success)" aria-hidden="true" />
        </div>
        <p style={{ margin: 0, fontSize: 19, fontWeight: 900, color: "var(--foreground)" }}>Pedido enviado para a cozinha</p>
        {comanda && (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--foreground-secondary)" }}>
            {identificacaoCliente(comanda)} · {identificacaoMesa(comanda)} · {rotuloEnviado}
          </p>
        )}
        {pedidoNumero !== undefined && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--foreground-muted)" }}>Pedido #{pedidoNumero}</p>
        )}
        <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "var(--foreground)" }}>{money(total)}</p>
        <button onClick={adicionarMaisItens} disabled={processando} style={{ ...btnPrimario, ...(processando ? btnDesabilitado : {}) }}>
          {processando ? "Abrindo…" : "Adicionar mais itens"}
        </button>
        <button onClick={onVerPedidosAbertos} style={btnSecundario}>Ver pedidos abertos</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fluxo 5 — Pedidos abertos
// ---------------------------------------------------------------------------

function PedidosAbertosList({ comandas, onAbrirComanda }: { comandas: Comanda[]; onAbrirComanda: (id: string) => void }) {
  const abertas = useMemo(
    () => comandas.filter((c) => c.status !== "fechada").slice().sort((a, b) => {
      const dif = prioridadeOrdenacao(a) - prioridadeOrdenacao(b)
      if (dif !== 0) return dif
      return new Date(a.abertaEm).getTime() - new Date(b.abertaEm).getTime()
    }),
    [comandas]
  )

  if (abertas.length === 0) {
    return <p style={{ fontSize: 13.5, color: "var(--foreground-muted)", textAlign: "center", marginTop: 24 }}>Nenhum pedido aberto no momento.</p>
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {abertas.map((c) => <ComandaCard key={c.id} comanda={c} onAbrir={() => onAbrirComanda(c.id)} />)}
    </div>
  )
}

function ComandaCard({ comanda, onAbrir }: { comanda: Comanda; onAbrir: () => void }) {
  const estado = estadoHumano(comanda)
  const envios = comanda.rodadas?.filter((r) => r.status === "enviada").length ?? 0
  const corEstado = estado === "Falha ao enviar" ? "var(--danger)" : estado === "Aguardando cozinha" ? "var(--success)" : "var(--attention-text)"
  return (
    <button onClick={onAbrir} style={{ ...card, minHeight: 48, display: "grid", gap: 6, textAlign: "left", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: "var(--foreground)" }}>{identificacaoCliente(comanda)}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: corEstado, textTransform: "uppercase", letterSpacing: ".3px", textAlign: "right" }}>{estado}</span>
      </div>
      <span style={{ fontSize: 12.5, color: "var(--foreground-secondary)" }}>
        {identificacaoMesa(comanda)} · Comanda #{comanda.numero} · {tempoDecorrido(comanda.abertaEm)}
      </span>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
        <span style={{ color: "var(--foreground-secondary)" }}>{envios} envio(s)</span>
        <span style={{ color: "var(--brand-text)" }}>{money(comanda.totalParcial ?? 0)}</span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Fluxo 6 — Visão da comanda
// ---------------------------------------------------------------------------

function ComandaDetail({
  comanda,
  onVoltar,
  onAtualizado,
  onAdicionarItens,
  onContinuarPedido,
  onRevisarETentarNovamente,
}: {
  comanda: Comanda
  onVoltar: () => void
  onAtualizado: () => void
  onAdicionarItens: () => void | Promise<void>
  onContinuarPedido: () => void
  onRevisarETentarNovamente: () => void
}) {
  const rodadas = comanda.rodadas || []
  const [expandidas, setExpandidas] = useState<Set<string>>(() => {
    const ultima = rodadas[rodadas.length - 1]
    return new Set(ultima ? [ultima.id] : [])
  })
  const [processandoAcao, setProcessandoAcao] = useState(false)
  const [fechando, setFechando] = useState(false)

  function alternarExpandido(id: string) {
    setExpandidas((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  const ativa = rodadaAtiva(comanda)

  async function acaoPrincipal() {
    if (processandoAcao) return
    setProcessandoAcao(true)
    try {
      if (!ativa) { await onAdicionarItens(); return }
      if (ativa.status === "falha_envio") { onRevisarETentarNovamente(); return }
      if (ativa.status === "rascunho") { onContinuarPedido(); return }
    } finally {
      setProcessandoAcao(false)
    }
  }

  async function fecharMesa() {
    if (fechando) return
    setFechando(true)
    try {
      const r = await fetch(`/api/salao/comandas/${comanda.id}/fechar`, { method: "POST" })
      if (r.ok) { onAtualizado(); onVoltar() }
    } finally {
      setFechando(false)
    }
  }

  const rotuloAcao = !ativa
    ? "Adicionar itens"
    : ativa.status === "enviando"
      ? "Enviando para cozinha…"
      : ativa.status === "falha_envio"
        ? "Revisar e tentar novamente"
        : "Continuar pedido"
  const acaoDesabilitada = processandoAcao || ativa?.status === "enviando"

  return (
    <div className="sal-shell">
      <EstiloSalao />
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--surface)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onVoltar} style={{ background: "none", border: "none", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, cursor: "pointer", minHeight: 44 }}>‹ Pedidos abertos</button>
      </div>

      <div style={{ padding: "12px 16px 0" }}>
        <p style={{ margin: 0, fontSize: 19, fontWeight: 900, color: "var(--foreground)" }}>{identificacaoCliente(comanda)}</p>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--foreground-secondary)" }}>
          {identificacaoMesa(comanda)} · Comanda #{comanda.numero} · {tempoDecorrido(comanda.abertaEm)}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {rodadas.map((r) => {
          const aberta2 = expandidas.has(r.id)
          const humano = r.status === "enviada" ? "Enviado" : r.status === "enviando" ? "Enviando…" : r.status === "falha_envio" ? "Falha ao enviar" : "Em rascunho"
          const horario = r.enviadaEm ? new Date(r.enviadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null
          return (
            <div key={r.id} style={{ ...card, display: "grid", gap: 8 }}>
              <button onClick={() => alternarExpandido(r.id)} aria-expanded={aberta2} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", minHeight: 44 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: "var(--foreground)" }}>{rotuloRodada(r)}{horario ? ` · ${horario}` : ""}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: r.status === "falha_envio" ? "var(--danger)" : r.status === "enviada" ? "var(--success)" : "var(--attention-text)", textTransform: "uppercase" }}>{humano}</span>
                  {aberta2 ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                </span>
              </button>
              {aberta2 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {r.itens.map((item, i) => (
                    <div key={`${item.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--foreground)" }}>{item.qty}× {item.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)" }}>{money(item.price * item.qty)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 900, borderTop: "1px solid var(--surface)", paddingTop: 6 }}>
                    <span style={{ color: "var(--foreground-secondary)" }}>Subtotal</span>
                    <span>{money(r.subtotal)}</span>
                  </div>
                  {r.pedidoId && (
                    <a href={`/pedidos/${r.pedidoId}/imprimir`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 800, color: "var(--brand-text)", display: "flex", alignItems: "center", gap: 4, minHeight: 32 }}>
                      <Printer size={14} aria-hidden="true" /> Imprimir
                    </a>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 900 }}>
          <span style={{ color: "var(--foreground-secondary)" }}>Total acumulado</span>
          <span>{money(comanda.totalParcial ?? 0)}</span>
        </div>
        <button onClick={acaoPrincipal} disabled={acaoDesabilitada} style={{ ...btnPrimario, ...(acaoDesabilitada ? btnDesabilitado : {}) }}>
          {rotuloAcao}
        </button>
        {comanda.status === "enviada" && (
          <button onClick={fecharMesa} disabled={fechando} style={{ ...btnSecundario, ...(fechando ? btnDesabilitado : {}) }}>
            {fechando ? "Fechando…" : "Fechar mesa"}
          </button>
        )}
      </div>
    </div>
  )
}
