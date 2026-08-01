"use client"

// Montagem manual de pedido no painel — apresentação.
//
// Toda a regra (catálogo pesquisável, etapas obrigatórias, motivo de bloqueio,
// construção e preço do item, pendências) vive em src/lib/montagemManual.ts,
// testável sem montar componente. Aqui só existe navegação e formulário.
//
// O pedido é criado por POST /api/pedido-app — a MESMA rota do cardápio
// público, com a mesma validação, o mesmo recálculo de preço no servidor e a
// mesma idempotência do Modo Sobrevivência. Não há rota nem motor de pedido
// paralelo: o pedido cai no painel como qualquer outro e imprime no aceite,
// pelas regras que já existem.
//
// A navegação é em passos curtos de propósito. Um modal único com tudo é
// exatamente o que faz o atendente se perder no meio de uma ligação.

import { useEffect, useMemo, useRef, useState } from "react"
import type { ItemApp } from "@/lib/pedidoAppItens"
import { computeTaxaApp } from "@/lib/pedidoAppLogic"
import { montarPagamentoComposto, extrairPagamentoComposto } from "@/lib/pagamentoComposto"
import { gerarClientRequestId } from "@/survival/clientRequestId"
import {
  CATEGORIAS,
  listarProdutosManuais,
  buscarProdutos,
  montarEtapas,
  etapaSatisfeita,
  indiceEtapaPendente,
  montagemCompleta,
  motivoBloqueio,
  resumoEtapa,
  alternarSabor,
  construirItemManual,
  calcularTotalManual,
  adicionarAoCarrinho,
  alterarQuantidade,
  removerItem,
  pendenciasDoPedido,
  pendenciaIdentificadorTentativa,
  selecaoVazia,
  type CategoriaManual,
  type MenuManual,
  type ProdutoManual,
  type SelecaoMontagem,
  type DadosPedidoManual,
} from "@/lib/montagemManual"

type Passo = "cliente" | "produtos" | "entrega" | "pagamento" | "revisar"

const PASSOS: { id: Passo; label: string }[] = [
  { id: "cliente", label: "Cliente" },
  { id: "produtos", label: "Produtos" },
  { id: "entrega", label: "Entrega" },
  { id: "pagamento", label: "Pagamento" },
  { id: "revisar", label: "Revisar" },
]

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",")

type Props = {
  /** Cardápio JÁ validado pelo adaptador — a tela nunca recebe resposta crua. */
  menu: MenuManual
  onFechar: () => void
  /** Chamado após o pedido ser criado, para o painel recarregar a lista. */
  onCriado: (pedidoId: string) => void
}

// --- estilos compartilhados (mesma linguagem visual do painel) --------------
const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--surface-secondary)",
  borderRadius: 14,
  padding: 14,
}
const input: React.CSSProperties = {
  width: "100%",
  height: 44,
  background: "var(--background)",
  border: "1px solid var(--surface-secondary)",
  borderRadius: 10,
  padding: "0 12px",
  color: "var(--foreground)",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "'Archivo', sans-serif",
  outline: "none",
  boxSizing: "border-box",
}
const btn: React.CSSProperties = {
  height: 46,
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "'Archivo', sans-serif",
}
const rotulo: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: ".5px",
  textTransform: "uppercase",
  color: "var(--foreground-muted)",
  margin: "0 0 6px",
}

// Ícone oficial do WhatsApp (verde de marca do próprio WhatsApp, não da
// pizzaria) — usado só para identificar visualmente o canal do cliente
// reconhecido, nunca como cor de destaque geral da tela.
function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#25d366" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.42-1.42a9.87 9.87 0 004.62 1.18h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.3-1.93 1.35-.5.05-.99.24-3.32-.69-2.81-1.12-4.62-3.99-4.76-4.18-.14-.19-1.14-1.52-1.14-2.9 0-1.38.72-2.06.98-2.34.26-.28.56-.35.75-.35.19 0 .38 0 .54.01.18.01.41-.07.64.49.24.58.81 2 .88 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.47-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.28.37-.23.63-.14.26.09 1.66.78 1.94.93.28.14.47.21.54.33.07.12.07.68-.17 1.36z" />
    </svg>
  )
}

