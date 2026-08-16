"use client"

// Gate operacional bloqueante. Toda regra de tempo, prioridade e ações vive em
// src/lib/limpezaOperacionalPedidos.ts; este componente só apresenta uma
// decisão por vez. Não existe fechar, ESC, clique no fundo ou "ignorar" porque
// isso recriaria exatamente o problema que o gate precisa eliminar: pedido
// esquecido no meio do processo.

import { useMemo, useState, useSyncExternalStore } from "react"
import {
  listarPendencias,
  calcularAnaliseOperacional,
  acaoPrincipal,
  acaoSecundaria,
  acaoTerciaria,
  type PedidoLimpeza,
  type Pendencia,
  type OpcaoResolucao,
} from "@/lib/limpezaOperacionalPedidos"

/**
 * A cobrança operacional passa a ser padrão. `false` explícito continua sendo
 * o rollback rápido caso a loja precise desativar o gate sem novo deploy.
 */
export function limpezaOperacionalAtiva(): boolean {
  return process.env.NEXT_PUBLIC_LIMPEZA_OPERACIONAL_ENABLED !== "false"
}

export type ResolverPendencia = (pendencia: Pendencia, opcao: OpcaoResolucao) => Promise<void>

type Props = {
  pedidos: readonly PedidoLimpeza[]
  onResolver: ResolverPendencia
  /** Permite desligar o gate em contextos que não são operação ativa. */
  ativo?: boolean
}

const CADENCIA_RECLASSIFICACAO_MS = 15_000

let relogioAgora = 0
const ouvintesRelogio = new Set<() => void>()
let intervaloRelogio: number | null = null

function avancarRelogio() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return
  relogioAgora = Date.now()
  ouvintesRelogio.forEach((notificar) => notificar())
}

function assinarRelogio(onChange: () => void): () => void {
  ouvintesRelogio.add(onChange)
  if (intervaloRelogio === null) {
    relogioAgora = Date.now()
    intervaloRelogio = window.setInterval(avancarRelogio, CADENCIA_RECLASSIFICACAO_MS)
    document.addEventListener("visibilitychange", avancarRelogio)
  }
  return () => {
    ouvintesRelogio.delete(onChange)
    if (ouvintesRelogio.size === 0 && intervaloRelogio !== null) {
      window.clearInterval(intervaloRelogio)
      document.removeEventListener("visibilitychange", avancarRelogio)
      intervaloRelogio = null
    }
  }
}

const lerRelogio = () => relogioAgora
const lerRelogioNoServidor = () => 0

type BotaoOcupado = "principal" | "secundaria" | "terciaria"

