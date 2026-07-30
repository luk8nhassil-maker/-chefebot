"use client"
import { useEffect } from "react"

export default function PedidosError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // A mensagem técnica fica no log, nunca na tela de quem está atendendo.
    console.error("[pedidos] erro de renderização:", error)
  }, [error])

  return (
    <div style={{
      minHeight: "100svh",
      background: "var(--background)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Archivo', sans-serif",
    }}>
      <div style={{ textAlign: "center", maxWidth: 320, padding: "0 24px" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <p style={{ color: "var(--danger)", fontSize: 15, fontWeight: 800, margin: "0 0 8px" }}>
          Erro ao carregar os pedidos
        </p>
        <p style={{ color: "var(--foreground-muted)", fontSize: 13, fontWeight: 600, margin: "0 0 20px", lineHeight: 1.5 }}>
          Os pedidos continuam salvos. Recarregue para voltar ao painel.
        </p>
        <button
          onClick={reset}
          style={{
            background: "color-mix(in srgb, var(--primary) 15%, transparent)",
            border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)",
            borderRadius: 12,
            color: "var(--brand-text)",
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
