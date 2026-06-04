"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"

type Status = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado"

type Pedido = {
  id: string
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: Status
  horario: string
  endereco: string
  escalonado?: boolean
}

const STATUS_LABEL: Record<Status, string> = {
  novo: "Novo",
  em_preparo: "Em preparo",
  saiu_entrega: "Entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
}

const STATUS_COR: Record<Status, string> = {
  novo: "bg-yellow-100 text-yellow-800",
  em_preparo: "bg-orange-100 text-orange-800",
  saiu_entrega: "bg-blue-100 text-blue-800",
  entregue: "bg-green-100 text-green-800",
  cancelado: "bg-red-100 text-red-800",
}

const PROXIMO_STATUS: Record<Status, Status | null> = {
  novo: "em_preparo",
  em_preparo: "saiu_entrega",
  saiu_entrega: "entregue",
  entregue: null,
  cancelado: null,
}

function tocarSom() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.7, ctx.currentTime)
    master.connect(ctx.destination)
    const toques = [0, 0.7, 1.4]
    toques.forEach((startTime) => {
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(master)
      osc1.type = "sine"
      osc2.type = "sine"
      osc1.frequency.setValueAtTime(900, ctx.currentTime + startTime)
      osc2.frequency.setValueAtTime(1800, ctx.currentTime + startTime)
      gain.gain.setValueAtTime(0, ctx.currentTime + startTime)
      gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + startTime + 0.02)
      gain.gain.setValueAtTime(0.6, ctx.currentTime + startTime + 0.1)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + 0.55)
      osc1.start(ctx.currentTime + startTime)
      osc1.stop(ctx.currentTime + startTime + 0.6)
      osc2.start(ctx.currentTime + startTime)
      osc2.stop(ctx.currentTime + startTime + 0.6)
    })
  } catch {}
}

function enviarNotificacaoNavegador(pedido: Pedido) {
  if (!("Notification" in window)) return
  if (Notification.permission === "granted") {
    const titulo = pedido.escalonado
      ? "Atendimento solicitado - ChefBot"
      : "Novo pedido - ChefBot"
    const corpo = pedido.escalonado
      ? `${pedido.cliente} precisa de atendimento humano!`
      : `${pedido.cliente} | ${pedido.itens[0]} | R$ ${pedido.total.toFixed(2)} | ${pedido.endereco}`
    new Notification(titulo, { body: corpo, icon: "/favicon.ico" })
  }
}

