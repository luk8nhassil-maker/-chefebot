"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import {
  listarPendencias,
  acaoPrincipal,
  acaoSecundaria,
  acaoTerciaria,
  LIMIAR_NOVO_SEM_ACEITE_MIN,
  LIMIAR_REAVISO_PREPARO_MIN,
  LIMIAR_REAVISO_ENTREGA_MIN,
  type PedidoLimpeza,
  type Pendencia,
  type OpcaoResolucao,
} from "@/lib/limpezaOperacionalPedidos"
import {
  MOTIVOS_PROBLEMA_ENTREGA,
  ROTULOS_PROBLEMA_ENTREGA,
  mensagemProblemaEntrega,
  MOTIVO_RETIRADA_ATRASADA,
  type MotivoProblemaEntrega,
} from "@/lib/problemaEntrega"

// Decisão operacional: o gate é obrigatório no painel ativo. A variável antiga
// de rollout não pode mais desligar a cobrança em produção.
export function limpezaOperacionalAtiva(): boolean {
  return true
}

export type ResolverPendencia = (pendencia: Pendencia, opcao: OpcaoResolucao) => Promise<void>

type Props = {
  pedidos: readonly PedidoLimpeza[]
  onResolver: ResolverPendencia
  ativo?: boolean
}

const CADENCIA_RECLASSIFICACAO_MS = 1_000
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

type BotaoOcupado = "principal" | "secundaria" | "terciaria" | "entrega"

function instrucaoCurta(p: Pendencia): string {
  if (p.motivo === "pagamento_pix_pendente") return "Confira no Mercado Pago."
  if (p.status === "novo") return "Decida: fazer, aguardar ou cancelar."
  if (p.status === "em_preparo") return "Atualize se avançou ou continua fazendo."
  if (p.modalidade === "retirada") return "Confirme se retirou ou ainda está aguardando."
  if (p.modalidade === "dine_in") return "Confirme se foi servido ou ainda está aguardando."
  return "Confirme se entregou ou ainda está a caminho."
}

function resultadoPrincipal(p: Pendencia): string {
  if (p.motivo === "pagamento_pix_pendente") return "→ Se pago, sai da pendência; se não, continua aguardando."
  if (p.status === "novo") return "→ Vai para Fazendo e passa ao próximo."
  if (p.status === "em_preparo") {
    if (p.modalidade === "retirada") return "→ Vai para Pronto para retirada e passa ao próximo."
    if (p.modalidade === "dine_in") return "→ Vai para Pronto para servir e passa ao próximo."
    return "→ Vai para Na rua e passa ao próximo."
  }
  return "→ Finaliza o pedido e passa ao próximo."
}

function resultadoSecundario(p: Pendencia): string {
  const minutos = p.status === "novo"
    ? LIMIAR_NOVO_SEM_ACEITE_MIN
    : p.status === "em_preparo"
      ? LIMIAR_REAVISO_PREPARO_MIN
      : LIMIAR_REAVISO_ENTREGA_MIN
  return `→ Este pedido sai da vez e volta em ${minutos} min.`
}

