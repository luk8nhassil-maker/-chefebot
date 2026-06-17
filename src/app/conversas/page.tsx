"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type Pedido = {
  id: string
  numero?: number
  cliente: string
  telefone: string
  status: string
  horario: string
  escalonado?: boolean
  itens: string[]
}

function whatsappLink(telefone: string): string {
  let numero = (telefone || "").replace(/\D/g, "")
  if (numero && !numero.startsWith("55")) numero = "55" + numero
  return `https://wa.me/${numero}`
}

export default function ConversasPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/orders")
      .then(r => {
        if (r.status === 401) { router.push("/login?callbackUrl=/conversas"); return null }
        return r.json()
      })
      .then(data => { if (data) { setPedidos(data); setLoading(false) } })
      .catch(() => setLoading(false))

    const iv = setInterval(() => {
      fetch("/api/orders").then(r => r.json()).then(setPedidos).catch(() => {})
    }, 10000)
    return () => clearInterval(iv)
  }, [router])

  const escalonados = pedidos.filter(p => p.escalonado && p.status === "novo")
  const emAtendimento = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status))

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#060606", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
        <p style={{ color: "#a39b8b", fontSize: 14, fontFamily: "'Archivo', sans-serif" }}>Carregando...</p>
      </div>
    </div>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: #060606; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; }
        @keyframes cbPulseR { 0%{box-shadow:0 0 0 0 rgba(239,68,68,.5)} 70%{box-shadow:0 0 0 7px rgba(239,68,68,0)} 100%{box-shadow:0 0 0 0 rgba(239,68,68,0)} }
        @keyframes cbFadeIn { from{opacity:0} to{opacity:1} }
      `}</style>

      <div style={{ minHeight: "100svh", maxWidth: 375, margin: "0 auto", background: "#060606", color: "#f5f2ee", fontFamily: "'Archivo', sans-serif", display: "flex", flexDirection: "column", paddingBottom: "calc(env(safe-area-inset-bottom) + 90px)" }}>

        <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "calc(env(safe-area-inset-top) + 18px) 16px 16px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.4px" }}>Conversas</div>
            <div style={{ fontSize: 11, color: "#5a564d", fontWeight: 700, marginTop: 2 }}>Atendimentos humanos</div>
          </div>
        </header>

        {escalonados.length > 0 && (
          <div style={{ margin: "0 16px 16px", padding: 16, borderRadius: 18, background: "rgba(239,68,68,.08)", border: "1.5px solid rgba(239,68,68,.4)" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#ef4444", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ef4444", marginRight: 7, animation: "cbPulseR 1.6s infinite" }} />
              {escalonados.length} aguardando atendimento
            </div>
            {escalonados.map(p => (
              <div key={p.id} style={{ background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 14, padding: "12px 14px", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 900 }}>{p.cliente.split(" ")[0]}</div>
                    <div style={{ fontSize: 11, color: "#a39b8b", marginTop: 2 }}>{p.telefone} · {p.horario}</div>
                  </div>
                  {p.numero != null && <span style={{ background: "rgba(239,68,68,.15)", color: "#ef4444", fontSize: 11, fontWeight: 900, padding: "3px 8px", borderRadius: 7 }}>#{p.numero}</span>}
                </div>
                <a
                  href={whatsappLink(p.telefone)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, background: "#25d366", border: "none", borderRadius: 12, color: "#fff", fontSize: 14, fontWeight: 900, textDecoration: "none" }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,.6)" }} />
                  Abrir WhatsApp
                </a>
              </div>
            ))}
          </div>
        )}

        {escalonados.length === 0 && (
          <div style={{ margin: "0 16px 16px", padding: "24px 20px", borderRadius: 18, background: "#101010", border: "1px solid #1f1d1a", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#22c55e" }}>Sem atendimentos pendentes</div>
            <div style={{ fontSize: 12, color: "#5a564d", marginTop: 4 }}>Nenhum cliente aguardando atendimento humano agora.</div>
          </div>
        )}

        <div style={{ padding: "0 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "1.2px", textTransform: "uppercase", color: "#56524b", marginBottom: 12 }}>Em atendimento hoje</div>
          {emAtendimento.length === 0 && (
            <div style={{ background: "#101010", border: "1px dashed #2a2723", borderRadius: 16, padding: "24px 20px", textAlign: "center", color: "#5a564d", fontSize: 13, fontWeight: 700 }}>Nenhum pedido em aberto</div>
          )}
          {emAtendimento.map(p => (
            <div key={p.id} style={{ background: "#101010", border: "1px solid #1f1d1a", borderRadius: 16, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  {p.numero != null && <span style={{ background: "rgba(255,255,255,.08)", color: "#c9c2b4", fontSize: 10, fontWeight: 900, padding: "2px 6px", borderRadius: 6 }}>#{p.numero}</span>}
                  <span style={{ fontSize: 14, fontWeight: 900, color: "#f4f1ec" }}>{p.cliente.split(" ")[0]}</span>
                </div>
                <div style={{ fontSize: 11, color: "#5a564d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.telefone}</div>
              </div>
              <a
                href={whatsappLink(p.telefone)}
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 36, padding: "0 12px", background: "rgba(37,211,102,.1)", border: "1px solid rgba(37,211,102,.3)", borderRadius: 10, color: "#25d366", fontSize: 12, fontWeight: 900, textDecoration: "none", flexShrink: 0 }}
              >
                WhatsApp
              </a>
            </div>
          ))}
        </div>

        <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "rgba(8,8,8,.94)", backdropFilter: "blur(14px)", borderTop: "1px solid #1f1d1a", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "10px 8px calc(env(safe-area-inset-bottom) + 18px)", zIndex: 40 }}>
          <button onClick={() => router.push("/pedidos")} style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" stroke="#5a564d" strokeWidth="2.2"/><line x1="8" y1="9" x2="16" y2="9" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round"/><line x1="8" y1="14" x2="13" y2="14" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round"/></svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#5a564d" }}>Pedidos</span>
          </button>
          <button style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke="#ff6b00" strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.4" fill="#ff6b00"/><circle cx="12" cy="11" r="1.4" fill="#ff6b00"/><circle cx="15.5" cy="11" r="1.4" fill="#ff6b00"/></svg>
            <span style={{ fontSize: 11, fontWeight: 900, color: "#ff6b00" }}>Conversas</span>
          </button>
          <button onClick={() => router.push("/cardapio")} style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/></svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#5a564d" }}>Cardápio</span>
          </button>
        </nav>
      </div>
    </>
  )
}
