"use client"

// Login do Módulo Salão — completamente separado do login administrativo
// (/login): não usa usuário/senha nem o cookie auth-token, só um código de
// acesso configurado pelo admin em /api/admin/salao/config. Pensado para um
// terminal fixo do salão, não para uma conta pessoal por atendente.

import { useState } from "react"
import { useRouter } from "next/navigation"

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--surface-secondary)",
  borderRadius: 16,
  padding: 24,
}
const input: React.CSSProperties = {
  width: "100%",
  height: 52,
  background: "var(--background)",
  border: "1px solid var(--surface-secondary)",
  borderRadius: 12,
  padding: "0 16px",
  color: "var(--foreground)",
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: "4px",
  textAlign: "center",
  fontFamily: "'Archivo', sans-serif",
  outline: "none",
  boxSizing: "border-box",
}

export default function SalaoLoginPage() {
  const router = useRouter()
  const [codigo, setCodigo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    if (enviando || !codigo.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      const r = await fetch("/api/salao/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.trim() }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        setErro(data?.error || "Não foi possível entrar agora.")
        setEnviando(false)
        return
      }
      router.replace("/salao")
      router.refresh()
    } catch {
      setErro("Erro de conexão. Tente novamente.")
      setEnviando(false)
    }
  }

  return (
    <div style={{ minHeight: "100svh", background: "var(--background)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Archivo', sans-serif" }}>
      <form onSubmit={entrar} style={{ ...card, width: "100%", maxWidth: 340, display: "grid", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 32 }}>🍽️</span>
          <p style={{ fontSize: 18, fontWeight: 900, color: "var(--foreground)", margin: "8px 0 2px" }}>Salão</p>
          <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>Código de acesso do terminal</p>
        </div>
        <input
          style={input}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="••••"
          inputMode="text"
          autoFocus
          aria-label="Código de acesso"
        />
        {erro && (
          <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0, textAlign: "center" }}>{erro}</p>
        )}
        <button
          type="submit"
          disabled={enviando || !codigo.trim()}
          style={{ height: 50, border: "none", borderRadius: 12, background: "var(--primary)", color: "var(--background)", fontSize: 15, fontWeight: 900, opacity: enviando || !codigo.trim() ? 0.5 : 1 }}
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  )
}
