"use client"

// Entrada do Módulo Salão — sem código de acesso: a sessão é emitida
// automaticamente ao abrir esta página (ver /api/salao/login e
// src/lib/salaoAuth.ts para o contexto da decisão de remover o bloqueio).

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--surface-secondary)",
  borderRadius: 16,
  padding: 24,
}

export default function SalaoLoginPage() {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    async function entrar() {
      try {
        const r = await fetch("/api/salao/login", { method: "POST" })
        if (cancelado) return
        if (!r.ok) { setErro("Não foi possível entrar agora."); return }
        router.replace("/salao")
        router.refresh()
      } catch {
        if (!cancelado) setErro("Erro de conexão. Tente novamente.")
      }
    }
    entrar()
    return () => { cancelado = true }
  }, [router])

  return (
    <div style={{ minHeight: "100svh", background: "var(--background)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Archivo', sans-serif" }}>
      <div style={{ ...card, width: "100%", maxWidth: 340, display: "grid", gap: 12, textAlign: "center" }}>
        <span style={{ fontSize: 32 }}>🍽️</span>
        <p style={{ fontSize: 18, fontWeight: 900, color: "var(--foreground)", margin: 0 }}>Salão</p>
        {erro ? (
          <>
            <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erro}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ height: 46, border: "none", borderRadius: 12, background: "var(--primary)", color: "var(--background)", fontSize: 14, fontWeight: 900, cursor: "pointer" }}
            >
              Tentar de novo
            </button>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>Entrando…</p>
        )}
      </div>
    </div>
  )
}