export default function PedidosPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<Status | "todos">("todos")
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState("")
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState("")
  const [erro, setErro] = useState("")
  const [atualizando, setAtualizando] = useState<string | null>(null)
  const [notificacao, setNotificacao] = useState("")
  const [botAtivo, setBotAtivo] = useState(true)
  const [salvandoBot, setSalvandoBot] = useState(false)
  const [manuais, setManuais] = useState<Record<string, boolean>>({})
  const [permissaoNotif, setPermissaoNotif] = useState<NotificationPermission | "unsupported">("default")
  const prevIdsRef = useRef<string[]>([])

  useEffect(() => {
    const cookie = document.cookie.split(";").find(c => c.trim().startsWith("auth-user="))
    if (cookie) {
      try {
        const raw = cookie.split("=").slice(1).join("=")
        const user = JSON.parse(decodeURIComponent(decodeURIComponent(raw)))
        setUserName(user.name || "")
      } catch {}
    }
    if (!("Notification" in window)) {
      setPermissaoNotif("unsupported")
    } else {
      setPermissaoNotif(Notification.permission)
      if (Notification.permission === "default") {
        Notification.requestPermission().then(p => setPermissaoNotif(p))
      }
    }
    carregarPedidos()
    carregarStatusBot()
    const intervalo = setInterval(carregarPedidos, 10000)
    return () => clearInterval(intervalo)
  }, [router])

  const pedirPermissaoNotificacao = () => {
    if (!("Notification" in window)) return
    Notification.requestPermission().then(p => {
      setPermissaoNotif(p)
      if (p === "granted") {
        setNotificacao("Notificacoes ativadas!")
        setTimeout(() => setNotificacao(""), 3000)
      }
    })
  }

  const carregarStatusBot = async () => {
    try {
      const res = await fetch("/api/bot-status")
      if (res.ok) {
        const data = await res.json()
        setBotAtivo(data.ativo)
      }
    } catch {}
  }

  const alternarBot = async () => {
    setSalvandoBot(true)
    try {
      const novoStatus = !botAtivo
      const res = await fetch("/api/bot-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: novoStatus }),
      })
      if (res.ok) {
        setBotAtivo(novoStatus)
        setNotificacao(novoStatus ? "Bot ativado!" : "Bot pausado!")
        setTimeout(() => setNotificacao(""), 3000)
      }
    } catch {}
    setSalvandoBot(false)
  }

  const assumirConversa = async (phone: string) => {
    try {
      await fetch("/api/bot-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, ativo: false }),
      })
      setManuais(prev => ({ ...prev, [phone]: true }))
      setNotificacao("Conversa assumida - abrindo WhatsApp...")
      setTimeout(() => setNotificacao(""), 3000)
      window.open("https://wa.me/" + phone, "_blank")
    } catch {}
  }

  const devolverAoBot = async (phone: string) => {
    try {
      await fetch("/api/bot-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, ativo: true }),
      })
      setManuais(prev => ({ ...prev, [phone]: false }))
      setNotificacao("Bot retomou a conversa")
      setTimeout(() => setNotificacao(""), 3000)
    } catch {}
  }

  const carregarPedidos = () => {
    fetch("/api/orders")
      .then(r => {
        if (r.status === 401) { router.push("/login?callbackUrl=/pedidos"); return null }
        return r.json()
      })
      .then(data => {
        if (data) {
          const novosIds = data.map((p: Pedido) => p.id)
          const anteriores = prevIdsRef.current
          if (anteriores.length > 0) {
            const chegaram = data.filter((p: Pedido) => !anteriores.includes(p.id))
            if (chegaram.length > 0) {
              tocarSom()
              chegaram.forEach((p: Pedido) => enviarNotificacaoNavegador(p))
              const temEscalonado = chegaram.some((p: Pedido) => p.escalonado)
              if (temEscalonado) {
                setNotificacao("Cliente precisa de atendimento!")
              } else {
                setNotificacao(`${chegaram.length} novo${chegaram.length > 1 ? "s" : ""} pedido${chegaram.length > 1 ? "s" : ""}!`)
              }
              setTimeout(() => setNotificacao(""), 4000)
            }
          }
          prevIdsRef.current = novosIds
          setPedidos(data)
          setLoading(false)
          setErro("")
          setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR"))
        }
      })
      .catch(() => setErro("Erro ao carregar pedidos. Tentando novamente..."))
  }

  const avancarStatus = async (id: string, novoStatus: Status) => {
    setAtualizando(id)
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: novoStatus }),
    })
    if (res.ok) {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p))
      setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR"))
    }
    setAtualizando(null)
  }

  const contagem = (s: Status | "todos") =>
    s === "todos" ? pedidos.length : pedidos.filter(p => p.status === s).length

  const pedidosFiltrados = filtro === "todos" ? pedidos : pedidos.filter(p => p.status === filtro)
  const ativos = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status)).length
  const escalonados = pedidos.filter(p => p.escalonado && p.status === "novo").length

  return (
    <div className="min-h-screen bg-gray-50">
      {notificacao && (
        <div className={`fixed top-4 left-4 right-4 z-50 text-white px-4 py-3 rounded-xl shadow-lg font-semibold text-center ${
          notificacao.includes("atendimento") ? "bg-orange-500" : "bg-green-600"
        }`}>
          {notificacao}
        </div>
      )}

      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <span className="text-xl">ðŸ•</span>
          <span className="font-bold text-gray-900">ChefBot</span>
        </div>
        {userName && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 hidden sm:inline">Ola, <strong>{userName}</strong></span>
            <button
              onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/login"))}
              className="text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-2 py-1"
            >
              Sair
            </button>
          </div>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-3 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">Carregando pedidos...</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h1 className="text-xl font-bold text-gray-900">Gestao de Pedidos</h1>
              <p className="text-xs text-gray-500">
                {ativos} ativo{ativos !== 1 ? "s" : ""}
                {ultimaAtualizacao && <span className="text-gray-400"> - {ultimaAtualizacao}</span>}
              </p>
              {erro && <p className="text-xs text-red-500 mt-1">{erro}</p>}
            </div>

            {escalonados > 0 && (
              <div className="mb-3 p-3 bg-orange-50 border-2 border-orange-300 rounded-xl flex items-center gap-2">
                <span className="text-xl">âš ï¸</span>
                <p className="text-sm font-semibold text-orange-800">
                  {escalonados} cliente{escalonados > 1 ? "s" : ""} aguardando atendimento!
                </p>
              </div>
            )}

            {permissaoNotif === "denied" && (
              <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-xl flex items-center gap-2">
                <p className="text-xs text-yellow-800">Notificacoes bloqueadas. Ative nas configuracoes do navegador.</p>
              </div>
            )}

            {permissaoNotif === "default" && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between gap-2">
                <p className="text-xs text-blue-800">Ative notificacoes para alertas de novos pedidos.</p>
                <button
                  onClick={pedirPermissaoNotificacao}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg whitespace-nowrap"
                >
                  Ativar
                </button>
              </div>
            )}

            <div className={`mb-4 p-3 rounded-xl border-2 flex items-center justify-between ${
              botAtivo ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
            }`}>
              <div>
                <p className="font-semibold text-gray-900 text-sm">
                  {botAtivo ? "Bot ativo" : "Bot pausado"}
                </p>
                <p className="text-xs text-gray-500">
                  {botAtivo ? "Respondendo automaticamente" : "Atendimento manual"}
                </p>
              </div>
              <button
                onClick={alternarBot}
                disabled={salvandoBot}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none flex-shrink-0 ${
                  salvandoBot ? "opacity-50 cursor-not-allowed" : ""
                } ${botAtivo ? "bg-green-500" : "bg-red-400"}`}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                  botAtivo ? "translate-x-7" : "translate-x-1"
                }`} />
              </button>
            </div>

            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {(["todos", "novo", "em_preparo", "saiu_entrega", "entregue", "cancelado"] as const).map(s => {
                const count = contagem(s)
                const labels: Record<string, string> = {
                  todos: "Todos",
                  novo: "Novo",
                  em_preparo: "Preparo",
                  saiu_entrega: "Entrega",
                  entregue: "Entregue",
                  cancelado: "Cancelado",
                }
                return (
                  <button
                    key={s}
                    onClick={() => setFiltro(s)}
                    className={`relative px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                      filtro === s ? "bg-red-600 text-white" : "bg-white text-gray-600 border border-gray-200"
                    }`}
                  >
                    {labels[s]}
                    {count > 0 && (
                      <span className={`ml-1 inline-flex items-center justify-center w-4 h-4 text-xs font-bold rounded-full ${
                        filtro === s ? "bg-white text-red-600" : "bg-red-600 text-white"
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="space-y-3">
              {pedidosFiltrados.length === 0 && (
                <div className="text-center py-12 text-gray-400">Nenhum pedido encontrado</div>
              )}
              {pedidosFiltrados.map(pedido => {
                const emManual = manuais[pedido.telefone] === true
                const isEscalonado = pedido.escalonado === true
                return (
                  <div key={pedido.id} className={`rounded-xl border-2 shadow-sm p-3 ${
                    isEscalonado
                      ? "bg-orange-50 border-orange-300"
                      : emManual
                        ? "bg-blue-50 border-blue-200"
                        : "bg-white border-gray-100"
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{pedido.cliente}</span>
                        <span className="text-xs text-gray-400">{pedido.horario}</span>
                        {isEscalonado && (
                          <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-bold">
                            Atendimento
                          </span>
                        )}
                        {!isEscalonado && emManual && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            Manual
                          </span>
                        )}
                      </div>
                      {!isEscalonado && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${STATUS_COR[pedido.status]}`}>
                          {STATUS_LABEL[pedido.status]}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-500 mb-0.5">Tel: {pedido.telefone}</p>
                    <p className="text-xs text-gray-500 mb-1">End: {pedido.endereco}</p>
                    <div className="text-xs text-gray-700 mb-1">
                      {pedido.itens.map((item, i) => <span key={i} className="mr-2">- {item}</span>)}
                    </div>
                    {pedido.total > 0 && (
                      <p className="font-bold text-gray-900 text-sm mb-2">R$ {pedido.total.toFixed(2)}</p>
                    )}

                    <div className="flex gap-2 flex-wrap">
                      {emManual || isEscalonado ? (
                        <button
                          onClick={() => devolverAoBot(pedido.telefone)}
                          className="flex-1 text-xs py-2 rounded-lg bg-blue-600 text-white font-medium"
                        >
                          Devolver ao bot
                        </button>
                      ) : (
                        <button
                          onClick={() => assumirConversa(pedido.telefone)}
                          className="flex-1 text-xs py-2 rounded-lg bg-gray-200 text-gray-700 font-medium"
                        >
                          Assumir conversa
                        </button>
                      )}
                      {!isEscalonado && PROXIMO_STATUS[pedido.status] && (
                        <button
                          onClick={() => avancarStatus(pedido.id, PROXIMO_STATUS[pedido.status]!)}
                          disabled={atualizando === pedido.id}
                          className={`flex-1 text-xs py-2 rounded-lg font-medium ${
                            atualizando === pedido.id
                              ? "bg-gray-300 text-gray-500"
                              : "bg-red-600 text-white"
                          }`}
                        >
                          {atualizando === pedido.id ? "Salvando..." : "Avancar"}
                        </button>
                      )}
                      {!isEscalonado && pedido.status === "novo" && (
                        <button
                          onClick={() => avancarStatus(pedido.id, "cancelado")}
                          className="text-xs py-2 px-3 rounded-lg text-red-500 border border-red-200"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