export default function LimpezaOperacionalGate({ pedidos, onResolver, ativo = true }: Props) {
  const agora = useSyncExternalStore(assinarRelogio, lerRelogio, lerRelogioNoServidor)
  const [ocupado, setOcupado] = useState<BotaoOcupado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [suprimidoId, setSuprimidoId] = useState<string | null>(null)
  const [problemaParaId, setProblemaParaId] = useState<string | null>(null)
  const [motivoProblema, setMotivoProblema] = useState<MotivoProblemaEntrega | null>(null)

  const pendencias = useMemo(() => listarPendencias(pedidos, agora), [pedidos, agora])

  const pendenciasVisiveis = pendencias.filter((p) => p.pedidoId !== suprimidoId)
  const atual = pendenciasVisiveis[0]
  if (!ativo || !atual) return null

  const principal = acaoPrincipal(atual)
  const secundaria = acaoSecundaria(atual)
  const terciaria = acaoTerciaria(atual)
  const problemaAberto = problemaParaId === atual.pedidoId
  const ehDelivery = atual.modalidade === "delivery"
  const ehRetirada = atual.modalidade === "retirada"
  const ehLocal = atual.modalidade === "dine_in"
  const telefone = String(atual.telefone || "").replace(/\D/g, "")
  const telefoneValido = !atual.semTelefone && telefone.length >= 10
  const telefoneWhatsApp = telefone.startsWith("55") ? telefone : `55${telefone}`
  const contatoJaEnviado = atual.entregaProblema?.contatoStatus === "enviado"
  const motivoContato = ehRetirada ? MOTIVO_RETIRADA_ATRASADA : motivoProblema
  const mensagemPrevista = motivoContato ? mensagemProblemaEntrega(motivoContato, atual.cliente || "Cliente") : ""

  function suprimirAteAtualizar() {
    const id = atual.pedidoId
    setSuprimidoId(id)
    window.setTimeout(() => setSuprimidoId((corrente) => corrente === id ? null : corrente), 25_000)
  }

  async function resolver(opcao: OpcaoResolucao, qual: BotaoOcupado) {
    if (ocupado) return
    setOcupado(qual)
    setErro(null)
    try {
      await onResolver(atual, opcao)
      suprimirAteAtualizar()
    } catch {
      setErro("Não consegui registrar. Tente novamente.")
    } finally {
      setOcupado(null)
    }
  }

  async function executarEntrega(body: Record<string, unknown>) {
    if (ocupado) return false
    setOcupado("entrega")
    setErro(null)
    try {
      const resposta = await fetch("/api/orders/problema-entrega", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: atual.pedidoId, ...body }),
      })
      const dados = await resposta.json().catch(() => ({})) as { error?: string }
      if (!resposta.ok) {
        setErro(dados.error || "Não consegui salvar. Tente novamente.")
        return false
      }
      setProblemaParaId(null)
      setMotivoProblema(null)
      suprimirAteAtualizar()
      return true
    } catch {
      setErro("Sem conexão. Tente novamente.")
      return false
    } finally {
      setOcupado(null)
    }
  }

  async function adiarRota(contexto: "ainda_na_rua" | "cliente_respondeu" | "ainda_aguardando_retirada" | "ainda_aguardando_servir") {
    await executarEntrega({ acao: "adiar", contexto })
  }

  async function enviarProblema() {
    if (!motivoProblema) return
    await executarEntrega({ acao: "contatar", motivo: motivoProblema })
  }

  async function enviarLembreteRetirada() {
    await executarEntrega({ acao: "contatar", motivo: MOTIVO_RETIRADA_ATRASADA })
  }

  async function registrarSemContato() {
    const motivo = ehRetirada ? MOTIVO_RETIRADA_ATRASADA : motivoProblema
    if (!motivo) return
    await executarEntrega({ acao: "registrar_sem_contato", motivo })
  }

  async function cancelarPix() {
    await resolver({ label: "Cancelar por Pix não pago", acao: "cancelou", status: "cancelado", tom: "perigo" }, "terciaria")
  }

  const total = pendenciasVisiveis.length
  const numero = atual.numero != null ? `#${atual.numero}` : atual.pedidoId

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="limpeza-titulo" aria-describedby="limpeza-descricao" style={{ position:"fixed", inset:0, zIndex:3000, background:"rgba(var(--overlay-rgb), 0.78)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, fontFamily:"'Archivo', sans-serif" }}>
      <div style={{ width:"100%", maxWidth:500, maxHeight:"94dvh", overflowY:"auto", background:"var(--surface)", border:"1px solid var(--surface-secondary)", borderRadius:22, padding:20, boxSizing:"border-box", boxShadow:"0 28px 90px rgba(0,0,0,.45)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <p style={{ fontSize:11, fontWeight:900, letterSpacing:".7px", textTransform:"uppercase", color:"var(--attention-text)", margin:0 }}>⚠ Organização obrigatória</p>
          <p style={{ fontSize:11, fontWeight:800, color:"var(--foreground-muted)", margin:0 }}>{`1 de ${total}`}</p>
        </div>

        <h2 id="limpeza-titulo" style={{ fontSize:21, lineHeight:1.2, fontWeight:900, color:"var(--foreground)", margin:"10px 0 0" }}>
          {problemaAberto ? (ehRetirada ? "Avisar cliente" : "Resolver entrega") : atual.titulo}
        </h2>
        <p style={{ fontSize:13, fontWeight:800, color:"var(--foreground-secondary)", margin:"7px 0 0" }}>Pedido {numero}{atual.cliente ? ` · ${atual.cliente}` : ""} · há {atual.idadeMinutos} min</p>
        <p id="limpeza-descricao" style={{ fontSize:13.5, fontWeight:600, color:"var(--foreground-secondary)", lineHeight:1.45, margin:"10px 0 0" }}>
          {problemaAberto ? (ehRetirada ? "Avise o cliente e acompanhe." : "Escolha o problema e registre.") : instrucaoCurta(atual)}
        </p>

        {erro && <p role="status" aria-live="polite" style={{ fontSize:12.5, fontWeight:800, color:"var(--danger)", margin:"12px 0 0", lineHeight:1.45 }}>{erro}</p>}

        {problemaAberto && atual.motivo === "entrega_longa" ? (
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
            <button type="button" disabled={!!ocupado} onClick={() => { setProblemaParaId(null); setMotivoProblema(null); setErro(null) }} style={{ alignSelf:"flex-start", border:0, background:"transparent", color:"var(--foreground-secondary)", fontWeight:800 }}>← Voltar</button>
            {ehRetirada ? (
              <>
                <strong>Cliente ainda não retirou</strong>
                <p style={{ margin:0, fontSize:12, color:"var(--foreground-muted)" }}>Depois: revisar em {LIMIAR_REAVISO_ENTREGA_MIN} min.</p>
                {mensagemPrevista && <div style={{ border:"1px solid var(--surface-secondary)", borderRadius:12, padding:11, fontSize:12, lineHeight:1.45 }}>{mensagemPrevista}</div>}
                {!contatoJaEnviado && telefoneValido && <button disabled={!!ocupado} onClick={enviarLembreteRetirada} style={estiloPrincipal}>AVISAR CLIENTE</button>}
                {(contatoJaEnviado || !telefoneValido || !!erro) && <button disabled={!!ocupado} onClick={registrarSemContato} style={estiloSecundario}>{contatoJaEnviado ? "AINDA SEM RESPOSTA · REVER EM 5 MIN" : "REGISTRAR · REVER EM 5 MIN"}</button>}
              </>
            ) : (
              <>
                <strong>O que aconteceu?</strong>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:7 }}>
                  {MOTIVOS_PROBLEMA_ENTREGA.map((motivo) => <button key={motivo} disabled={!!ocupado} onClick={() => { setMotivoProblema(motivo); setErro(null) }} style={{ border: motivoProblema === motivo ? "2px solid var(--primary)" : "1px solid var(--surface-secondary)", background:"var(--background)", color:"var(--foreground-secondary)", borderRadius:10, padding:10, textAlign:"left", fontWeight:800 }}>{ROTULOS_PROBLEMA_ENTREGA[motivo]}</button>)}
                </div>
                {motivoProblema && <div style={{ border:"1px solid var(--surface-secondary)", borderRadius:12, padding:11, fontSize:12, lineHeight:1.45 }}>{mensagemPrevista}</div>}
                {motivoProblema && telefoneValido && !contatoJaEnviado && <button disabled={!!ocupado} onClick={enviarProblema} style={estiloPrincipal}>ENVIAR AO CLIENTE</button>}
                {motivoProblema && (!telefoneValido || !!erro || contatoJaEnviado) && <button disabled={!!ocupado} onClick={registrarSemContato} style={estiloSecundario}>REGISTRAR · REVER EM 5 MIN</button>}
              </>
            )}
            {telefoneValido && (contatoJaEnviado || !!erro) && <div style={{ display:"flex", gap:8 }}><a href={`https://wa.me/${telefoneWhatsApp}`} target="_blank" rel="noreferrer">WhatsApp</a><a href={`tel:+${telefoneWhatsApp}`}>Ligar</a></div>}
          </div>
        ) : atual.motivo === "pagamento_pix_pendente" ? (
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
            <div style={estiloBlocoAcao}>
              <button autoFocus disabled={!!ocupado} onClick={() => resolver(principal, "principal")} style={estiloPrincipal}>{ocupado === "principal" ? "CONFERINDO…" : "VERIFICAR PIX AGORA"}</button>
              <small style={estiloResultado}>{resultadoPrincipal(atual)}</small>
            </div>
            <div style={estiloBlocoAcao}>
              <button disabled={!!ocupado} onClick={cancelarPix} style={estiloPerigo}>Cancelar por Pix não pago</button>
              <small style={estiloResultado}>→ Cancela o pedido e passa ao próximo.</small>
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
            <div style={estiloBlocoAcao}>
              <button autoFocus disabled={!!ocupado} onClick={() => resolver(principal, "principal")} style={estiloPrincipal}>{ocupado === "principal" ? "REGISTRANDO…" : principal.label}</button>
              <small style={estiloResultado}>{resultadoPrincipal(atual)}</small>
            </div>

            {secundaria && atual.motivo === "entrega_longa" ? (
              <div style={estiloBlocoAcao}>
                <button disabled={!!ocupado} onClick={() => adiarRota(ehRetirada ? "ainda_aguardando_retirada" : ehLocal ? "ainda_aguardando_servir" : "ainda_na_rua")} style={estiloSecundario}>{ocupado === "entrega" ? "REGISTRANDO…" : secundaria.label}</button>
                <small style={estiloResultado}>{resultadoSecundario(atual)}</small>
              </div>
            ) : secundaria ? (
              <div style={estiloBlocoAcao}>
                <button disabled={!!ocupado} onClick={() => resolver(secundaria, "secundaria")} style={estiloSecundario}>{ocupado === "secundaria" ? "REGISTRANDO…" : secundaria.label}</button>
                <small style={estiloResultado}>{resultadoSecundario(atual)}</small>
              </div>
            ) : null}

            {atual.motivo === "entrega_longa" && contatoJaEnviado && (ehDelivery ? atual.exigirProblema : ehRetirada && atual.tentativasAdiamento >= 2) && (
              <div style={estiloBlocoAcao}>
                <button disabled={!!ocupado} onClick={() => adiarRota("cliente_respondeu")} style={estiloSecundario}>{ehRetirada ? "CLIENTE ESTÁ A CAMINHO · DAR 5 MIN" : "CLIENTE RESPONDEU · DAR 5 MIN"}</button>
                <small style={estiloResultado}>→ Este pedido sai da vez e volta em {LIMIAR_REAVISO_ENTREGA_MIN} min.</small>
              </div>
            )}

            {atual.motivo === "entrega_longa" && atual.podeRelatarProblema && (
              <button disabled={!!ocupado} onClick={() => { setProblemaParaId(atual.pedidoId); setMotivoProblema(atual.entregaProblema?.motivo ?? null); setErro(null) }} style={estiloProblema}>⚠ {contatoJaEnviado ? "REVISAR PROBLEMA" : "PROBLEMA NA ENTREGA"}</button>
            )}

            {atual.motivo === "entrega_longa" && ehRetirada && atual.tentativasAdiamento >= 1 && (
              <button disabled={!!ocupado} onClick={() => { setProblemaParaId(atual.pedidoId); setMotivoProblema(null); setErro(null) }} style={estiloProblema}>{contatoJaEnviado ? "REVISAR CONTATO" : "AVISAR CLIENTE"}</button>
            )}

            {terciaria && (
              <div style={estiloBlocoAcao}>
                <button disabled={!!ocupado} onClick={() => resolver(terciaria, "terciaria")} style={estiloPerigo}>{ocupado === "terciaria" ? "REGISTRANDO…" : terciaria.label}</button>
                <small style={estiloResultado}>→ Cancela o pedido e passa ao próximo.</small>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const estiloBlocoAcao = { display:"flex", flexDirection:"column", gap:4 } as const
const estiloPrincipal = { minHeight:54, border:"none", borderRadius:13, padding:"12px 14px", background:"var(--primary)", color:"var(--primary-foreground)", fontSize:14, fontWeight:900, cursor:"pointer" } as const
const estiloSecundario = { minHeight:48, border:"1px solid var(--surface-secondary)", borderRadius:12, padding:"11px 13px", background:"transparent", color:"var(--foreground-secondary)", fontSize:13, fontWeight:800, cursor:"pointer" } as const
const estiloPerigo = { minHeight:44, border:"1px solid color-mix(in srgb,var(--danger) 45%,var(--surface-secondary))", borderRadius:12, padding:"10px 13px", background:"color-mix(in srgb,var(--danger) 8%,var(--surface))", color:"var(--danger)", fontSize:13, fontWeight:800, cursor:"pointer" } as const
const estiloProblema = { minHeight:46, border:"1px solid var(--attention-border)", borderRadius:12, padding:"10px 13px", background:"var(--attention-surface)", color:"var(--attention-text)", fontSize:13, fontWeight:800, cursor:"pointer" } as const
const estiloResultado = { color:"var(--foreground-muted)", fontSize:10.5, lineHeight:1.3, padding:"0 4px" } as const
