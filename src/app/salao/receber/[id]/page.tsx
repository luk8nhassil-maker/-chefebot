"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Banknote, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react"
import { gerarClientRequestId } from "@/survival/clientRequestId"
import { norm } from "@/lib/pedidoAppItens"

type Conta = {
  status: "aberta" | "conta_solicitada" | "fechando" | "fechada"
}

type ComandaOperacional = {
  id: string
  numero: number
  cliente?: string
  mesa?: string
  complemento?: string
  conta: Conta
  totalAtivoCentavos: number
}

type FormPagamento = {
  forma: string
  troco: string
  valorPix: string
  valorDinheiro: string
}

const VAZIO: FormPagamento = { forma: "", troco: "", valorPix: "", valorDinheiro: "" }
const FONT = "'Archivo', sans-serif"

function moeda(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100)
}

function ehDinheiro(valor: string) {
  return norm(valor).includes("dinheiro")
}

function ehMisto(valor: string) {
  const n = norm(valor)
  return n.includes("misto") || (n.includes("pix") && n.includes("dinheiro"))
}

export default function ReceberContaSalaoPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const comandaId = typeof params?.id === "string" ? params.id : ""
  const [comanda, setComanda] = useState<ComandaOperacional | null>(null)
  const [pagamentos, setPagamentos] = useState<string[]>([])
  const [form, setForm] = useState<FormPagamento>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState("")
  const [fechada, setFechada] = useState(false)
  const requestIdRef = useRef<string | null>(null)

  const carregar = useCallback(async () => {
    if (!comandaId) return
    try {
      const [operacaoRes, cardapioRes] = await Promise.all([
        fetch("/api/salao/operacao", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/cardapio", { cache: "no-store", credentials: "same-origin" }),
      ])
      if (operacaoRes.status === 401) {
        router.replace("/salao/login")
        return
      }
      const [operacao, cardapio] = await Promise.all([
        operacaoRes.json().catch(() => null),
        cardapioRes.json().catch(() => null),
      ])
      if (!operacaoRes.ok || !operacao?.ok || !Array.isArray(operacao.comandas)) {
        setErro(operacao?.error || "Não foi possível carregar esta conta agora.")
        return
      }
      const encontrada = operacao.comandas.find((item: ComandaOperacional) => item.id === comandaId)
      if (!encontrada) {
        setErro("Esta comanda não está mais aguardando atendimento.")
        return
      }
      if (!cardapioRes.ok || !Array.isArray(cardapio?.payments)) {
        setErro("Não foi possível carregar as formas de pagamento.")
        return
      }
      setComanda(encontrada)
      setPagamentos(cardapio.payments.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0))
      setErro("")
    } catch {
      setErro("Não foi possível carregar esta conta agora. Verifique a conexão.")
    } finally {
      setCarregando(false)
    }
  }, [comandaId, router])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function confirmarPagamento() {
    if (!comanda || !form.forma || processando) return
    if (comanda.conta.status !== "conta_solicitada" && comanda.conta.status !== "fechando") {
      setErro("Peça a conta antes de registrar o pagamento.")
      return
    }

    if (!requestIdRef.current) {
      try {
        requestIdRef.current = gerarClientRequestId()
      } catch {
        setErro("Não foi possível iniciar o fechamento com segurança.")
        return
      }
    }

    setProcessando(true)
    setErro("")
    try {
      const response = await fetch(`/api/salao/comandas/${comanda.id}/pagamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: requestIdRef.current,
          totalEsperadoCentavos: comanda.totalAtivoCentavos,
          pagamento: form.forma,
          ...(ehDinheiro(form.forma) && !ehMisto(form.forma) ? { troco: form.troco || "Sem troco" } : {}),
          ...(ehMisto(form.forma) ? { valorPix: form.valorPix, valorDinheiro: form.valorDinheiro } : {}),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setErro(data?.error || "Não foi possível fechar esta conta.")
        if (response.status < 500) requestIdRef.current = null
        return
      }
      requestIdRef.current = null
      setFechada(true)
    } catch {
      setErro("Não foi possível confirmar se o fechamento terminou. Tente novamente nesta mesma tela, sem registrar outro pagamento.")
    } finally {
      setProcessando(false)
    }
  }

  if (carregando) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--background)" }}><LoaderCircle className="animate-spin" /></main>
  }

  if (fechada) {
    return (
      <main style={{ minHeight: "100dvh", background: "var(--background)", color: "var(--foreground)", fontFamily: FONT, display: "grid", placeItems: "center", padding: 20 }}>
        <section style={{ width: "100%", maxWidth: 430, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 22, display: "grid", gap: 14, textAlign: "center" }}>
          <CheckCircle2 size={46} color="var(--success)" style={{ margin: "0 auto" }} />
          <h1 style={{ margin: 0, fontSize: 23 }}>Pagamento confirmado</h1>
          <p style={{ margin: 0, color: "var(--foreground-secondary)", lineHeight: 1.45 }}>A mesa foi fechada e a comanda saiu dos pedidos abertos.</p>
          <button onClick={() => router.replace("/salao")} style={{ height: 50, border: 0, borderRadius: 12, background: "var(--primary)", color: "var(--background)", fontWeight: 900, fontFamily: FONT, cursor: "pointer" }}>Voltar ao Salão</button>
        </section>
      </main>
    )
  }

  if (!comanda) {
    return (
      <main style={{ minHeight: "100dvh", background: "var(--background)", color: "var(--foreground)", fontFamily: FONT, display: "grid", placeItems: "center", padding: 20 }}>
        <section style={{ width: "100%", maxWidth: 430, display: "grid", gap: 12, textAlign: "center" }}>
          <CircleAlert size={38} style={{ margin: "0 auto" }} />
          <strong>{erro || "Comanda não encontrada."}</strong>
          <button onClick={() => router.replace("/salao")} style={{ height: 48, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--foreground)", fontWeight: 900, fontFamily: FONT, cursor: "pointer" }}>Voltar ao Salão</button>
        </section>
      </main>
    )
  }

  const misto = ehMisto(form.forma)
  const dinheiro = ehDinheiro(form.forma) && !misto
  const contaPronta = comanda.conta.status === "conta_solicitada" || comanda.conta.status === "fechando"

  return (
    <main style={{ minHeight: "100dvh", background: "var(--background)", color: "var(--foreground)", fontFamily: FONT, padding: "18px 16px 90px" }}>
      <div style={{ width: "100%", maxWidth: 520, margin: "0 auto", display: "grid", gap: 14 }}>
        <button onClick={() => router.replace("/salao")} style={{ justifySelf: "start", minHeight: 44, border: 0, background: "transparent", color: "var(--foreground-secondary)", fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>‹ Voltar</button>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
          <div style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <span style={{ display: "block", color: "var(--brand-text)", fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>Comanda #{comanda.numero}</span>
              <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>{comanda.cliente || "Atendimento"}</h1>
              <p style={{ margin: "3px 0 0", color: "var(--foreground-secondary)", fontSize: 13 }}>{comanda.mesa ? `Mesa ${comanda.mesa}${comanda.complemento ? ` · ${comanda.complemento}` : ""}` : "Sem mesa"}</p>
            </div>
            <strong style={{ fontSize: 24, whiteSpace: "nowrap" }}>{moeda(comanda.totalAtivoCentavos)}</strong>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", padding: 18, display: "grid", gap: 14 }}>
            <div>
              <p style={{ margin: "0 0 9px", fontSize: 13, fontWeight: 900 }}>Como recebeu?</p>
              <div role="radiogroup" aria-label="Forma de pagamento" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                {pagamentos.map((forma) => {
                  const selecionada = form.forma === forma
                  return (
                    <button
                      key={forma}
                      type="button"
                      role="radio"
                      aria-checked={selecionada}
                      onClick={() => setForm({ ...VAZIO, forma })}
                      disabled={!contaPronta || processando}
                      style={{ minHeight: 48, padding: "8px 10px", borderRadius: 12, border: selecionada ? "2px solid var(--primary)" : "1px solid var(--border)", background: selecionada ? "var(--primary-soft)" : "var(--background)", color: "var(--foreground)", fontWeight: 900, fontFamily: FONT, cursor: "pointer" }}
                    >
                      {forma}
                    </button>
                  )
                })}
              </div>
            </div>

            {dinheiro && (
              <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>
                Troco
                <input value={form.troco} onChange={(event) => setForm((atual) => ({ ...atual, troco: event.target.value }))} placeholder="Sem troco ou valor recebido" inputMode="decimal" style={{ height: 48, borderRadius: 11, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "0 12px", fontWeight: 700, fontFamily: FONT }} />
              </label>
            )}

            {misto && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>Valor no Pix<input value={form.valorPix} onChange={(event) => setForm((atual) => ({ ...atual, valorPix: event.target.value }))} inputMode="decimal" style={{ height: 48, borderRadius: 11, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "0 10px", fontWeight: 700, fontFamily: FONT, minWidth: 0 }} /></label>
                <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>Em dinheiro<input value={form.valorDinheiro} onChange={(event) => setForm((atual) => ({ ...atual, valorDinheiro: event.target.value }))} inputMode="decimal" style={{ height: 48, borderRadius: 11, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "0 10px", fontWeight: 700, fontFamily: FONT, minWidth: 0 }} /></label>
              </div>
            )}

            {erro && <p role="alert" style={{ margin: 0, padding: 10, borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700 }}>{erro}</p>}
            {!contaPronta && <p style={{ margin: 0, color: "var(--attention-text)", fontSize: 12.5, fontWeight: 800 }}>Peça a conta antes de receber o pagamento.</p>}

            <button disabled={!form.forma || !contaPronta || processando} onClick={() => void confirmarPagamento()} style={{ height: 52, border: 0, borderRadius: 12, background: form.forma && contaPronta ? "var(--primary)" : "var(--border)", color: "var(--background)", fontWeight: 900, fontFamily: FONT, cursor: form.forma && contaPronta ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Banknote size={18} /> {processando ? "Confirmando…" : `Receber ${moeda(comanda.totalAtivoCentavos)} e fechar mesa`}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
