"use client"

// Interface do Módulo Salão — comandas de mesa, completamente separada do
// painel administrativo (/pedidos). Reaproveita EXCLUSIVAMENTE o catálogo,
// o motor de preço e o motor de pedido já oficiais (src/lib/montagemManual.ts
// e POST /api/pedido-app, chamado internamente por
// /api/salao/comandas/[id]/enviar) — nenhuma lógica de catálogo/preço/
// pedido paralela vive aqui.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { ItemApp } from "@/lib/pedidoAppItens"
import { gerarClientRequestId } from "@/survival/clientRequestId"
import { extrairPagamentoComposto, montarPagamentoComposto } from "@/lib/pagamentoComposto"
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
  mesa: string
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

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",")

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 14, padding: 14 }
const input: React.CSSProperties = { width: "100%", height: 44, background: "var(--background)", border: "1px solid var(--surface-secondary)", borderRadius: 10, padding: "0 12px", color: "var(--foreground)", fontSize: 14, fontWeight: 600, fontFamily: "'Archivo', sans-serif", outline: "none", boxSizing: "border-box" }
const btn: React.CSSProperties = { height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "'Archivo', sans-serif" }
const rotulo: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--foreground-muted)", margin: "0 0 6px" }

export default function SalaoPage() {
  const router = useRouter()
  const [carregando, setCarregando] = useState(true)
  const [naoAutorizado, setNaoAutorizado] = useState(false)
  const [menu, setMenu] = useState<MenuManual | null>(null)
  const [comandas, setComandas] = useState<Comanda[]>([])
  const [erro, setErro] = useState<string | null>(null)

  const carregarComandas = useCallback(async () => {
    const r = await fetch("/api/salao/comandas", { cache: "no-store" })
    if (r.status === 401) { setNaoAutorizado(true); return }
    const data = await r.json().catch(() => null)
    if (data?.ok) setComandas(data.comandas)
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const [rCardapio] = await Promise.all([fetch("/api/cardapio", { cache: "no-store" }), carregarComandas()])
        if (rCardapio.ok) {
          const validado = adaptarCardapioParaMontagem(await rCardapio.json())
          if (validado) setMenu(validado)
        }
      } catch {
        setErro("Não consegui carregar os dados agora.")
      } finally {
        setCarregando(false)
      }
    })()
  }, [carregarComandas])

  useEffect(() => {
    if (naoAutorizado) router.replace("/salao/login")
  }, [naoAutorizado, router])

  async function sair() {
    await fetch("/api/salao/logout", { method: "POST" }).catch(() => {})
    router.replace("/salao/login")
  }

  const [modalNovaMesa, setModalNovaMesa] = useState(false)
  const [novaMesa, setNovaMesa] = useState("")
  const [novoComplemento, setNovoComplemento] = useState("")
  const [abrindo, setAbrindo] = useState(false)

  async function abrirMesa() {
    if (!novaMesa.trim() || abrindo) return
    setAbrindo(true)
    try {
      const r = await fetch("/api/salao/comandas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mesa: novaMesa.trim(), complemento: novoComplemento.trim() || undefined }),
      })
      if (r.ok) {
        setModalNovaMesa(false)
        setNovaMesa("")
        setNovoComplemento("")
        await carregarComandas()
      }
    } finally {
      setAbrindo(false)
    }
  }

  const [comandaAtivaId, setComandaAtivaId] = useState<string | null>(null)
  const comandaAtiva = comandas.find((c) => c.id === comandaAtivaId) || null

  const abertas = comandas.filter((c) => c.status === "aberta")
  const enviadas = comandas.filter((c) => c.status === "enviada")

  if (carregando) {
    return (
      <div style={{ minHeight: "100svh", background: "var(--background)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--foreground-secondary)", fontFamily: "'Archivo', sans-serif" }}>Carregando…</p>
      </div>
    )
  }

  if (comandaAtiva && menu) {
    if (comandaAtiva.status === "aberta") {
      return (
        <ComandaBuilder
          comanda={comandaAtiva}
          menu={menu}
          onVoltar={() => { setComandaAtivaId(null); carregarComandas() }}
          onAtualizado={carregarComandas}
        />
      )
    }
    if (comandaAtiva.status === "enviada") {
      return (
        <RodadasView
          comanda={comandaAtiva}
          menu={menu}
          onVoltar={() => { setComandaAtivaId(null); carregarComandas() }}
          onAtualizado={carregarComandas}
        />
      )
    }
  }

  return (
    <div style={{ minHeight: "100svh", background: "var(--background)", fontFamily: "'Archivo', sans-serif", padding: 16, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 18, fontWeight: 900, color: "var(--foreground)" }}>🍽️ Salão</span>
        <button onClick={sair} style={{ background: "none", border: "none", color: "var(--foreground-muted)", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Sair</button>
      </div>

      {erro && <p role="alert" style={{ fontSize: 13, color: "var(--danger)" }}>{erro}</p>}

      <button onClick={() => setModalNovaMesa(true)} style={{ ...btn, border: "none", background: "var(--primary)", color: "var(--background)" }}>
        + Abrir mesa
      </button>

      {abertas.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={rotulo}>Mesas abertas</p>
          {abertas.map((c) => (
            <button key={c.id} onClick={() => setComandaAtivaId(c.id)} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}>
              <span>
                <span style={{ display: "block", fontSize: 15, fontWeight: 900, color: "var(--foreground)" }}>Mesa {c.mesa}{c.complemento ? ` (${c.complemento})` : ""}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--foreground-secondary)" }}>{c.itens.length} item(ns) · Comanda #{c.numero}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>Abrir ›</span>
            </button>
          ))}
        </div>
      )}

      {enviadas.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={rotulo}>Aguardando fechamento</p>
          {enviadas.map((c) => (
            <ComandaEnviadaCard key={c.id} comanda={c} onAbrir={() => setComandaAtivaId(c.id)} onFechada={carregarComandas} />
          ))}
        </div>
      )}

      {abertas.length === 0 && enviadas.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--foreground-muted)", textAlign: "center", marginTop: 24 }}>Nenhuma mesa aberta no momento.</p>
      )}

      {modalNovaMesa && (
        <div role="dialog" aria-modal="true" aria-label="Abrir mesa" style={{ position: "fixed", inset: 0, zIndex: 2800, background: "rgba(var(--overlay-rgb), 0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ ...card, width: "100%", maxWidth: 340, display: "grid", gap: 10 }}>
            <p style={{ fontSize: 16, fontWeight: 900, margin: 0, color: "var(--foreground)" }}>Abrir mesa</p>
            <input style={input} placeholder="Número da mesa" value={novaMesa} onChange={(e) => setNovaMesa(e.target.value)} autoFocus />
            <input style={input} placeholder="Complemento (opcional)" value={novoComplemento} onChange={(e) => setNovoComplemento(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setModalNovaMesa(false)} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>Cancelar</button>
              <button onClick={abrirMesa} disabled={!novaMesa.trim() || abrindo} style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: !novaMesa.trim() || abrindo ? 0.5 : 1 }}>
                {abrindo ? "Abrindo…" : "Abrir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ComandaEnviadaCard({ comanda, onAbrir, onFechada }: { comanda: Comanda; onAbrir: () => void; onFechada: () => void }) {
  const [fechando, setFechando] = useState(false)
  async function fechar() {
    if (fechando) return
    setFechando(true)
    try {
      const r = await fetch(`/api/salao/comandas/${comanda.id}/fechar`, { method: "POST" })
      if (r.ok) onFechada()
    } finally {
      setFechando(false)
    }
  }
  const numeroRodadas = comanda.rodadas?.length ?? 1
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <button onClick={onAbrir} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: "var(--foreground)" }}>Mesa {comanda.mesa}{comanda.complemento ? ` (${comanda.complemento})` : ""}</span>
        <span style={{ fontSize: 12, color: "var(--foreground-secondary)" }}>
          Pedido #{comanda.pedidoNumero ?? "—"}{numeroRodadas > 1 ? ` · ${numeroRodadas} rodadas` : ""}
        </span>
      </button>
      <div style={{ display: "flex", gap: 8 }}>
        {comanda.pedidoId && (
          <a href={`/pedidos/${comanda.pedidoId}/imprimir`} target="_blank" rel="noreferrer" style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)", textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            Imprimir
          </a>
        )}
        <button onClick={fechar} disabled={fechando} style={{ ...btn, flex: 1, border: "none", background: "var(--primary)", color: "var(--background)", opacity: fechando ? 0.5 : 1 }}>
          {fechando ? "Fechando…" : "Fechar mesa"}
        </button>
      </div>
    </div>
  )
}