export default function LimpezaOperacionalGate({ pedidos, onResolver, ativo = true }: Props) {
  const agora = useSyncExternalStore(assinarRelogio, lerRelogio, lerRelogioNoServidor)
  const [ocupado, setOcupado] = useState<BotaoOcupado | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const { pendencias, analise } = useMemo(
    () => ({
      pendencias: listarPendencias(pedidos, agora),
      analise: calcularAnaliseOperacional(pedidos, agora),
    }),
    [pedidos, agora]
  )

  const atual = pendencias[0]
  if (!ativo || !atual) return null

  const principal = acaoPrincipal(atual)
  const secundaria = acaoSecundaria(atual)
  const terciaria = acaoTerciaria(atual)
  const total = pendencias.length

  async function resolver(opcao: OpcaoResolucao, qual: BotaoOcupado) {
    if (ocupado) return
    setOcupado(qual)
    setErro(null)
    try {
      await onResolver(atual, opcao)
    } catch {
      setErro("Não consegui registrar agora. Tente novamente. Esta pendência continuará aberta.")
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="limpeza-titulo"
      aria-describedby="limpeza-descricao"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(var(--overlay-rgb), 0.76)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "'Archivo', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--surface)",
          border: "1px solid var(--surface-secondary)",
          borderRadius: 20,
          padding: 20,
          boxSizing: "border-box",
          boxShadow: "0 24px 80px rgba(0,0,0,.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: ".7px",
              textTransform: "uppercase",
              color: "var(--attention-text)",
              margin: 0,
            }}
          >
            ⚠ Ação necessária
          </p>
          <p style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-muted)", margin: 0 }}>
            {total > 1 ? `1 de ${total}` : "1 pendência"}
          </p>
        </div>

        <h2
          id="limpeza-titulo"
          style={{
            fontSize: 20,
            lineHeight: 1.2,
            fontWeight: 900,
            color: "var(--foreground)",
            margin: "10px 0 0",
          }}
        >
          {atual.titulo}
        </h2>

        <p style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground-secondary)", margin: "7px 0 0" }}>
          {atual.numero ? `Pedido #${atual.numero}` : `Pedido ${atual.pedidoId}`}
          {atual.cliente ? ` · ${atual.cliente}` : ""}
        </p>

        <p
          id="limpeza-descricao"
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--foreground-secondary)",
            lineHeight: 1.5,
            margin: "13px 0 0",
          }}
        >
          {atual.descricao}
        </p>

        <div
          style={{
            marginTop: 14,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--attention) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--attention) 26%, transparent)",
            padding: "9px 11px",
          }}
        >
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, fontWeight: 700, color: "var(--foreground-secondary)" }}>
            O painel só continua depois que uma ação for registrada. Se o pedido ainda estiver nesta etapa, escolha a opção de aguardar e o ChefeBot voltará a cobrar no prazo correto.
          </p>
        </div>

        {erro && (
          <p
            role="status"
            aria-live="polite"
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              color: "var(--danger)",
              margin: "12px 0 0",
              lineHeight: 1.45,
            }}
          >
            {erro}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 18 }}>
          <button
            autoFocus
            onClick={() => resolver(principal, "principal")}
            disabled={!!ocupado}
            style={{
              minHeight: 54,
              border: "none",
              borderRadius: 13,
              padding: "12px 14px",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              fontSize: 14,
              lineHeight: 1.2,
              fontWeight: 950,
              letterSpacing: ".2px",
              cursor: ocupado ? "default" : "pointer",
              opacity: ocupado ? 0.6 : 1,
              boxShadow: "0 8px 24px color-mix(in srgb, var(--primary) 28%, transparent)",
            }}
          >
            {ocupado === "principal" ? "REGISTRANDO…" : principal.label}
          </button>

          <button
            onClick={() => resolver(secundaria, "secundaria")}
            disabled={!!ocupado}
            style={{
              minHeight: 48,
              border: "1px solid var(--surface-secondary)",
              borderRadius: 12,
              padding: "11px 13px",
              background: "transparent",
              color: "var(--foreground-secondary)",
              fontSize: 13,
              lineHeight: 1.25,
              fontWeight: 800,
              cursor: ocupado ? "default" : "pointer",
              opacity: ocupado ? 0.6 : 1,
            }}
          >
            {ocupado === "secundaria" ? "Registrando…" : secundaria.label}
          </button>

          {terciaria && (
            <button
              onClick={() => resolver(terciaria, "terciaria")}
              disabled={!!ocupado}
              style={{
                minHeight: 42,
                border: "none",
                borderRadius: 10,
                padding: "9px 12px",
                background: "transparent",
                color: "var(--danger)",
                fontSize: 12.5,
                lineHeight: 1.2,
                fontWeight: 800,
                cursor: ocupado ? "default" : "pointer",
                opacity: ocupado ? 0.6 : 1,
              }}
            >
              {ocupado === "terciaria" ? "Registrando…" : terciaria.label}
            </button>
          )}
        </div>

        {analise.resolvidasHoje > 0 && (
          <p style={{ fontSize: 11.5, fontWeight: 700, color: "var(--foreground-muted)", margin: "14px 0 0", textAlign: "center" }}>
            {analise.resolvidasHoje} pendência{analise.resolvidasHoje > 1 ? "s" : ""} resolvida
            {analise.resolvidasHoje > 1 ? "s" : ""} hoje
          </p>
        )}
      </div>
    </div>
  )
}
