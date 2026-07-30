"use client"

// Gate de limpeza operacional — apresentação. Toda a regra (quem é pendência,
// qual é o motivo, qual ação é oferecida) vive em
// src/lib/limpezaOperacionalPedidos.ts, testável sem montar componente.
//
// O gate é BLOQUEANTE de propósito: uma lista de alertas que dá para ignorar é
// uma lista que ninguém lê. Ele apresenta uma pendência por vez, com contador
// de progresso, e não oferece "fechar" nem "ignorar" — só as duas saídas
// derivadas do estado do pedido.
//
// A ativação é por flag (ver `limpezaOperacionalAtiva`): enquanto desligada, o
// painel de pedidos se comporta exatamente como antes deste componente.

import { useMemo, useState, useSyncExternalStore } from "react"
import {
  listarPendencias,
  calcularAnaliseOperacional,
  acaoPrincipal,
  acaoSecundaria,
  type PedidoLimpeza,
  type Pendencia,
  type OpcaoResolucao,
} from "@/lib/limpezaOperacionalPedidos"

/**
 * NEXT_PUBLIC_* é a única forma de uma env var chegar ao bundle do navegador —
 * mesma convenção já usada em src/lib/pixAutoCheckConfig.ts. Padrão desligado:
 * o gate só aparece quando a loja decidir adotá-lo.
 */
export function limpezaOperacionalAtiva(): boolean {
  return process.env.NEXT_PUBLIC_LIMPEZA_OPERACIONAL_ENABLED === "true"
}

export type ResolverPendencia = (pendencia: Pendencia, opcao: OpcaoResolucao) => Promise<void>

type Props = {
  pedidos: readonly PedidoLimpeza[]
  onResolver: ResolverPendencia
  /** Permite desligar o gate sem remover a montagem (ex.: aba de arquivados). */
  ativo?: boolean
}

const CADENCIA_RECLASSIFICACAO_MS = 60_000

// Relógio como fonte externa. A idade de uma pendência depende do tempo, que
// é estado de fora do React: `useSyncExternalStore` é a primitiva certa para
// isso. O instantâneo fica em cache e só muda quando o relógio avança, o que
// mantém o render puro (nada de Date.now() no corpo) e dispensa setState
// dentro de efeito.
//
// Aba em segundo plano não avança o relógio: ninguém está olhando, e o retorno
// à aba dispara um passe imediato pelo `visibilitychange`.
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
// No servidor o relógio é 0: todas as idades ficam zeradas e nenhuma pendência
// é acusada, de modo que a marcação renderizada no servidor e a da primeira
// renderização no cliente são idênticas.
const lerRelogioNoServidor = () => 0

export default function LimpezaOperacionalGate({ pedidos, onResolver, ativo = true }: Props) {
  const agora = useSyncExternalStore(assinarRelogio, lerRelogio, lerRelogioNoServidor)
  const [ocupado, setOcupado] = useState<null | "principal" | "secundaria">(null)
  const [erro, setErro] = useState<string | null>(null)

  // Reclassifica quando a lista de pedidos muda (o painel já faz polling) ou
  // quando o relógio avança — o segundo existe para o caso de nada mudar na
  // lista e mesmo assim uma pendência amadurecer.
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
  const total = pendencias.length

  async function resolver(opcao: OpcaoResolucao, qual: "principal" | "secundaria") {
    if (ocupado) return
    setOcupado(qual)
    setErro(null)
    try {
      await onResolver(atual, opcao)
    } catch {
      // Linguagem de recuperação, não de falha técnica: a pendência continua
      // na tela e a operadora pode tentar de novo ou usar a outra saída.
      setErro("Não consegui registrar agora. Tente de novo ou use a outra opção.")
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="limpeza-titulo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(var(--overlay-rgb), 0.72)",
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
          maxWidth: 420,
          background: "var(--surface)",
          border: "1px solid var(--surface-secondary)",
          borderRadius: 18,
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: ".6px",
            textTransform: "uppercase",
            color: "var(--foreground-muted)",
            margin: 0,
          }}
        >
          Pendência {total > 1 ? `1 de ${total}` : "operacional"}
        </p>

        <h2
          id="limpeza-titulo"
          style={{ fontSize: 19, fontWeight: 900, color: "var(--foreground)", margin: "8px 0 0" }}
        >
          {atual.titulo}
        </h2>

        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)", margin: "6px 0 0" }}>
          {atual.numero ? `#${atual.numero}` : atual.pedidoId}
          {atual.cliente ? ` · ${atual.cliente}` : ""}
        </p>

        <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--foreground-secondary)", lineHeight: 1.5, margin: "12px 0 0" }}>
          {atual.descricao}
        </p>

        {erro && (
          <p role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: "12px 0 0" }}>
            {erro}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
          <button
            onClick={() => resolver(principal, "principal")}
            disabled={!!ocupado}
            style={{
              height: 46,
              border: "none",
              borderRadius: 12,
              background: "var(--primary)",
              color: "var(--background)",
              fontSize: 14,
              fontWeight: 900,
              cursor: ocupado ? "default" : "pointer",
              opacity: ocupado ? 0.6 : 1,
            }}
          >
            {ocupado === "principal" ? "Registrando…" : principal.label}
          </button>

          <button
            onClick={() => resolver(secundaria, "secundaria")}
            disabled={!!ocupado}
            style={{
              height: 46,
              border: "1px solid var(--surface-secondary)",
              borderRadius: 12,
              background: "transparent",
              color: "var(--danger)",
              fontSize: 14,
              fontWeight: 800,
              cursor: ocupado ? "default" : "pointer",
              opacity: ocupado ? 0.6 : 1,
            }}
          >
            {ocupado === "secundaria" ? "Registrando…" : secundaria.label}
          </button>
        </div>

        {analise && analise.resolvidasHoje > 0 && (
          <p style={{ fontSize: 11.5, fontWeight: 700, color: "var(--foreground-muted)", margin: "14px 0 0", textAlign: "center" }}>
            {analise.resolvidasHoje} pendência{analise.resolvidasHoje > 1 ? "s" : ""} resolvida
            {analise.resolvidasHoje > 1 ? "s" : ""} hoje
          </p>
        )}
      </div>
    </div>
  )
}