function ComandaBuilder({ comanda, menu, onVoltar, onAtualizado }: { comanda: Comanda; menu: MenuManual; onVoltar: () => void; onAtualizado: () => void }) {
  const produtos = useMemo(() => listarProdutosManuais(menu), [menu])
  const [categoria, setCategoria] = useState<CategoriaManual>("pizza")
  const [termo, setTermo] = useState("")
  const buscando = termo.trim().length > 0
  const resultados = useMemo(() => buscarProdutos(produtos, termo, buscando ? "todas" : categoria), [produtos, termo, buscando, categoria])

  const [itens, setItens] = useState<ItemApp[]>(comanda.itens)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const salvar = useCallback(async (novosItens: ItemApp[]) => {
    setSalvando(true)
    setErroSalvar(null)
    try {
      const r = await fetch(`/api/salao/comandas/${comanda.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: novosItens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty })) }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroSalvar(data?.error || "Não foi possível salvar agora.")
        return
      }
      setItens(data.comanda.itens)
    } catch {
      setErroSalvar("Não foi possível salvar agora. Verifique a conexão.")
    } finally {
      setSalvando(false)
    }
  }, [comanda.id])

  const [produtoAberto, setProdutoAberto] = useState<ProdutoManual | null>(null)
  const [selecao, setSelecao] = useState<SelecaoMontagem>(selecaoVazia())
  const [etapaVisivel, setEtapaVisivel] = useState(0)
  const etapas = useMemo(() => (produtoAberto ? montarEtapas(produtoAberto, menu) : []), [produtoAberto, menu])
  const etapaAtual = etapas[etapaVisivel]
  const bloqueio = motivoBloqueio(etapaAtual, selecao)
  const completa = montagemCompleta(etapas, selecao)

  function abrirProduto(produto: ProdutoManual) {
    if (produto.esgotado) return
    if (!produto.requerMontagem) {
      const item = construirItemManual(produto, selecaoVazia(), menu)
      if (item) {
        const novos = [...itens, item]
        setItens(novos)
        salvar(novos)
      }
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
    if (item) {
      const novos = [...itens, item]
      setItens(novos)
      salvar(novos)
    }
    setProdutoAberto(null)
    setTermo("")
  }

  function mudarQuantidade(i: number, delta: number) {
    const novos = itens
      .map((item, idx) => (idx === i ? { ...item, qty: item.qty + delta } : item))
      .filter((item) => item.qty > 0)
    setItens(novos)
    salvar(novos)
  }
  function removerItem(i: number) {
    const novos = itens.filter((_, idx) => idx !== i)
    setItens(novos)
    salvar(novos)
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
  const [modalEnviar, setModalEnviar] = useState(false)

  return (
    <div style={{ minHeight: "100svh", background: "var(--background)", fontFamily: "'Archivo', sans-serif", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--surface)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onVoltar} style={{ background: "none", border: "none", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>‹ Mesas</button>
        <span style={{ fontSize: 15, fontWeight: 900, color: "var(--foreground)" }}>Mesa {comanda.mesa}{comanda.complemento ? ` (${comanda.complemento})` : ""}</span>
        <span style={{ width: 60 }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <input style={input} placeholder="Buscar produto…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar produto" />
        {!buscando && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {CATEGORIAS.map((c) => (
              <button key={c.id} onClick={() => setCategoria(c.id)} style={{ ...btn, height: 34, padding: "0 12px", flexShrink: 0, border: "1px solid " + (categoria === c.id ? "var(--primary)" : "var(--surface-secondary)"), background: categoria === c.id ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", color: "var(--foreground)", fontSize: 12.5 }}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          {resultados.map((p) => (
            <button key={p.id} onClick={() => abrirProduto(p)} disabled={p.esgotado} style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: p.esgotado ? "not-allowed" : "pointer", opacity: p.esgotado ? 0.5 : 1 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{p.nome}</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: "var(--brand-text)" }}>{p.precoBase === null ? "" : money(p.precoBase)}</span>
            </button>
          ))}
        </div>

        {itens.length > 0 && (
          <div style={{ ...card, display: "grid", gap: 8 }}>
            <p style={rotulo}>Comanda ({itens.length})</p>
            {itens.map((item, i) => (
              <div key={`${item.name}-${item.detail}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "var(--foreground)" }}>{item.name}</span>
                  {item.detail && <span style={{ display: "block", fontSize: 11.5, color: "var(--foreground-secondary)" }}>{item.detail}</span>}
                </span>
                <button onClick={() => mudarQuantidade(i, -1)} aria-label={`Diminuir ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>−</button>
                <span style={{ fontSize: 13, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{item.qty}</span>
                <button onClick={() => mudarQuantidade(i, 1)} aria-label={`Aumentar ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>+</button>
                <button onClick={() => removerItem(i)} aria-label={`Remover ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "none", background: "transparent", color: "var(--danger)" }}>×</button>
              </div>
            ))}
          </div>
        )}
        {erroSalvar && <p role="alert" style={{ fontSize: 12.5, color: "var(--danger)" }}>{erroSalvar}</p>}
      </div>

      <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 900 }}>
          <span style={{ color: "var(--foreground-secondary)" }}>Total</span>
          <span>{money(total)}</span>
        </div>
        <button onClick={() => setModalEnviar(true)} disabled={itens.length === 0 || salvando} style={{ ...btn, border: "none", background: "var(--primary)", color: "var(--background)", opacity: itens.length === 0 || salvando ? 0.5 : 1 }}>
          Enviar pedido
        </button>
      </div>

      {produtoAberto && etapaAtual && (
        <div role="dialog" aria-modal="true" aria-label={`Montar ${produtoAberto.nome}`} style={{ position: "fixed", inset: 0, zIndex: 2900, background: "var(--background)", display: "flex", flexDirection: "column", fontFamily: "'Archivo', sans-serif" }}>
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
                <button key={e.tipo} onClick={() => setEtapaVisivel(i)} style={{ ...btn, height: 28, padding: "0 10px", fontSize: 11.5, border: "1px solid var(--surface-secondary)", background: "var(--surface)", color: "var(--foreground-secondary)" }}>
                  {e.titulo}: {resumo} ✎
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 16px", display: "grid", gap: 8, alignContent: "start" }}>
            {etapaAtual.opcoes.map((o) => {
              const sel = estaEscolhida(o.valor)
              return (
                <button key={o.valor || "__sem__"} onClick={() => !o.esgotado && escolher(o.valor)} disabled={o.esgotado} style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: o.esgotado ? "not-allowed" : "pointer", opacity: o.esgotado ? 0.45 : 1, borderColor: sel ? "var(--primary)" : "var(--surface-secondary)", background: sel ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "var(--surface)" }}>
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
              <button onClick={voltarEtapa} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>
                {etapaVisivel > 0 ? "Voltar" : "Cancelar item"}
              </button>
              {indiceEtapaPendente(etapas, selecao) === -1 ? (
                <button onClick={confirmarMontagem} style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)" }}>Adicionar</button>
              ) : (
                <button onClick={avancarEtapa} disabled={!!bloqueio} style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: bloqueio ? 0.5 : 1 }}>
                  {etapaVisivel < etapas.length - 1 ? `Continuar para ${etapas[etapaVisivel + 1].titulo.toLowerCase()}` : "Continuar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modalEnviar && (
        <EnviarPedidoModal
          comandaId={comanda.id}
          total={total}
          onFechar={() => setModalEnviar(false)}
          onEnviado={() => { setModalEnviar(false); onAtualizado(); onVoltar() }}
        />
      )}
    </div>
  )
}

// Rodada 1 já foi enviada (virou o pedido real) — esta tela acompanha as
// rodadas e permite montar e enviar as próximas (Rodada 2+): cada rodada
// enviada vira um pedido oficial independente, contendo só os itens daquela
// rodada (ver POST .../rodadas/[rodadaId]/enviar e src/lib/comandas.ts).
function RodadasView({ comanda, menu, onVoltar, onAtualizado }: { comanda: Comanda; menu: MenuManual; onVoltar: () => void; onAtualizado: () => void }) {
  const rodadas: Rodada[] = comanda.rodadas && comanda.rodadas.length > 0
    ? comanda.rodadas
    : [{
        id: `rodada_${comanda.id}_1`,
        numero: 1,
        status: "enviada",
        itens: comanda.itens,
        subtotal: comanda.itens.reduce((s, i) => s + i.price * i.qty, 0),
        criadaEm: comanda.abertaEm,
        atualizadaEm: comanda.abertaEm,
        pedidoId: comanda.pedidoId,
        pedidoNumero: comanda.pedidoNumero,
      }]

  // Enquanto uma rodada não estiver "enviada", ela é a rodada "em
  // andamento" (rascunho, enviando ou aguardando retry) — nunca duas ao
  // mesmo tempo, então só pode existir uma.
  const rodadaRascunho = rodadas.find((r) => r.status !== "enviada") || null
  const totalParcial = comanda.totalParcial ?? rodadas.reduce((s, r) => s + r.subtotal, 0)

  const [criando, setCriando] = useState(false)
  const [erroCriar, setErroCriar] = useState<string | null>(null)
  const criandoRef = useRef(false)
  const clientRequestIdRef = useRef<string | null>(null)

  async function adicionarNovaRodada() {
    if (criandoRef.current) return
    criandoRef.current = true
    setCriando(true)
    setErroCriar(null)
    try {
      if (!clientRequestIdRef.current) clientRequestIdRef.current = gerarClientRequestId()
      const r = await fetch(`/api/salao/comandas/${comanda.id}/rodadas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: clientRequestIdRef.current }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroCriar(data?.error || "Não foi possível criar a rodada agora.")
        return
      }
      clientRequestIdRef.current = null
      onAtualizado()
    } catch {
      setErroCriar("Não foi possível criar a rodada agora. Verifique a conexão.")
    } finally {
      criandoRef.current = false
      setCriando(false)
    }
  }

  return (
    <div style={{ minHeight: "100svh", background: "var(--background)", fontFamily: "'Archivo', sans-serif", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--surface)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onVoltar} style={{ background: "none", border: "none", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>‹ Mesas</button>
        <span style={{ fontSize: 15, fontWeight: 900, color: "var(--foreground)" }}>Mesa {comanda.mesa}{comanda.complemento ? ` (${comanda.complemento})` : ""}</span>
        <span style={{ width: 60 }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {rodadas.map((r) => (
          r.status !== "enviada"
            ? <RodadaRascunhoCard key={r.id} comandaId={comanda.id} rodada={r} menu={menu} onAtualizado={onAtualizado} />
            : <RodadaEnviadaCard key={r.id} rodada={r} />
        ))}

        {!rodadaRascunho && (
          <div style={{ display: "grid", gap: 6 }}>
            <button onClick={adicionarNovaRodada} disabled={criando} style={{ ...btn, border: "1px dashed var(--surface-secondary)", background: "transparent", color: "var(--foreground)", opacity: criando ? 0.6 : 1 }}>
              {criando ? "Criando…" : "+ Adicionar nova rodada"}
            </button>
            {erroCriar && <p role="alert" style={{ fontSize: 12.5, color: "var(--danger)", margin: 0 }}>{erroCriar}</p>}
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 900 }}>
          <span style={{ color: "var(--foreground-secondary)" }}>Total parcial</span>
          <span>{money(totalParcial)}</span>
        </div>
      </div>
    </div>
  )
}

function RodadaEnviadaCard({ rodada }: { rodada: Rodada }) {
  const horario = rodada.enviadaEm ? new Date(rodada.enviadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: "var(--foreground)" }}>Rodada {rodada.numero}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--success)", textTransform: "uppercase", letterSpacing: ".4px" }}>
          Enviada{horario ? ` · ${horario}` : ""}
        </span>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {rodada.itens.map((item, i) => (
          <div key={`${item.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--foreground)" }}>{item.qty}× {item.name}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)" }}>{money(item.price * item.qty)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 900, borderTop: "1px solid var(--surface)", paddingTop: 6 }}>
        <span style={{ color: "var(--foreground-secondary)" }}>Subtotal</span>
        <span>{money(rodada.subtotal)}</span>
      </div>
    </div>
  )
}

function RodadaRascunhoCard({ comandaId, rodada, menu, onAtualizado }: { comandaId: string; rodada: Rodada; menu: MenuManual; onAtualizado: () => void }) {
  const produtos = useMemo(() => listarProdutosManuais(menu), [menu])
  const [categoria, setCategoria] = useState<CategoriaManual>("pizza")
  const [termo, setTermo] = useState("")
  const buscando = termo.trim().length > 0
  const resultados = useMemo(() => buscarProdutos(produtos, termo, buscando ? "todas" : categoria), [produtos, termo, buscando, categoria])

  const [itens, setItens] = useState<ItemApp[]>(rodada.itens)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const editavel = rodada.status === "rascunho"

  const [enviando, setEnviando] = useState(false)
  const [erroEnviar, setErroEnviar] = useState<string | null>(rodada.erroUltimaTentativa || null)
  const enviandoRef = useRef(false)
  const clientRequestIdRodadaRef = useRef<string | null>(null)

  async function enviarParaCozinha() {
    if (enviandoRef.current || itens.length === 0) return
    enviandoRef.current = true
    setEnviando(true)
    setErroEnviar(null)
    try {
      if (!clientRequestIdRodadaRef.current) clientRequestIdRodadaRef.current = gerarClientRequestId()
      const r = await fetch(`/api/salao/comandas/${comandaId}/rodadas/${rodada.id}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: clientRequestIdRodadaRef.current }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroEnviar(data?.error || "Não foi possível enviar agora.")
        return
      }
      clientRequestIdRodadaRef.current = null
      onAtualizado()
    } catch {
      setErroEnviar("Não foi possível enviar agora. Verifique a conexão.")
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  const salvar = useCallback(async (novosItens: ItemApp[]) => {
    setSalvando(true)
    setErroSalvar(null)
    try {
      const r = await fetch(`/api/salao/comandas/${comandaId}/rodadas/${rodada.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: novosItens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty })) }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErroSalvar(data?.error || "Não foi possível salvar agora.")
        return
      }
      setItens(data.rodada.itens)
      onAtualizado()
    } catch {
      setErroSalvar("Não foi possível salvar agora. Verifique a conexão.")
    } finally {
      setSalvando(false)
    }
  }, [comandaId, rodada.id, onAtualizado])

  const [produtoAberto, setProdutoAberto] = useState<ProdutoManual | null>(null)
  const [selecao, setSelecao] = useState<SelecaoMontagem>(selecaoVazia())
  const [etapaVisivel, setEtapaVisivel] = useState(0)
  const etapas = useMemo(() => (produtoAberto ? montarEtapas(produtoAberto, menu) : []), [produtoAberto, menu])
  const etapaAtual = etapas[etapaVisivel]
  const bloqueio = motivoBloqueio(etapaAtual, selecao)
  const completa = montagemCompleta(etapas, selecao)

  function abrirProduto(produto: ProdutoManual) {
    if (!editavel || produto.esgotado) return
    if (!produto.requerMontagem) {
      const item = construirItemManual(produto, selecaoVazia(), menu)
      if (item) {
        const novos = [...itens, item]
        setItens(novos)
        salvar(novos)
      }
      return
    }
    setProdutoAberto(produto)
    setSelecao(selecaoVazia())
    setEtapaVisivel(0)
    setCategoria(produto.categoria)
  }

  function confirmarMontagem() {
    if (!editavel || !produtoAberto || !completa) return
    const item = construirItemManual(produtoAberto, selecao, menu)
    if (item) {
      const novos = [...itens, item]
      setItens(novos)
      salvar(novos)
    }
    setProdutoAberto(null)
    setTermo("")
  }

  function mudarQuantidade(i: number, delta: number) {
    if (!editavel) return
    const novos = itens
      .map((item, idx) => (idx === i ? { ...item, qty: item.qty + delta } : item))
      .filter((item) => item.qty > 0)
    setItens(novos)
    salvar(novos)
  }
  function removerItem(i: number) {
    if (!editavel) return
    const novos = itens.filter((_, idx) => idx !== i)
    setItens(novos)
    salvar(novos)
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
  function avancarEtapa() {
    if (!etapaAtual || !etapaSatisfeita(etapaAtual, selecao)) return
    if (etapaVisivel < etapas.length - 1) setEtapaVisivel(etapaVisivel + 1)
  }
  function voltarEtapa() {
    if (etapaVisivel > 0) setEtapaVisivel(etapaVisivel - 1)
    else setProdutoAberto(null)
  }

  const subtotal = itens.reduce((s, i) => s + i.price * i.qty, 0)

  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: "var(--foreground)" }}>Rodada {rodada.numero}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: rodada.status === "falha_envio" ? "var(--danger)" : "var(--attention-text)", textTransform: "uppercase", letterSpacing: ".4px" }}>
          {rodada.status === "enviando" ? "Enviando…" : rodada.status === "falha_envio" ? "Falha no envio · tentar novamente" : "Rascunho · rodada em andamento"}
        </span>
      </div>

      {editavel && (
        <>
          <input style={input} placeholder="Buscar produto…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar produto" />
          {!buscando && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {CATEGORIAS.map((c) => (
                <button key={c.id} onClick={() => setCategoria(c.id)} style={{ ...btn, height: 34, padding: "0 12px", flexShrink: 0, border: "1px solid " + (categoria === c.id ? "var(--primary)" : "var(--surface-secondary)"), background: categoria === c.id ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", color: "var(--foreground)", fontSize: 12.5 }}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gap: 8, maxHeight: 260, overflowY: "auto" }}>
            {resultados.map((p) => (
              <button key={p.id} onClick={() => abrirProduto(p)} disabled={p.esgotado} style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: p.esgotado ? "not-allowed" : "pointer", opacity: p.esgotado ? 0.5 : 1 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{p.nome}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: "var(--brand-text)" }}>{p.precoBase === null ? "" : money(p.precoBase)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {itens.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={rotulo}>Itens da rodada ({itens.length})</p>
          {itens.map((item, i) => (
            <div key={`${item.name}-${item.detail}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "var(--foreground)" }}>{item.name}</span>
                {item.detail && <span style={{ display: "block", fontSize: 11.5, color: "var(--foreground-secondary)" }}>{item.detail}</span>}
              </span>
              {editavel && (
                <>
                  <button onClick={() => mudarQuantidade(i, -1)} aria-label={`Diminuir ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>−</button>
                  <span style={{ fontSize: 13, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{item.qty}</span>
                  <button onClick={() => mudarQuantidade(i, 1)} aria-label={`Aumentar ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>+</button>
                  <button onClick={() => removerItem(i)} aria-label={`Remover ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "none", background: "transparent", color: "var(--danger)" }}>×</button>
                </>
              )}
              {!editavel && <span style={{ fontSize: 13, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{item.qty}×</span>}
            </div>
          ))}
        </div>
      )}
      {erroSalvar && <p role="alert" style={{ fontSize: 12.5, color: "var(--danger)", margin: 0 }}>{erroSalvar}</p>}
      {salvando && <p role="status" style={{ fontSize: 11.5, color: "var(--foreground-muted)", margin: 0 }}>Salvando…</p>}

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 900, borderTop: "1px solid var(--surface)", paddingTop: 6 }}>
        <span style={{ color: "var(--foreground-secondary)" }}>Subtotal da rodada</span>
        <span>{money(subtotal)}</span>
      </div>

      {erroEnviar && <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erroEnviar}</p>}
      <button
        onClick={enviarParaCozinha}
        disabled={itens.length === 0 || enviando || rodada.status === "enviando"}
        style={{ ...btn, border: "none", background: "var(--primary)", color: "var(--background)", opacity: itens.length === 0 || enviando || rodada.status === "enviando" ? 0.5 : 1 }}
      >
        {enviando || rodada.status === "enviando" ? "Enviando…" : erroEnviar ? "Tentar novamente" : "Enviar para cozinha"}
      </button>

      {produtoAberto && etapaAtual && (
        <div role="dialog" aria-modal="true" aria-label={`Montar ${produtoAberto.nome}`} style={{ position: "fixed", inset: 0, zIndex: 2900, background: "var(--background)", display: "flex", flexDirection: "column", fontFamily: "'Archivo', sans-serif" }}>
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
                <button key={e.tipo} onClick={() => setEtapaVisivel(i)} style={{ ...btn, height: 28, padding: "0 10px", fontSize: 11.5, border: "1px solid var(--surface-secondary)", background: "var(--surface)", color: "var(--foreground-secondary)" }}>
                  {e.titulo}: {resumo} ✎
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 16px", display: "grid", gap: 8, alignContent: "start" }}>
            {etapaAtual.opcoes.map((o) => {
              const sel = estaEscolhida(o.valor)
              return (
                <button key={o.valor || "__sem__"} onClick={() => !o.esgotado && escolher(o.valor)} disabled={o.esgotado} style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: o.esgotado ? "not-allowed" : "pointer", opacity: o.esgotado ? 0.45 : 1, borderColor: sel ? "var(--primary)" : "var(--surface-secondary)", background: sel ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "var(--surface)" }}>
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
              <button onClick={voltarEtapa} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>
                {etapaVisivel > 0 ? "Voltar" : "Cancelar item"}
              </button>
              {indiceEtapaPendente(etapas, selecao) === -1 ? (
                <button onClick={confirmarMontagem} style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)" }}>Adicionar</button>
              ) : (
                <button onClick={avancarEtapa} disabled={!!bloqueio} style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: bloqueio ? 0.5 : 1 }}>
                  {etapaVisivel < etapas.length - 1 ? `Continuar para ${etapas[etapaVisivel + 1].titulo.toLowerCase()}` : "Continuar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EnviarPedidoModal({ comandaId, total, onFechar, onEnviado }: { comandaId: string; total: number; onFechar: () => void; onEnviado: () => void }) {
  const [pagamento, setPagamento] = useState("")
  const [mistoPix, setMistoPix] = useState("")
  const [mistoDinheiro, setMistoDinheiro] = useState("")
  const [trocoOpcao, setTrocoOpcao] = useState<"sim" | "nao" | null>(null)
  const [troco, setTroco] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const compostoAtual = pagamento === "Misto" ? montarPagamentoComposto(mistoPix, mistoDinheiro, total) : null
  const pagamentoFinal = pagamento === "Misto" ? (compostoAtual?.ok ? compostoAtual.valor : "") : pagamento
  const temDinheiro = /dinheiro/i.test(pagamentoFinal)
  const trocoFinal = temDinheiro ? (trocoOpcao === "nao" ? "Sem troco" : troco.trim()) : undefined
  const podeEnviar = !!pagamentoFinal.trim() && (!temDinheiro || !!trocoFinal)

  async function enviar() {
    if (!podeEnviar || enviando) return
    setEnviando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/salao/comandas/${comandaId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagamento: pagamentoFinal, ...(trocoFinal ? { troco: trocoFinal } : {}) }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErro(data?.error || "Não foi possível enviar agora.")
        setEnviando(false)
        return
      }
      onEnviado()
    } catch {
      setErro("Não foi possível enviar agora. Verifique a conexão.")
      setEnviando(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Enviar pedido" style={{ position: "fixed", inset: 0, zIndex: 3100, background: "rgba(var(--overlay-rgb), 0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ ...card, width: "100%", maxWidth: 380, display: "grid", gap: 10 }}>
        <p style={{ fontSize: 16, fontWeight: 900, margin: 0, color: "var(--foreground)" }}>Enviar pedido — {money(total)}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {["Pix", "Dinheiro", "Cartao", "Misto"].map((p) => {
            const ativo = pagamento === p || (p === "Misto" && !!extrairPagamentoComposto(pagamento))
            return (
              <button key={p} onClick={() => setPagamento(p)} style={{ ...btn, height: 40, padding: "0 14px", border: "1px solid " + (ativo ? "var(--primary)" : "var(--surface-secondary)"), background: ativo ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", color: "var(--foreground)", fontSize: 13 }}>
                {p === "Cartao" ? "Cartão" : p === "Misto" ? "Pagamento misto" : p}
              </button>
            )
          })}
        </div>
        {pagamento === "Misto" && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={input} placeholder="Valor no Pix" value={mistoPix} onChange={(e) => setMistoPix(e.target.value)} inputMode="decimal" />
              <input style={input} placeholder="Valor em dinheiro" value={mistoDinheiro} onChange={(e) => setMistoDinheiro(e.target.value)} inputMode="decimal" />
            </div>
            {compostoAtual && !compostoAtual.ok && <p role="status" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: 0 }}>{compostoAtual.erro}</p>}
          </div>
        )}
        {temDinheiro && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setTrocoOpcao("nao")} style={{ ...btn, flex: 1, height: 40, fontSize: 13, border: "1px solid " + (trocoOpcao === "nao" ? "var(--primary)" : "var(--surface-secondary)"), background: "transparent", color: "var(--foreground)" }}>Sem troco</button>
              <button onClick={() => setTrocoOpcao("sim")} style={{ ...btn, flex: 1, height: 40, fontSize: 13, border: "1px solid " + (trocoOpcao === "sim" ? "var(--primary)" : "var(--surface-secondary)"), background: "transparent", color: "var(--foreground)" }}>Precisa de troco</button>
            </div>
            {trocoOpcao === "sim" && <input style={input} placeholder="Troco para quanto?" value={troco} onChange={(e) => setTroco(e.target.value)} inputMode="decimal" />}
          </div>
        )}
        {erro && <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erro}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onFechar} disabled={enviando} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>Cancelar</button>
          <button onClick={enviar} disabled={!podeEnviar || enviando} style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: !podeEnviar || enviando ? 0.5 : 1 }}>
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  )
}
