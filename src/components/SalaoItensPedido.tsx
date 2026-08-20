"use client"

import type { ItemApp } from "@/lib/pedidoAppItens"

const money = (valor: number) => "R$ " + valor.toFixed(2).replace(".", ",")

export default function SalaoItensPedido({ itens }: { itens: ItemApp[] }) {
  if (itens.length === 0) return null

  const total = itens.reduce((soma, item) => soma + item.price * item.qty, 0)
  const rotuloQuantidade = itens.length === 1 ? "1 item" : `${itens.length} itens`

  return (
    <section
      aria-label="Itens adicionados ao pedido"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--surface-secondary)",
        borderRadius: 12,
        padding: "10px 12px",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".45px", textTransform: "uppercase", color: "var(--foreground-muted)" }}>
          Itens no pedido
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--brand-text)", whiteSpace: "nowrap" }}>
          {rotuloQuantidade} · {money(total)}
        </span>
      </div>

      <div style={{ display: "grid", gap: 6, maxHeight: 132, overflowY: "auto" }}>
        {itens.slice().reverse().map((item, indice) => (
          <div
            key={`${item.name}-${item.detail}-${indice}`}
            data-testid="salao-item-resumo"
            style={{
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 8,
              minHeight: 32,
            }}
          >
            <span style={{ minWidth: 28, height: 28, padding: "0 6px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--primary-soft)", color: "var(--brand-text)", fontSize: 12, fontWeight: 900 }}>
              {item.qty}×
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {item.name}
              </span>
              {item.detail && (
                <span style={{ display: "block", fontSize: 11, color: "var(--foreground-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.detail}
                </span>
              )}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--foreground-secondary)", whiteSpace: "nowrap" }}>
              {money(item.price * item.qty)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