export default function NovoPedidoManual({ menu, onFechar, onCriado }: Props) {
  const [passo, setPasso] = useState<Passo>("cliente")
  const [confirmarSaida, setConfirmarSaida] = useState(false)
  // Confirmado (telefone reconhecido) esconde o campo de nome atrás de um
  // card compacto; o lápis abre esta edição explícita sem apagar o nome.
  // Guarda PARA QUAL telefone a edição foi pedida — assim um telefone novo
  // volta a mostrar o card automaticamente, sem precisar de um efeito extra
  // só para "resetar" o estado a cada tecla digitada.
  const [editarNomeParaTelefone, setEditarNomeParaTelefone] = useState<string | null>(null)

  // --- catálogo e busca ----------------------------------------------------
  // Recalculado só quando o cardápio muda, não a cada tecla digitada.
  const produtos = useMemo(() => listarProdutosManuais(menu), [menu])
  const [categoria, setCategoria] = useState<CategoriaManual>("pizza")
  const [termo, setTermo] = useState("")
  const buscando = termo.trim().length > 0
  // Com termo, a busca varre TODAS as categorias e substitui a navegação por
  // abas; ao limpar, o atendente volta exatamente para a categoria em que
  // estava. A categoria nunca é perdida pela busca.
  const resultados = useMemo(
    () => buscarProdutos(produtos, termo, buscando ? "todas" : categoria),
    [produtos, termo, buscando, categoria]
  )

  // --- montagem guiada -----------------------------------------------------
  const [produtoAberto, setProdutoAberto] = useState<ProdutoManual | null>(null)
  const [selecao, setSelecao] = useState<SelecaoMontagem>(selecaoVazia())
  const [etapaVisivel, setEtapaVisivel] = useState(0)
  const etapas = useMemo(
    () => (produtoAberto ? montarEtapas(produtoAberto, menu) : []),
    [produtoAberto, menu]
  )
  const etapaAtual = etapas[etapaVisivel]
  const bloqueio = motivoBloqueio(etapaAtual, selecao)
  const completa = montagemCompleta(etapas, selecao)

  // --- carrinho ------------------------------------------------------------
  const [itens, setItens] = useState<ItemApp[]>([])
  const adicionandoRef = useRef(false)

  // --- dados do pedido -----------------------------------------------------
  const [cliente, setCliente] = useState("")
  const [telefone, setTelefone] = useState("")
  // "Sem número de telefone": opção explícita, nunca inferida de um campo
  // vazio. Só o painel oferece isso — o cardápio público sempre exige
  // telefone. O backend só aceita o pedido sem telefone quando esta flag
  // vier junto de uma sessão administrativa real (ver semTelefonePainel em
  // POST /api/pedido-app).
  const [semTelefone, setSemTelefone] = useState(false)
  // Dígitos do telefone para o qual a última busca encontrou um cliente —
  // nunca um booleano solto: comparar contra o telefone atual é o que evita
  // mostrar "reconhecido" para um número diferente do que está no campo.
  const [telefoneReconhecido, setTelefoneReconhecido] = useState<string | null>(null)
  const [buscandoTelefone, setBuscandoTelefone] = useState(false)
  const [tipoEntrega, setTipoEntrega] = useState<"delivery" | "retirada" | "dine_in">("delivery")
  const [bairro, setBairro] = useState("")
  const [rua, setRua] = useState("")
  const [numero, setNumero] = useState("")
  const [referencia, setReferencia] = useState("")
  const [observacao, setObservacao] = useState("")

  // --- pagamento -----------------------------------------------------------
  const [pagamento, setPagamento] = useState("")
  const [mistoPix, setMistoPix] = useState("")
  const [mistoDinheiro, setMistoDinheiro] = useState("")
  const [trocoOpcao, setTrocoOpcao] = useState<"sim" | "nao" | null>(null)
  const [troco, setTroco] = useState("")

  // --- envio ---------------------------------------------------------------
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  // Gerado UMA vez por tentativa de pedido (inicializador preguiçoso: roda uma
  // única vez, mesmo sob StrictMode) e reaproveitado em qualquer retry — é o
  // que impede que uma falha de rede vire pedido duplicado. `null` quando o
  // navegador não tem fonte criptográfica (gerarClientRequestId lança): o
  // servidor EXIGE este identificador para sessão administrativa (nunca é
  // opcional aqui, diferente do cardápio público), então sem ele o pedido não
  // pode ser enviado — ver `identificadorTentativaFalhou` abaixo.
  const [clientRequestId] = useState<string | null>(() => {
    try {
      return gerarClientRequestId()
    } catch {
      return null
    }
  })
  const identificadorTentativaFalhou = clientRequestId === null

  const taxa = useMemo(
    () => computeTaxaApp(tipoEntrega, bairro, menu.neighborhoods || []),
    [tipoEntrega, bairro, menu.neighborhoods]
  )
  const totais = useMemo(() => calcularTotalManual(itens, menu, taxa), [itens, menu, taxa])

  const compostoAtual = useMemo(
    () => (pagamento === "Misto" ? montarPagamentoComposto(mistoPix, mistoDinheiro, totais.total) : null),
    [pagamento, mistoPix, mistoDinheiro, totais.total]
  )
  // A string canônica do pagamento misto vem do módulo central (PR #253) —
  // esta tela nunca a monta por conta própria.
  const pagamentoFinal = pagamento === "Misto" ? (compostoAtual?.ok ? compostoAtual.valor : "") : pagamento
  const temDinheiro = /dinheiro/i.test(pagamentoFinal)

  const dados: DadosPedidoManual = {
    cliente,
    telefone,
    semTelefone,
    tipoEntrega,
    bairro: tipoEntrega === "delivery" ? bairro : undefined,
    rua: tipoEntrega === "delivery" ? rua : undefined,
    numero: tipoEntrega === "delivery" ? numero : undefined,
    referencia: tipoEntrega === "delivery" ? referencia : undefined,
    observacao,
    pagamento: pagamentoFinal,
    troco: temDinheiro ? (trocoOpcao === "nao" ? "Sem troco" : troco.trim()) : undefined,
  }
  // A ausência do identificador de tentativa entra na MESMA lista de
  // pendências que bloqueia o envio — é o mesmo padrão visual de "o que falta
  // para enviar" que o atendente já reconhece, e garante que o botão de
  // enviar nunca fica habilitado sem proteção de idempotência. A mensagem e a
  // decisão vêm de pendenciaIdentificadorTentativa (src/lib/montagemManual.ts),
  // testável sem montar este componente.
  const pendenciaIdentificador = pendenciaIdentificadorTentativa(!identificadorTentativaFalhou)
  const pendencias = [
    ...(pendenciaIdentificador ? [pendenciaIdentificador] : []),
    ...pendenciasDoPedido(dados, itens),
  ]

  // Fechar com Esc passa pela mesma confirmação do botão de fechar: nunca
  // perder um pedido inteiro por um toque acidental.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (produtoAberto) setProdutoAberto(null)
      else tentarSair()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  // Busca administrativa por telefone, com debounce — reconhece o cliente
  // enquanto a atendente digita, sem disparar uma requisição por tecla.
  // Nunca sobrescreve um nome já digitado: só sugere quando o campo nome
  // ainda está vazio no momento em que a resposta chega. Nenhum setState
  // roda de forma síncrona no corpo do efeito — só dentro do timeout/fetch,
  // que são callbacks assíncronos.
  useEffect(() => {
    if (semTelefone) return
    const digitos = telefone.replace(/\D/g, "")
    if (digitos.length < 10) return
    let cancelado = false
    const t = window.setTimeout(async () => {
      setBuscandoTelefone(true)
      try {
        const r = await fetch(`/api/admin/clientes/buscar-telefone?telefone=${encodeURIComponent(digitos)}`)
        const data = await r.json().catch(() => null)
        if (cancelado) return
        if (data?.ok && data.encontrado && data.nome) {
          setTelefoneReconhecido(digitos)
          setCliente((atual) => (atual.trim() ? atual : data.nome))
        } else {
          setTelefoneReconhecido((atual) => (atual === digitos ? null : atual))
        }
      } catch {
        // falha de rede: mantém o último reconhecimento válido, não apaga
        // um cliente já encontrado por causa de uma tentativa futura falha.
      } finally {
        if (!cancelado) setBuscandoTelefone(false)
      }
    }, 500)
    return () => {
      cancelado = true
      window.clearTimeout(t)
    }
  }, [telefone, semTelefone])

  function tentarSair() {
    if (itens.length === 0 && !cliente.trim() && !telefone.trim()) onFechar()
    else setConfirmarSaida(true)
  }

  function abrirProduto(produto: ProdutoManual) {
    if (produto.esgotado) return
    if (!produto.requerMontagem) {
      adicionarDireto(produto)
      return
    }
    setProdutoAberto(produto)
    setSelecao(selecaoVazia())
    setEtapaVisivel(0)
    // Sair da busca já na categoria do produto escolhido: ao limpar o termo o
    // atendente está no contexto certo, não de volta no começo.
    setCategoria(produto.categoria)
  }

  function adicionarDireto(produto: ProdutoManual) {
    // Guarda dentro do mesmo tick, antes de qualquer re-render: é a defesa de
    // UI contra duplo toque. A defesa de servidor é o clientRequestId.
    if (adicionandoRef.current) return
    adicionandoRef.current = true
    const item = construirItemManual(produto, selecaoVazia(), menu)
    if (item) setItens((atual) => adicionarAoCarrinho(atual, item))
    window.setTimeout(() => { adicionandoRef.current = false }, 400)
  }

  function confirmarMontagem() {
    if (!produtoAberto || !completa) return
    if (adicionandoRef.current) return
    adicionandoRef.current = true
    const item = construirItemManual(produtoAberto, selecao, menu)
    if (item) setItens((atual) => adicionarAoCarrinho(atual, item))
    setProdutoAberto(null)
    setTermo("")
    window.setTimeout(() => { adicionandoRef.current = false }, 400)
  }

  function avancarEtapa() {
    if (!etapaAtual || !etapaSatisfeita(etapaAtual, selecao)) return
    if (etapaVisivel < etapas.length - 1) setEtapaVisivel(etapaVisivel + 1)
  }

  function voltarEtapa() {
    // Recua uma etapa por vez sem tocar na seleção; na primeira, fecha o
    // construtor. Nunca há um "voltar" que descarte escolhas silenciosamente.
    if (etapaVisivel > 0) setEtapaVisivel(etapaVisivel - 1)
    else setProdutoAberto(null)
  }

  function escolher(valor: string) {
    if (!etapaAtual) return
    if (etapaAtual.tipo === "sabores" || etapaAtual.tipo === "sabor_unico") {
      setSelecao((s) => alternarSabor(s, valor, etapaAtual.maxEscolhas))
    } else if (etapaAtual.tipo === "borda") {
      setSelecao((s) => ({ ...s, borda: valor === "" ? null : valor }))
    } else if (etapaAtual.tipo === "tamanho_item") {
      setSelecao((s) => ({ ...s, tamanhoItem: valor }))
    } else if (etapaAtual.tipo === "leite") {
      setSelecao((s) => ({ ...s, leite: valor === "com" ? "com" : "sem" }))
    }
  }

  function estaEscolhida(valor: string): boolean {
    if (!etapaAtual) return false
    switch (etapaAtual.tipo) {
      case "sabores":
      case "sabor_unico":
        return selecao.sabores.includes(valor)
      case "borda":
        return valor === "" ? selecao.borda === null : selecao.borda === valor
      case "tamanho_item":
        return selecao.tamanhoItem === valor
      case "leite":
        return selecao.leite === valor
      default:
        return false
    }
  }

  async function enviar() {
    // Dupla guarda: `pendencias.length > 0` já cobre isso (o item entra na
    // lista acima), mas o identificador nunca pode ser enviado ausente —
    // mesmo que a lista de pendências mude no futuro, esta linha continua
    // impedindo o envio sem proteção.
    if (enviando || pendencias.length > 0 || identificadorTentativaFalhou) return
    setEnviando(true)
    setErroEnvio(null)
    try {
      const r = await fetch("/api/pedido-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente: cliente.trim(),
          telefone: semTelefone ? "" : telefone.trim(),
          ...(semTelefone ? { semTelefonePainel: true } : {}),
          usarOutroWhatsapp: true,
          // Preço nunca é confiado: o servidor recalcula item a item.
          itens: itens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty })),
          tipoEntrega,
          ...(tipoEntrega === "delivery"
            ? { bairro, rua, numero: numero.trim() || undefined, referencia: referencia.trim() || undefined }
            : {}),
          observacao: observacao.trim() || undefined,
          pagamento: pagamentoFinal,
          ...(dados.troco ? { troco: dados.troco } : {}),
          ...(clientRequestId ? { clientRequestId } : {}),
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) {
        // O mesmo clientRequestId é preservado de propósito: tentar de novo
        // reaproveita a tentativa, nunca cria um segundo pedido.
        setErroEnvio(data?.error || "Não consegui criar o pedido agora. Tente de novo.")
        setEnviando(false)
        return
      }
      onCriado(String(data.pedidoId ?? ""))
    } catch {
      // Falha de rede NÃO prova que o pedido não foi criado: a requisição pode
      // ter chegado e só a resposta ter se perdido. Dizer "não foi criado"
      // seria mentira e levaria a um pedido duplicado. A instrução honesta é
      // conferir a lista antes de repetir.
      setErroEnvio("Não recebi a confirmação do servidor. Confira se o pedido já apareceu na lista antes de tentar de novo.")
      setEnviando(false)
    }
  }

  const clienteReconhecido = !semTelefone && telefone.replace(/\D/g, "") === telefoneReconhecido && !!telefoneReconhecido
  const editandoNome = editarNomeParaTelefone !== null && editarNomeParaTelefone === telefone

  // --- validade por etapa (bloqueia avanço; nunca bloqueia voltar) ---------
  const clienteValido = !!cliente.trim() && (semTelefone || telefone.replace(/\D/g, "").length >= 10)
  const produtosValido = itens.length > 0
  const entregaValida =
    tipoEntrega !== "delivery" || (!!bairro.trim() && !!rua.trim() && !!numero.trim())
  const pagamentoValido =
    !!pagamentoFinal.trim() && (!temDinheiro || (trocoOpcao === "nao" || !!troco.trim()))
  const validoPorIndice = [clienteValido, produtosValido, entregaValida, pagamentoValido, true]
  // Primeira etapa ainda incompleta: até ali (inclusive) é alcançável — dá
  // para clicar de volta em qualquer etapa já visitada, ou avançar até a
  // etapa que falta completar, nunca pular além dela.
  const indiceAlcancavel = (() => {
    let i = 0
    while (i < validoPorIndice.length && validoPorIndice[i]) i++
    return Math.min(i, PASSOS.length - 1)
  })()
  const indicePassoAtual = PASSOS.findIndex((p) => p.id === passo)

  function irParaPasso(destino: Passo) {
    const indiceDestino = PASSOS.findIndex((p) => p.id === destino)
    if (indiceDestino <= indiceAlcancavel) setPasso(destino)
  }

  const podeIrParaEntrega = produtosValido
  const bairros = menu.neighborhoods || []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Novo pedido manual"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2800,
        background: "rgba(var(--overlay-rgb), 0.6)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        fontFamily: "'Archivo', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "94svh",
          background: "var(--background)",
          borderRadius: "18px 18px 0 0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Cabeçalho: onde estou, e como saio */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--surface)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: "var(--foreground)" }}>Novo pedido</span>
            <button
              onClick={tentarSair}
              aria-label="Fechar"
              style={{ background: "none", border: "none", color: "var(--foreground-muted)", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4 }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {PASSOS.map((p, i) => {
              const ativo = p.id === passo
              const concluido = i < indicePassoAtual
              const alcancavel = i <= indiceAlcancavel
              return (
                <button
                  key={p.id}
                  onClick={() => irParaPasso(p.id)}
                  disabled={!alcancavel}
                  aria-current={ativo ? "step" : undefined}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: 8,
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: 900,
                    border: "none",
                    fontFamily: "'Archivo', sans-serif",
                    cursor: alcancavel ? "pointer" : "not-allowed",
                    background: ativo ? "var(--primary)" : concluido ? "color-mix(in srgb, var(--success) 15%, transparent)" : "var(--surface)",
                    color: ativo ? "var(--background)" : concluido ? "var(--success)" : "var(--foreground-muted)",
                    opacity: alcancavel ? 1 : 0.5,
                  }}
                >
                  {i + 1}. {p.label}{concluido ? " ✓" : ""}
                </button>
              )
            })}
          </div>
        </div>

        {/* Corpo */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {passo === "cliente" && (
            <>
              <div style={{ ...card, display: "grid", gap: 10 }}>
                <p style={rotulo}>Telefone</p>
                <input
                  style={input}
                  placeholder="Telefone com DDD"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  inputMode="tel"
                  disabled={semTelefone}
                  autoFocus
                />
                {buscandoTelefone && (
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)", margin: 0 }}>Buscando cliente…</p>
                )}
                {clienteReconhecido && !buscandoTelefone && (
                  <p role="status" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--success)", margin: 0 }}>
                    <WhatsAppIcon />
                    ✓ Cliente reconhecido
                  </p>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--foreground-secondary)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={semTelefone}
                    onChange={(e) => setSemTelefone(e.target.checked)}
                  />
                  Sem número de telefone
                </label>
              </div>

              {/* Cliente reconhecido: card compacto com lápis, sem reexibir o
                  campo de nome — evita reescrever por cima de um cadastro já
                  confirmado. Cliente novo, sem telefone, ou edição explícita
                  (lápis) continuam mostrando o campo normal. */}
              {clienteReconhecido && !editandoNome ? (
                <div style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                  <WhatsAppIcon />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={rotulo}>Nome do cliente</p>
                    <p style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)", margin: 0 }}>{cliente || "—"}</p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground-secondary)", margin: "2px 0 0" }}>{telefone}</p>
                  </div>
                  <button
                    onClick={() => setEditarNomeParaTelefone(telefone)}
                    aria-label="Editar nome do cliente"
                    style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 17, cursor: "pointer", padding: 4, flexShrink: 0 }}
                  >
                    ✎
                  </button>
                </div>
              ) : (
                <div style={{ ...card, display: "grid", gap: 10 }}>
                  <p style={rotulo}>Nome do cliente</p>
                  <input style={input} placeholder="Nome do cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
                </div>
              )}
            </>
          )}

          {passo === "produtos" && (
            <>
              <div style={{ position: "relative" }}>
                <input
                  style={input}
                  placeholder="Buscar produto em todas as categorias…"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  aria-label="Buscar produto"
                />
                {termo && (
                  <button
                    onClick={() => setTermo("")}
                    aria-label="Limpar busca"
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--foreground-muted)", fontSize: 18, cursor: "pointer" }}
                  >
                    ×
                  </button>
                )}
              </div>

              {!buscando && (
                <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                  {CATEGORIAS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCategoria(c.id)}
                      style={{
                        ...btn,
                        height: 34,
                        padding: "0 12px",
                        flexShrink: 0,
                        border: "1px solid " + (categoria === c.id ? "var(--primary)" : "var(--surface-secondary)"),
                        background: categoria === c.id ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent",
                        color: "var(--foreground)",
                        fontSize: 12.5,
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}

              {buscando && (
                <p aria-live="polite" style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)", margin: 0 }}>
                  {resultados.length === 0
                    ? "Nenhum produto encontrado."
                    : `${resultados.length} resultado${resultados.length > 1 ? "s" : ""} em todas as categorias`}
                </p>
              )}

              {resultados.length === 0 && !buscando && (
                <p style={{ fontSize: 13, color: "var(--foreground-muted)", margin: 0 }}>Nenhum produto nesta categoria.</p>
              )}

              <div style={{ display: "grid", gap: 8 }}>
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => abrirProduto(p)}
                    disabled={p.esgotado}
                    style={{
                      ...card,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      textAlign: "left",
                      cursor: p.esgotado ? "not-allowed" : "pointer",
                      opacity: p.esgotado ? 0.5 : 1,
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{p.nome}</span>
                      <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--foreground-muted)", marginTop: 2 }}>
                        {p.esgotado ? "Esgotado" : buscando ? p.categoriaLabel : p.requerMontagem ? "Precisa escolher opções" : "Adiciona direto"}
                      </span>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: "var(--brand-text)", flexShrink: 0 }}>
                      {p.precoBase === null ? "" : (p.requerMontagem && p.categoria === "pizza" ? "a partir de " : "") + money(p.precoBase)}
                    </span>
                  </button>
                ))}
              </div>

              {itens.length > 0 && (
                <div style={{ ...card, display: "grid", gap: 8 }}>
                  <p style={rotulo}>No pedido ({itens.length})</p>
                  {itens.map((item, i) => (
                    <div key={`${item.name}-${item.detail}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "var(--foreground)" }}>{item.name}</span>
                        {item.detail && (
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--foreground-secondary)" }}>{item.detail}</span>
                        )}
                        <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--brand-text)", marginTop: 2 }}>{money(item.price * item.qty)}</span>
                      </span>
                      <button onClick={() => setItens(alterarQuantidade(itens, i, -1))} aria-label={`Diminuir ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>−</button>
                      <span style={{ fontSize: 13, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{item.qty}</span>
                      <button onClick={() => setItens(alterarQuantidade(itens, i, 1))} aria-label={`Aumentar ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>+</button>
                      <button onClick={() => setItens(removerItem(itens, i))} aria-label={`Remover ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "none", background: "transparent", color: "var(--danger)" }}>×</button>
                    </div>
                  ))}
                  {totais.itensInvalidos > 0 && (
                    <p role="status" aria-live="polite" style={{ fontSize: 12, fontWeight: 700, color: "var(--attention-text)", margin: 0 }}>
                      {totais.itensInvalidos} item(ns) saíram do cardápio e não entram no total. Remova antes de enviar.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {passo === "entrega" && (
            <>
              <div style={{ ...card, display: "grid", gap: 10 }}>
                <p style={rotulo}>Como o cliente recebe</p>
                <div style={{ display: "flex", gap: 6 }}>
                  {([["delivery", "Entrega"], ["retirada", "Retirada"], ["dine_in", "No local"]] as const).map(([valor, label]) => (
                    <button
                      key={valor}
                      onClick={() => setTipoEntrega(valor)}
                      style={{
                        ...btn,
                        flex: 1,
                        height: 40,
                        border: "1px solid " + (tipoEntrega === valor ? "var(--primary)" : "var(--surface-secondary)"),
                        background: tipoEntrega === valor ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent",
                        color: "var(--foreground)",
                        fontSize: 13,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tipoEntrega === "delivery" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <select style={input} value={bairro} onChange={(e) => setBairro(e.target.value)} aria-label="Bairro">
                      <option value="">Selecione o bairro</option>
                      {bairros.map((b, i) => (
                        <option key={i} value={b.name}>{b.name} — {money(b.fee)}</option>
                      ))}
                    </select>
                    <input style={input} placeholder="Rua" value={rua} onChange={(e) => setRua(e.target.value)} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <input style={{ ...input, flex: 1 }} placeholder="Número" value={numero} onChange={(e) => setNumero(e.target.value)} />
                      <button
                        onClick={() => setNumero((n) => (n.trim().toUpperCase() === "S/N" ? "" : "S/N"))}
                        style={{
                          ...btn,
                          height: 44,
                          padding: "0 14px",
                          border: "1px solid " + (numero.trim().toUpperCase() === "S/N" ? "var(--primary)" : "var(--surface-secondary)"),
                          background: numero.trim().toUpperCase() === "S/N" ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent",
                          color: "var(--foreground)",
                          fontSize: 13,
                        }}
                      >
                        S/N
                      </button>
                    </div>
                    <input style={input} placeholder="Complemento / referência" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                  </div>
                )}
              </div>

              <div style={{ ...card }}>
                <p style={rotulo}>Observação</p>
                <textarea
                  style={{ ...input, height: 68, padding: "10px 12px", resize: "vertical" }}
                  placeholder="Sem cebola, bem passado…"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            </>
          )}

          {passo === "pagamento" && (
            <>
              <div style={{ ...card, display: "grid", gap: 10 }}>
                <p style={rotulo}>Forma de pagamento</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[...(menu.payments || []), "Misto"].map((p) => {
                    const ativo = pagamento === p || (p === "Misto" && !!extrairPagamentoComposto(pagamento))
                    return (
                      <button
                        key={p}
                        onClick={() => setPagamento(p)}
                        style={{
                          ...btn,
                          height: 40,
                          padding: "0 14px",
                          border: "1px solid " + (ativo ? "var(--primary)" : "var(--surface-secondary)"),
                          background: ativo ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent",
                          color: "var(--foreground)",
                          fontSize: 13,
                        }}
                      >
                        {p === "Cartao" ? "Cartão" : p === "Misto" ? "Pagamento misto" : p}
                      </button>
                    )
                  })}
                </div>

                {pagamento === "Misto" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input style={input} placeholder="Valor no Pix" value={mistoPix} onChange={(e) => setMistoPix(e.target.value)} inputMode="decimal" />
                      <input style={input} placeholder="Valor em dinheiro" value={mistoDinheiro} onChange={(e) => setMistoDinheiro(e.target.value)} inputMode="decimal" />
                    </div>
                    {compostoAtual && !compostoAtual.ok && (
                      <p role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: 0 }}>
                        {compostoAtual.erro}
                      </p>
                    )}
                  </div>
                )}

                {temDinheiro && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setTrocoOpcao("nao")} style={{ ...btn, flex: 1, height: 40, fontSize: 13, border: "1px solid " + (trocoOpcao === "nao" ? "var(--primary)" : "var(--surface-secondary)"), background: "transparent", color: "var(--foreground)" }}>Sem troco</button>
                      <button onClick={() => setTrocoOpcao("sim")} style={{ ...btn, flex: 1, height: 40, fontSize: 13, border: "1px solid " + (trocoOpcao === "sim" ? "var(--primary)" : "var(--surface-secondary)"), background: "transparent", color: "var(--foreground)" }}>Precisa de troco</button>
                    </div>
                    {trocoOpcao === "sim" && (
                      <input style={input} placeholder="Troco para quanto?" value={troco} onChange={(e) => setTroco(e.target.value)} inputMode="decimal" />
                    )}
                  </div>
                )}
              </div>

            </>
          )}

          {passo === "revisar" && (
            <>
              <div style={{ ...card, display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p style={{ ...rotulo, margin: 0 }}>Cliente</p>
                  <button onClick={() => irParaPasso("cliente")} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Editar ✎</button>
                </div>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>{cliente || "—"}</p>
                <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>
                  {semTelefone ? "Sem número de telefone" : telefone || "—"}
                </p>
              </div>

              <div style={{ ...card, display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p style={{ ...rotulo, margin: 0 }}>Produtos ({itens.length})</p>
                  <button onClick={() => irParaPasso("produtos")} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Editar ✎</button>
                </div>
                {itens.map((item, i) => (
                  <div key={`${item.name}-${item.detail}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
                    <span style={{ color: "var(--foreground)", fontWeight: 700 }}>{item.qty}× {item.name}</span>
                    <span style={{ color: "var(--foreground-secondary)" }}>{money(item.price * item.qty)}</span>
                  </div>
                ))}
              </div>

              <div style={{ ...card, display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p style={{ ...rotulo, margin: 0 }}>Entrega</p>
                  <button onClick={() => irParaPasso("entrega")} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Editar ✎</button>
                </div>
                <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>
                  {tipoEntrega === "delivery" ? `${rua}, ${numero} — ${bairro}` : tipoEntrega === "retirada" ? "Retirada no balcão" : "Consumo no local"}
                </p>
              </div>

              <div style={{ ...card, display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p style={{ ...rotulo, margin: 0 }}>Pagamento</p>
                  <button onClick={() => irParaPasso("pagamento")} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Editar ✎</button>
                </div>
                <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>{pagamentoFinal || "—"}</p>
              </div>

              <div style={{ ...card, display: "grid", gap: 4 }}>
                <p style={rotulo}>Resumo</p>
                <Linha label="Subtotal" valor={money(totais.subtotal)} />
                {totais.taxa > 0 && <Linha label="Taxa de entrega" valor={money(totais.taxa)} />}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900, marginTop: 4 }}>
                  <span>Total</span>
                  <span>{money(totais.total)}</span>
                </div>
                <p style={{ fontSize: 11, color: "var(--foreground-muted)", margin: "4px 0 0" }}>
                  O valor final é recalculado pelo servidor ao criar o pedido.
                </p>
              </div>

              {pendencias.length > 0 && (
                <div style={{ ...card, borderColor: "var(--attention-border)", background: "var(--attention-surface)" }} role="status" aria-live="polite">
                  <p style={{ ...rotulo, color: "var(--attention-text)" }}>Falta para enviar</p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {pendencias.map((p) => (
                      <li key={p} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)" }}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {erroEnvio && (
                <div style={{ ...card, borderColor: "var(--danger)" }} role="alert">
                  <p style={{ fontSize: 13, fontWeight: 800, color: "var(--danger)", margin: 0 }}>{erroEnvio}</p>
                  <p style={{ fontSize: 11.5, color: "var(--foreground-secondary)", margin: "6px 0 0" }}>
                    O que você montou continua aqui. Tentar de novo reaproveita a mesma tentativa, em vez de começar uma nova.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé: sempre o próximo passo, e por que ele está bloqueado */}
        <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>
          {passo === "cliente" && (
            <button
              onClick={() => irParaPasso("produtos")}
              disabled={!clienteValido}
              style={{ ...btn, border: "none", background: "var(--primary)", color: "var(--background)", opacity: clienteValido ? 1 : 0.5 }}
            >
              Continuar para produtos
            </button>
          )}

          {passo === "produtos" && (
            <>
              {!podeIrParaEntrega && (
                <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)", margin: 0, textAlign: "center" }}>
                  Adicione pelo menos um item para continuar.
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
                <span style={{ color: "var(--foreground-secondary)" }}>{itens.length} item(ns)</span>
                <span>{money(totais.subtotal)}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPasso("cliente")} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>Voltar</button>
                <button
                  onClick={() => irParaPasso("entrega")}
                  disabled={!podeIrParaEntrega}
                  style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: podeIrParaEntrega ? 1 : 0.5 }}
                >
                  Continuar para entrega
                </button>
              </div>
            </>
          )}

          {passo === "entrega" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPasso("produtos")} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>Voltar</button>
              <button
                onClick={() => irParaPasso("pagamento")}
                disabled={!entregaValida}
                style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: entregaValida ? 1 : 0.5 }}
              >
                Continuar para pagamento
              </button>
            </div>
          )}

          {passo === "pagamento" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPasso("entrega")} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>Voltar</button>
              <button
                onClick={() => irParaPasso("revisar")}
                disabled={!pagamentoValido}
                style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: pagamentoValido ? 1 : 0.5 }}
              >
                Continuar para revisão
              </button>
            </div>
          )}

          {passo === "revisar" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPasso("pagamento")} disabled={enviando} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>Voltar</button>
              <button
                onClick={enviar}
                disabled={enviando || pendencias.length > 0}
                style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: enviando || pendencias.length > 0 ? 0.5 : 1 }}
              >
                {enviando ? "Criando pedido…" : "Criar pedido"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Construtor guiado — uma decisão por tela */}
      {produtoAberto && etapaAtual && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Montar ${produtoAberto.nome}`}
          style={{ position: "fixed", inset: 0, zIndex: 2900, background: "var(--background)", display: "flex", flexDirection: "column", fontFamily: "'Archivo', sans-serif" }}
        >
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--surface)", flexShrink: 0 }}>
            <p style={{ ...rotulo, margin: 0 }}>
              {produtoAberto.nome} · passo {etapaVisivel + 1} de {etapas.length}
            </p>
            <p style={{ fontSize: 18, fontWeight: 900, color: "var(--foreground)", margin: "4px 0 2px" }}>{etapaAtual.titulo}</p>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--foreground-secondary)", margin: 0 }}>{etapaAtual.ajuda}</p>
          </div>

          {/* O que já foi escolhido — some a dúvida "o que eu já marquei?" */}
          <div style={{ padding: "8px 16px", display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {etapas.map((e, i) => {
              const resumo = resumoEtapa(e, selecao)
              if (!resumo) return null
              return (
                <button
                  key={e.tipo}
                  onClick={() => setEtapaVisivel(i)}
                  style={{ ...btn, height: 28, padding: "0 10px", fontSize: 11.5, border: "1px solid var(--surface-secondary)", background: "var(--surface)", color: "var(--foreground-secondary)" }}
                >
                  {e.titulo}: {resumo} ✎
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 16px", display: "grid", gap: 8, alignContent: "start" }}>
            {etapaAtual.opcoes.map((o) => {
              const sel = estaEscolhida(o.valor)
              return (
                <button
                  key={o.valor || "__sem__"}
                  onClick={() => !o.esgotado && escolher(o.valor)}
                  disabled={o.esgotado}
                  style={{
                    ...card,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    textAlign: "left",
                    cursor: o.esgotado ? "not-allowed" : "pointer",
                    opacity: o.esgotado ? 0.45 : 1,
                    borderColor: sel ? "var(--primary)" : "var(--surface-secondary)",
                    background: sel ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "var(--surface)",
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>
                    {o.label}
                    {o.esgotado ? " · esgotado" : ""}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {o.extra ? <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--brand-text)" }}>+{money(o.extra)}</span> : null}
                    {sel ? <span style={{ fontSize: 14, color: "var(--primary)" }}>✓</span> : null}
                  </span>
                </button>
              )
            })}
          </div>

          <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 8 }}>
            {bloqueio && (
              <p role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: 0, textAlign: "center" }}>
                {bloqueio}
              </p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={voltarEtapa} style={{ ...btn, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }}>
                {etapaVisivel > 0 ? "Voltar" : "Cancelar item"}
              </button>
              {indiceEtapaPendente(etapas, selecao) === -1 ? (
                <button onClick={confirmarMontagem} style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)" }}>
                  Adicionar ao pedido
                </button>
              ) : (
                <button
                  onClick={avancarEtapa}
                  disabled={!!bloqueio}
                  style={{ ...btn, flex: 2, border: "none", background: "var(--primary)", color: "var(--background)", opacity: bloqueio ? 0.5 : 1 }}
                >
                  {etapaVisivel < etapas.length - 1 ? `Continuar para ${etapas[etapaVisivel + 1].titulo.toLowerCase()}` : "Continuar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmarSaida && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3100, background: "rgba(var(--overlay-rgb), 0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ ...card, maxWidth: 320, display: "grid", gap: 10 }}>
            <p style={{ fontSize: 16, fontWeight: 900, margin: 0, color: "var(--foreground)" }}>Descartar este pedido?</p>
            <p style={{ fontSize: 13, color: "var(--foreground-secondary)", margin: 0 }}>
              O que já foi montado será perdido. O pedido ainda não foi criado.
            </p>
            <button onClick={() => setConfirmarSaida(false)} style={{ ...btn, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)" }}>Continuar montando</button>
            <button onClick={onFechar} style={{ ...btn, border: "none", background: "var(--danger)", color: "#fff" }}>Descartar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--foreground-secondary)" }}>
      <span>{label}</span>
      <span>{valor}</span>
    </div>
  )
}
