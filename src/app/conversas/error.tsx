"use client"
import { useEffect } from "react"

export default function ConversasError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[conversas] erro de renderização:", error)
  }, [error])

  return (
    <div style={{
      height: "100svh",
      background: "#060606",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Archivo', sans-serif",
    }}>
      <div style={{ textAlign: "center", maxWidth: 320, padding: "0 24px" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <p style={{ color: "#e05050", fontSize: 15, fontWeight: 800, margin: "0 0 8px" }}>
          Erro ao carregar conversas
        </p>
        <p style={{ color: "#5a564d", fontSize: 13, fontWeight: 600, margin: "0 0 20px", lineHeight: 1.5 }}>
          Ocorreu um erro inesperado. Tente recarregar a página.
        </p>
        <button
          onClick={reset}
          style={{
            background: "rgba(255,107,0,.15)",
            border: "1px solid rgba(255,107,0,.3)",
            borderRadius: 12,
            color: "#ff6b00",
            fontSize: 13,
            fontWeight: 800,
            padding: "10px 24px",
            cursor: "pointer",
          }}
        >
          Tentar novamente
        </button>
      </div>
    </div>
  )
}
