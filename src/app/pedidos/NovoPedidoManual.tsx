"use client"

// Montagem manual de pedido no painel — apresentação.
//
// Toda a regra (catálogo pesquisável, etapas obrigatórias, motivo de bloqueio,
// construção e preço do item, pendências) vive em src/lib/montagemManual.ts,
// testável sem montar componente. Aqui só existe navegação e formulário —
// 100% estado React controlado, sem MutationObserver, sem querySelector para
// decidir fluxo, sem manipulação manual do DOM.
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
import ConfirmDialog from '@/components/ConfirmDialog'
import { useDialogA11y } from '@/components/useDialogA11y'
import {
  ArrowLeft,
  ArrowRight,
  Beef,
  Bike,
  Banknote,
  Croissant,
  CreditCard,
  CupSoda,
  GlassWater,
  LoaderCircle,
  Milk,
  Pencil,
  Phone,
  PhoneOff,
  Pizza,
  Plus,
  Sandwich,
  Search,
  Shuffle,
  ShoppingBag,
  Soup,
  Store,
  UtensilsCrossed,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import type { ItemApp } from "@/lib/pedidoAppItens"
import { computeTaxaApp } from "@/lib/pedidoAppLogic"
import { montarPagamentoComposto, extrairPagamentoComposto } from "@/lib/pagamentoComposto"
import { gerarClientRequestId } from "@/survival/clientRequestId"
import { formatarTelefoneExibicao } from "@/lib/telefone"
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

/** Título e texto de apoio de cada etapa — só copy, nenhuma regra aqui. */
const STEP_META: Record<Passo, { titulo: string; ajuda: string }> = {
  cliente: { titulo: "Quem é o cliente?", ajuda: "Comece pelo telefone — reconhecemos o cadastro automaticamente." },
  produtos: { titulo: "Monte o pedido", ajuda: "Busque ou escolha por categoria; itens com opções abrem o montador na hora." },
  entrega: { titulo: "Entrega ou retirada?", ajuda: "Escolha como o cliente vai receber o pedido." },
  pagamento: { titulo: "Como vai pagar?", ajuda: "Escolha a forma de pagamento do pedido." },
  revisar: { titulo: "Revise antes de enviar", ajuda: "Confira cada etapa; o servidor recalcula o valor final ao criar o pedido." },
}

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",")

/** Ícone por categoria — reaproveita o mesmo conjunto já usado no cardápio
 * público (src/app/cardapio/page.tsx), nunca um ícone inventado por tela. */
const ICONE_CATEGORIA: Record<CategoriaManual, LucideIcon> = {
  pizza: Pizza,
  calzone: UtensilsCrossed,
  pastelForno: Croissant,
  lanches: Sandwich,
  hamburgueres: Beef,
  macarronada: Soup,
  bebidas: CupSoda,
  sucos: GlassWater,
  vitaminas: Milk,
}

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
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 18,
}
const input: React.CSSProperties = {
  width: "100%",
  height: 48,
  background: "var(--background)",
  border: "1.5px solid var(--border)",
  borderRadius: 12,
  padding: "0 14px",
  color: "var(--foreground)",
  fontSize: 15,
  fontWeight: 600,
  fontFamily: "'Archivo', sans-serif",
  outline: "none",
  boxSizing: "border-box",
}
const btn: React.CSSProperties = {
  height: 48,
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "'Archivo', sans-serif",
}
const btnPrimary: React.CSSProperties = {
  ...btn,
  border: "none",
  background: "var(--primary)",
  color: "var(--primary-foreground)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
}
const btnSecondary: React.CSSProperties = {
  ...btn,
  border: "1.5px solid var(--border)",
  background: "transparent",
  color: "var(--foreground-secondary)",
}
const rotulo: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: ".6px",
  textTransform: "uppercase",
  color: "var(--foreground-muted)",
  margin: "0 0 6px",
  display: "block",
}
const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "1px",
  textTransform: "uppercase",
  color: "var(--brand-text)",
  margin: "0 0 4px",
}
const stepTitle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  color: "var(--foreground)",
  margin: "0 0 4px",
  letterSpacing: "-0.3px",
}
const stepHelp: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--foreground-secondary)",
  margin: 0,
  lineHeight: 1.4,
}

/** Cabeçalho comum de toda etapa: "ETAPA X DE 5" + título + instrução curta. */
function EtapaHeader({ indice, titulo, ajuda }: { indice: number; titulo: string; ajuda: string }) {
  return (
    <div>
      <p style={eyebrow}>ETAPA {indice + 1} DE {PASSOS.length}</p>
      <h3 style={stepTitle}>{titulo}</h3>
      <p style={stepHelp}>{ajuda}</p>
    </div>
  )
}

/** Indicador circular de seleção — nunca a única pista de estado (o texto/borda do card já dizem). */
function SelectionDot({ selecionado }: { selecionado: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        border: "2px solid " + (selecionado ? "var(--primary)" : "var(--border-strong)"),
        background: selecionado ? "var(--primary)" : "transparent",
        color: "var(--primary-foreground)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 900,
        flexShrink: 0,
      }}
    >
      {selecionado ? "✓" : ""}
    </span>
  )
}

/**
 * Barra horizontal de categorias do seletor de produtos ("+ Adicionar").
 * SEMPRE montada enquanto o seletor estiver aberto — `categoriaAtiva` e
 * `destacar` só decidem qual botão fica destacado (estado visual) e, via
 * `onSelecionar`, qual categoria filtra a lista de produtos. Nenhum dos dois
 * controla se esta barra existe no DOM: extrair para um componente próprio,
 * chamado sem condição nenhuma no ESTADO B, é o que torna impossível
 * reintroduzir por acidente um `{!buscando && (...)}` ou `{categoria && (...)}`
 * envolvendo a barra inteira.
 */
function BarraCategorias({
  categoriaAtiva,
  destacar,
  onSelecionar,
}: {
  categoriaAtiva: CategoriaManual
  destacar: boolean
  onSelecionar: (categoria: CategoriaManual) => void
}) {
  return (
    <div
      className="pm-categorias-bar"
      role="tablist"
      aria-label="Categorias do cardápio"
      style={{ display: "flex", gap: 8, overflowX: "auto", flexShrink: 0, minHeight: 36 }}
    >
      {CATEGORIAS.map((c) => {
        const Icone = ICONE_CATEGORIA[c.id]
        const ativo = destacar && categoriaAtiva === c.id
        return (
          <button
            key={c.id}
            role="tab"
            aria-selected={ativo}
            onClick={() => onSelecionar(c.id)}
            style={{
              ...btn,
              height: 36,
              padding: "0 14px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "1.5px solid " + (ativo ? "var(--primary)" : "var(--border)"),
              background: ativo ? "var(--primary-soft)" : "transparent",
              color: "var(--foreground)",
              fontSize: 12.5,
            }}
          >
            <Icone size={14} aria-hidden="true" />
            {c.label}
          </button>
        )
      })}
    </div>
  )
}

export default function NovoPedidoManual({ menu, onFechar, onCriado }: Props) {
  const [passo, setPasso] = useState<Passo>("cliente")
  const [confirmarSaida, setConfirmarSaida] = useState(false)
  // ESC/armadilha de foco no modal principal do pedido manual. O ESC pede
  // confirmação em vez de fechar direto: o atendente pode ter meia comanda
  // montada, e perder isso por um toque na tecla errada seria pior.
  const dialogRef = useDialogA11y(true, () => setConfirmarSaida(true), { travarScroll: false })
  // Confirmado (telefone reconhecido) esconde o campo de nome atrás de um
  // card compacto; o lápis abre esta edição explícita sem apagar o nome.
  // Guarda PARA QUAL telefone a edição foi pedida — assim um telefone novo
  // volta a mostrar o card automaticamente, sem precisar de um efeito extra
  // só para "resetar" o estado a cada tecla digitada.
  const [editarNomeParaTelefone, setEditarNomeParaTelefone] = useState<string | null>(null)

  // --- etapa Produtos: dois estados internos --------------------------------
  // "resumo" (ESTADO A) mostra o bilhete e o botão + Adicionar; "seletor"
  // (ESTADO B) é a camada de busca/categorias/produtos. O carrinho (itens)
  // nunca é tocado por essa troca — só decide o que é renderizado.
  const [produtoUiState, setProdutoUiState] = useState<"resumo" | "seletor">("resumo")

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
  // Radio (uma escolha) para tipos de decisão única; checkbox (múltiplas)
  // só para sabores de pizza, que aceitam até 2 (meio a meio).
  const tipoControleEtapa: "radio" | "checkbox" = etapaAtual?.tipo === "sabores" ? "checkbox" : "radio"

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
  // Dígitos do telefone para o qual a busca JÁ TERMINOU (achando ou não) —
  // diferente de telefoneReconhecido, existe mesmo quando não encontrou
  // ninguém. É o que decide "aguardando" vs. "cliente novo, mostrar nome".
  const [telefonePesquisado, setTelefonePesquisado] = useState<string | null>(null)
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
        setTelefonePesquisado(digitos)
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
    // Ciclo obrigatório: + Adicionar → escolher produto → adicionar ao
    // pedido → volta automática ao resumo (ESTADO A), sem fechar a etapa.
    setTermo("")
    setProdutoUiState("resumo")
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
    // Mesmo ciclo do produto sem montagem: confirmar sempre volta ao resumo.
    setProdutoUiState("resumo")
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
          // Preço nunca é confiado: o servidor recalcula item a item. Pizza
          // normal carrega pizzaSelection (IDs estáveis, Fase 4) e Calzone/
          // Mini-Pizza/Macarronada/sucos carregam simpleSelection (Fase 6)
          // quando o catálogo oficial resolveu — o servidor ignora
          // name/detail/price e reprecifica pelo motor nativo, igual ao
          // cardápio público.
          itens: itens.map((i) => ({
            kind: i.kind,
            name: i.name,
            detail: i.detail,
            price: i.price,
            qty: i.qty,
            ...(i.pizzaSelection ? { pizzaSelection: i.pizzaSelection } : {}),
            ...(i.simpleSelection ? { simpleSelection: i.simpleSelection } : {}),
          })),
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

  const digitosTelefone = telefone.replace(/\D/g, "")
  const clienteReconhecido = !semTelefone && digitosTelefone === telefoneReconhecido && !!telefoneReconhecido
  const editandoNome = editarNomeParaTelefone !== null && editarNomeParaTelefone === telefone
  // A busca terminou PARA ESTE telefone exato (nem cedo demais — antes do
  // debounce dar início — nem preso num telefone que já mudou).
  const buscaConcluidaParaTelefoneAtual = telefonePesquisado !== null && telefonePesquisado === digitosTelefone
  const semCorrespondencia = buscaConcluidaParaTelefoneAtual && !clienteReconhecido
  // O campo de nome livre só existe para cliente novo (busca terminou sem
  // achar ninguém), sem telefone, ou quando o lápis pediu edição explícita —
  // nunca ao lado do card de reconhecimento.
  const mostrarCampoNome = semTelefone || semCorrespondencia || editandoNome

  // --- validade por etapa (bloqueia avanço; nunca bloqueia voltar) ---------
  const clienteValido = !!cliente.trim() && (semTelefone || digitosTelefone.length >= 10)
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
    if (indiceDestino <= indiceAlcancavel) {
      // Sair de Produtos sempre devolve o resumo (ESTADO A) na próxima
      // visita — nunca o carrinho (`itens`), só a camada visível.
      if (passo === "produtos" && destino !== "produtos") setProdutoUiState("resumo")
      setPasso(destino)
    }
  }

  const bairros = menu.neighborhoods || []

  // Mensagem curta do que falta na etapa atual — o rodapé nunca deixa a
  // atendente adivinhando por que "Continuar" está desabilitado.
  const mensagemFaltante: string | null = (() => {
    switch (passo) {
      case "cliente":
        if (!semTelefone && digitosTelefone.length < 10) return "Informe um telefone válido para continuar."
        if (!cliente.trim()) return "Informe o nome do cliente."
        return null
      case "produtos":
        return produtosValido ? null : "Adicione pelo menos um item para continuar."
      case "entrega":
        if (tipoEntrega !== "delivery") return null
        if (!bairro.trim()) return "Selecione o bairro da entrega."
        if (!rua.trim()) return "Informe a rua da entrega."
        if (!numero.trim()) return "Informe o número do endereço."
        return null
      case "pagamento":
        if (!pagamentoFinal.trim()) return "Escolha a forma de pagamento."
        if (temDinheiro && trocoOpcao !== "nao" && !troco.trim()) return "Informe o troco, ou marque “sem troco”."
        return null
      case "revisar":
        return pendencias[0] ?? null
      default:
        return null
    }
  })()

  const etapaValidaAtual = [clienteValido, produtosValido, entregaValida, pagamentoValido, pendencias.length === 0][indicePassoAtual]
  const proximoPasso = PASSOS[indicePassoAtual + 1]?.id ?? null
  const emSeletorProdutos = passo === "produtos" && produtoUiState === "seletor"

  function irParaProximoPasso() {
    if (passo === "revisar") { enviar(); return }
    if (proximoPasso) irParaPasso(proximoPasso)
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Novo pedido manual"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2800,
        background: "rgba(var(--overlay-rgb), 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "'Archivo', sans-serif",
      }}
    >
      <div
        style={{
          width: "min(94vw, 640px)",
          maxHeight: "90vh",
          background: "var(--background)",
          borderRadius: 24,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Cabeçalho: onde estou, e como saio */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
            <div>
              <p style={eyebrow}>ATENDIMENTO MANUAL</p>
              <h2 style={{ fontSize: 23, fontWeight: 900, color: "var(--foreground)", margin: 0, letterSpacing: "-0.4px" }}>Novo pedido</h2>
            </div>
            <button
              onClick={tentarSair}
              aria-label="Fechar"
              className="pm-close"
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: "1.5px solid var(--border)",
                background: "var(--surface)",
                color: "var(--foreground-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Progresso: linha conectando cinco círculos numerados */}
          <div className="pm-steps-row">
            {PASSOS.map((p, i) => {
              const ativo = p.id === passo
              const concluido = i < indicePassoAtual
              const alcancavel = i <= indiceAlcancavel
              const estado = ativo ? "atual" : concluido ? "concluida" : alcancavel ? "alcancavel" : "futura"
              return (
                <div key={p.id} className={`pm-step-col${concluido ? " pm-step-done" : ""}`}>
                  <button
                    onClick={() => irParaPasso(p.id)}
                    disabled={!alcancavel}
                    aria-current={ativo ? "step" : undefined}
                    aria-label={`${p.label}${concluido ? " (concluída)" : ativo ? " (etapa atual)" : alcancavel ? " (disponível)" : " (bloqueada)"}`}
                    className="pm-step-circle"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      border: "2px solid transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 900,
                      cursor: alcancavel ? "pointer" : "not-allowed",
                      ...(estado === "atual"
                        ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }
                        : estado === "concluida"
                        ? { background: "var(--success)", color: "#fff", borderColor: "var(--success)" }
                        : estado === "alcancavel"
                        ? { background: "var(--surface)", color: "var(--foreground)", borderColor: "var(--border-strong)" }
                        : { background: "var(--disabled-background)", color: "var(--disabled-foreground)", borderColor: "var(--disabled-background)" }),
                    }}
                  >
                    {concluido ? "✓" : i + 1}
                  </button>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      textAlign: "center",
                      color: ativo ? "var(--foreground)" : "var(--foreground-muted)",
                      letterSpacing: ".2px",
                    }}
                  >
                    {p.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Corpo */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {passo === "cliente" && (
            <>
              <EtapaHeader indice={indicePassoAtual} titulo={STEP_META.cliente.titulo} ajuda={STEP_META.cliente.ajuda} />

              <div style={{ ...card, display: "grid", gap: 12 }}>
                <div>
                  <label style={rotulo} htmlFor="pm-telefone">TELEFONE *</label>
                  <div style={{ position: "relative" }}>
                    <Phone
                      size={17}
                      aria-hidden="true"
                      style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--foreground-muted)" }}
                    />
                    <input
                      id="pm-telefone"
                      className="pm-input"
                      style={{ ...input, paddingLeft: 40 }}
                      placeholder="(00) 00000-0000"
                      value={formatarTelefoneExibicao(telefone)}
                      onChange={(e) => setTelefone(e.target.value)}
                      inputMode="tel"
                      disabled={semTelefone}
                      autoFocus
                    />
                  </div>
                  <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--foreground-muted)", margin: "6px 0 0" }}>
                    Assim que reconhecemos o telefone, o nome é preenchido sozinho.
                  </p>
                  {buscandoTelefone && (
                    <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)", margin: "6px 0 0" }}>
                      <LoaderCircle size={13} className="pm-spin" aria-hidden="true" /> Buscando cliente…
                    </p>
                  )}
                  {clienteReconhecido && !buscandoTelefone && (
                    <p role="status" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--success)", margin: "6px 0 0" }}>
                      <WhatsAppIcon />
                      ✓ Cliente reconhecido
                    </p>
                  )}
                </div>

                {/* Cliente reconhecido: card compacto com lápis, sem reexibir o
                    campo de nome — evita reescrever por cima de um cadastro já
                    confirmado. */}
                {clienteReconhecido && !editandoNome && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, border: "1.5px solid var(--border)", borderRadius: 14, padding: 12, background: "var(--background)" }}>
                    <WhatsAppIcon />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ ...rotulo, margin: 0 }}>Nome do cliente</p>
                      <p style={{ fontSize: 14.5, fontWeight: 800, color: "var(--foreground)", margin: "2px 0 0" }}>{cliente || "—"}</p>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground-secondary)", margin: "2px 0 0" }}>{formatarTelefoneExibicao(telefone)}</p>
                    </div>
                    <button
                      onClick={() => setEditarNomeParaTelefone(telefone)}
                      aria-label="Editar nome do cliente"
                      style={{ background: "none", border: "none", color: "var(--brand-text)", cursor: "pointer", padding: 6, flexShrink: 0, display: "flex" }}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                )}

                {/* Cliente novo (busca terminou sem achar ninguém), sem
                    telefone, ou edição explícita pelo lápis — nunca junto do
                    card de reconhecimento acima. */}
                {mostrarCampoNome && (
                  <div>
                    <label style={rotulo} htmlFor="pm-nome">NOME *</label>
                    <input
                      id="pm-nome"
                      className="pm-input"
                      style={input}
                      placeholder="Nome do cliente"
                      value={cliente}
                      onChange={(e) => setCliente(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* "Sem telefone": card grande e inteiro clicável, nunca um
                  checkbox solto — mesma hierarquia visual das demais escolhas
                  desta etapa. */}
              <button
                type="button"
                onClick={() => setSemTelefone((v) => !v)}
                aria-pressed={semTelefone}
                className={`pm-select-card${semTelefone ? " pm-selected" : ""}`}
                style={{ ...card, display: "flex", alignItems: "center", gap: 14, textAlign: "left", cursor: "pointer", width: "100%" }}
              >
                <PhoneOff size={20} aria-hidden="true" style={{ color: semTelefone ? "var(--brand-text)" : "var(--foreground-muted)", flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 800, color: "var(--foreground)" }}>Sem número de telefone</span>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground-secondary)", marginTop: 2 }}>
                    Pedido de balcão — nunca envia WhatsApp
                  </span>
                </span>
                <SelectionDot selecionado={semTelefone} />
              </button>
            </>
          )}

          {passo === "produtos" && produtoUiState === "resumo" && (
            <>
              <div>
                <p style={eyebrow}>ETAPA {indicePassoAtual + 1} DE {PASSOS.length}</p>
                <h3 style={stepTitle}>Confira o pedido</h3>
                <p style={stepHelp}>
                  {itens.length === 0
                    ? 'Toque em "+ Adicionar" para escolher os produtos do pedido.'
                    : `${itens.length} item${itens.length > 1 ? "s" : ""} no pedido — toque em "+ Adicionar" para incluir mais.`}
                </p>
              </div>

              <button
                onClick={() => setProdutoUiState("seletor")}
                className="pm-cta"
                style={{ ...btnPrimary, width: "100%" }}
              >
                <Plus size={18} aria-hidden="true" /> Adicionar
              </button>

              {itens.length === 0 ? (
                <div style={{ ...card, display: "grid", justifyItems: "center", gap: 8, padding: 32, textAlign: "center" }}>
                  <ShoppingBag size={28} aria-hidden="true" style={{ color: "var(--foreground-muted)" }} />
                  <p style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)", margin: 0 }}>Nenhum produto adicionado ainda</p>
                  <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>
                    Toque em “+ Adicionar” para abrir o cardápio.
                  </p>
                </div>
              ) : (
                <div style={{ ...card, display: "grid", gap: 10 }}>
                  <p style={rotulo}>No pedido ({itens.length})</p>
                  {itens.map((item, i) => (
                    <div key={`${item.name}-${item.detail}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: i < itens.length - 1 ? "1px solid var(--border)" : "none", paddingBottom: i < itens.length - 1 ? 10 : 0 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "var(--foreground)" }}>{item.name}</span>
                        {item.detail && (
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--foreground-secondary)" }}>{item.detail}</span>
                        )}
                        <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--brand-text)", marginTop: 2 }}>{money(item.price * item.qty)}</span>
                      </span>
                      <button onClick={() => setItens(alterarQuantidade(itens, i, -1))} aria-label={`Diminuir ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)" }}>−</button>
                      <span style={{ fontSize: 13, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{item.qty}</span>
                      <button onClick={() => setItens(alterarQuantidade(itens, i, 1))} aria-label={`Aumentar ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)" }}>+</button>
                      <button onClick={() => setItens(removerItem(itens, i))} aria-label={`Remover ${item.name}`} style={{ ...btn, height: 30, width: 30, border: "none", background: "transparent", color: "var(--danger)" }}>×</button>
                    </div>
                  ))}
                  {totais.itensInvalidos > 0 && (
                    <p role="status" aria-live="polite" style={{ fontSize: 12, fontWeight: 700, color: "var(--attention-text)", margin: 0 }}>
                      {totais.itensInvalidos} item(ns) saíram do cardápio e não entram no total. Remova antes de enviar.
                    </p>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 900, color: "var(--foreground)", borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 2 }}>
                    <span>Total da etapa</span>
                    <span>{money(totais.subtotal)}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ESTADO B — Adicionar produto: camada interna no mesmo contexto
              do modal (nunca fullscreen, nunca uma tela nova). */}
          {passo === "produtos" && produtoUiState === "seletor" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={() => setProdutoUiState("resumo")}
                  aria-label="Voltar ao resumo do pedido"
                  className="pm-close"
                  style={{ width: 38, height: 38, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--surface)", color: "var(--foreground-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h3 style={{ ...stepTitle, fontSize: 18 }}>Adicionar produto</h3>
                  <p style={stepHelp}>Preços do cardápio oficial</p>
                </div>
              </div>

              <div style={{ position: "relative" }}>
                <Search size={17} aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--foreground-muted)" }} />
                <input
                  className="pm-input"
                  style={{ ...input, paddingLeft: 40 }}
                  placeholder="Buscar pizza, calzone, suco…"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  aria-label="Buscar produto"
                  autoFocus
                />
                {termo && (
                  <button
                    onClick={() => setTermo("")}
                    aria-label="Limpar busca"
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--foreground-muted)", cursor: "pointer", display: "flex", padding: 4 }}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* Componente dedicado e sempre montado enquanto o seletor
                  estiver aberto — `categoria`/`buscando` só decidem destaque
                  e filtro, nunca a existência desta barra no DOM. */}
              <BarraCategorias
                categoriaAtiva={categoria}
                destacar={!buscando}
                onSelecionar={(id) => {
                  setTermo("")
                  setCategoria(id)
                }}
              />

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

              <div style={{ display: "grid", gap: 10 }}>
                {resultados.map((p) => {
                  const IconeProduto = ICONE_CATEGORIA[p.categoria]
                  return (
                    <button
                      key={p.id}
                      onClick={() => abrirProduto(p)}
                      disabled={p.esgotado}
                      className="pm-select-card"
                      style={{
                        ...card,
                        padding: 14,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "left",
                        cursor: p.esgotado ? "not-allowed" : "pointer",
                        opacity: p.esgotado ? 0.5 : 1,
                      }}
                    >
                      <IconeProduto size={18} aria-hidden="true" style={{ color: "var(--foreground-muted)", flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{p.nome}</span>
                        <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--foreground-muted)", marginTop: 2 }}>
                          {p.esgotado ? "Esgotado" : buscando ? p.categoriaLabel : p.requerMontagem ? "Precisa escolher opções" : "Adiciona direto"}
                        </span>
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--brand-text)" }}>
                          {p.precoBase === null ? "" : (p.requerMontagem && p.categoria === "pizza" ? "a partir de " : "") + money(p.precoBase)}
                        </span>
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: 11,
                            fontWeight: 900,
                            color: p.esgotado ? "var(--disabled-foreground)" : "var(--primary-foreground)",
                            background: p.esgotado ? "var(--disabled-background)" : "var(--primary)",
                            padding: "3px 10px",
                            borderRadius: 999,
                          }}
                        >
                          Escolher
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {passo === "entrega" && (
            <>
              <EtapaHeader indice={indicePassoAtual} titulo={STEP_META.entrega.titulo} ajuda={STEP_META.entrega.ajuda} />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {([
                  ["delivery", "Entrega", Bike],
                  ["retirada", "Retirada", Store],
                  ["dine_in", "No local", UtensilsCrossed],
                ] as const).map(([valor, label, Icone]) => {
                  const sel = tipoEntrega === valor
                  return (
                    <button
                      key={valor}
                      onClick={() => setTipoEntrega(valor)}
                      className={`pm-select-card${sel ? " pm-selected" : ""}`}
                      style={{ ...card, padding: 14, display: "grid", justifyItems: "center", gap: 6, textAlign: "center" }}
                    >
                      <Icone size={20} aria-hidden="true" style={{ color: sel ? "var(--brand-text)" : "var(--foreground-muted)" }} />
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--foreground)" }}>{label}</span>
                    </button>
                  )
                })}
              </div>

              {tipoEntrega === "delivery" && (
                <div style={{ ...card, display: "grid", gap: 10 }}>
                  <div>
                    <label style={rotulo}>BAIRRO *</label>
                    <select className="pm-input" style={input} value={bairro} onChange={(e) => setBairro(e.target.value)} aria-label="Bairro">
                      <option value="">Selecione o bairro</option>
                      {bairros.map((b, i) => (
                        <option key={i} value={b.name}>{b.name} — {money(b.fee)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={rotulo}>RUA *</label>
                    <input className="pm-input" style={input} placeholder="Rua" value={rua} onChange={(e) => setRua(e.target.value)} />
                  </div>
                  <div>
                    <label style={rotulo}>NÚMERO *</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="pm-input" style={{ ...input, flex: 1 }} placeholder="Número" value={numero} onChange={(e) => setNumero(e.target.value)} />
                      <button
                        onClick={() => setNumero((n) => (n.trim().toUpperCase() === "S/N" ? "" : "S/N"))}
                        className={`pm-select-card${numero.trim().toUpperCase() === "S/N" ? " pm-selected" : ""}`}
                        style={{ ...btn, padding: "0 16px", border: "1.5px solid " + (numero.trim().toUpperCase() === "S/N" ? "var(--primary)" : "var(--border)"), background: numero.trim().toUpperCase() === "S/N" ? "var(--primary-soft)" : "transparent", color: "var(--foreground)", fontSize: 13 }}
                      >
                        S/N
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={rotulo}>COMPLEMENTO / REFERÊNCIA</label>
                    <input className="pm-input" style={input} placeholder="Complemento / referência" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                  </div>
                </div>
              )}

              <div style={card}>
                <label style={rotulo}>OBSERVAÇÃO</label>
                <textarea
                  className="pm-input"
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
              <EtapaHeader indice={indicePassoAtual} titulo={STEP_META.pagamento.titulo} ajuda={STEP_META.pagamento.ajuda} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--foreground-secondary)" }}>Total do pedido</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: "var(--foreground)" }}>{money(totais.total)}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                {[...(menu.payments || []), "Misto"].map((p) => {
                  const ativo = pagamento === p || (p === "Misto" && !!extrairPagamentoComposto(pagamento))
                  const Icone = /pix/i.test(p) ? Wallet : /dinheiro/i.test(p) ? Banknote : /cart/i.test(p) ? CreditCard : Shuffle
                  return (
                    <button
                      key={p}
                      onClick={() => setPagamento(p)}
                      className={`pm-select-card${ativo ? " pm-selected" : ""}`}
                      style={{ ...card, padding: 14, display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}
                    >
                      <Icone size={18} aria-hidden="true" style={{ color: ativo ? "var(--brand-text)" : "var(--foreground-muted)", flexShrink: 0 }} />
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--foreground)" }}>
                        {p === "Cartao" ? "Cartão" : p === "Misto" ? "Pagamento misto" : p}
                      </span>
                    </button>
                  )
                })}
              </div>

              {pagamento === "Misto" && (
                <div style={{ ...card, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="pm-input" style={input} placeholder="Valor no Pix" value={mistoPix} onChange={(e) => setMistoPix(e.target.value)} inputMode="decimal" />
                    <input className="pm-input" style={input} placeholder="Valor em dinheiro" value={mistoDinheiro} onChange={(e) => setMistoDinheiro(e.target.value)} inputMode="decimal" />
                  </div>
                  {compostoAtual && !compostoAtual.ok && (
                    <p role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: 0 }}>
                      {compostoAtual.erro}
                    </p>
                  )}
                </div>
              )}

              {temDinheiro && (
                <div style={{ ...card, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setTrocoOpcao("nao")} className={`pm-select-card${trocoOpcao === "nao" ? " pm-selected" : ""}`} style={{ ...btn, flex: 1, height: 42, fontSize: 13, border: "1.5px solid " + (trocoOpcao === "nao" ? "var(--primary)" : "var(--border)"), background: trocoOpcao === "nao" ? "var(--primary-soft)" : "transparent", color: "var(--foreground)" }}>Sem troco</button>
                    <button onClick={() => setTrocoOpcao("sim")} className={`pm-select-card${trocoOpcao === "sim" ? " pm-selected" : ""}`} style={{ ...btn, flex: 1, height: 42, fontSize: 13, border: "1.5px solid " + (trocoOpcao === "sim" ? "var(--primary)" : "var(--border)"), background: trocoOpcao === "sim" ? "var(--primary-soft)" : "transparent", color: "var(--foreground)" }}>Precisa de troco</button>
                  </div>
                  {trocoOpcao === "sim" && (
                    <input className="pm-input" style={input} placeholder="Troco para quanto?" value={troco} onChange={(e) => setTroco(e.target.value)} inputMode="decimal" />
                  )}
                </div>
              )}
            </>
          )}

          {passo === "revisar" && (
            <>
              <EtapaHeader indice={indicePassoAtual} titulo={STEP_META.revisar.titulo} ajuda={STEP_META.revisar.ajuda} />

              <CardRevisao titulo="Cliente" onEditar={() => irParaPasso("cliente")}>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>{cliente || "—"}</p>
                <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: "2px 0 0" }}>
                  {semTelefone ? "Sem número de telefone" : formatarTelefoneExibicao(telefone) || "—"}
                </p>
              </CardRevisao>

              <CardRevisao titulo={`Produtos (${itens.length})`} onEditar={() => irParaPasso("produtos")}>
                {itens.map((item, i) => (
                  <div key={`${item.name}-${item.detail}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
                    <span style={{ color: "var(--foreground)", fontWeight: 700 }}>{item.qty}× {item.name}</span>
                    <span style={{ color: "var(--foreground-secondary)" }}>{money(item.price * item.qty)}</span>
                  </div>
                ))}
              </CardRevisao>

              <CardRevisao titulo="Entrega" onEditar={() => irParaPasso("entrega")}>
                <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>
                  {tipoEntrega === "delivery" ? `${rua}, ${numero} — ${bairro}` : tipoEntrega === "retirada" ? "Retirada no balcão" : "Consumo no local"}
                </p>
              </CardRevisao>

              <CardRevisao titulo="Pagamento" onEditar={() => irParaPasso("pagamento")}>
                <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>{pagamentoFinal || "—"}</p>
              </CardRevisao>

              <div style={{ ...card, display: "grid", gap: 6, borderColor: "var(--primary)", borderWidth: 2 }}>
                <p style={rotulo}>Resumo</p>
                <Linha label="Subtotal" valor={money(totais.subtotal)} />
                {totais.taxa > 0 && <Linha label="Taxa de entrega" valor={money(totais.taxa)} />}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 900, marginTop: 6, color: "var(--foreground)" }}>
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

        {/* Rodapé: sempre o próximo passo, e por que ele está bloqueado. Some
            enquanto a atendente está no seletor (ESTADO B) de Produtos — a
            navegação de lá é o botão de voltar do próprio cabeçalho da
            camada, não a navegação entre etapas do pedido. */}
        {!emSeletorProdutos && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "16px 24px calc(16px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 10 }}>
          {mensagemFaltante && (
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)", margin: 0, textAlign: "center" }}>
              {mensagemFaltante}
            </p>
          )}
          {passo === "produtos" && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
              <span style={{ color: "var(--foreground-secondary)" }}>{itens.length} item(ns)</span>
              <span>{money(totais.subtotal)}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            {passo !== "cliente" && (
              <button
                onClick={() => setPasso(PASSOS[indicePassoAtual - 1].id)}
                disabled={passo === "revisar" && enviando}
                style={{ ...btnSecondary, flex: 1 }}
              >
                Voltar
              </button>
            )}
            <button
              onClick={irParaProximoPasso}
              disabled={passo === "revisar" ? enviando || pendencias.length > 0 : !etapaValidaAtual}
              className="pm-cta"
              style={{ ...btnPrimary, flex: passo === "cliente" ? undefined : 3, width: passo === "cliente" ? "100%" : undefined }}
            >
              {passo === "revisar" ? (
                enviando ? (
                  <><LoaderCircle size={16} className="pm-spin" aria-hidden="true" /> Criando pedido…</>
                ) : (
                  "Criar pedido"
                )
              ) : (
                <>Continuar <ArrowRight size={16} aria-hidden="true" /></>
              )}
            </button>
          </div>
        </div>
        )}
      </div>

      {/* Construtor guiado — dentro do mesmo fluxo, nunca uma camada fullscreen */}
      {produtoAberto && etapaAtual && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Montar ${produtoAberto.nome}`}
          style={{ position: "fixed", inset: 0, zIndex: 2900, background: "rgba(var(--overlay-rgb), 0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "'Archivo', sans-serif" }}
        >
          <div style={{ width: "min(94vw, 560px)", maxHeight: "88vh", background: "var(--background)", borderRadius: 24, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <p style={eyebrow}>
                {produtoAberto.nome} · PASSO {etapaVisivel + 1} DE {etapas.length}
              </p>
              <p style={{ fontSize: 19, fontWeight: 900, color: "var(--foreground)", margin: "4px 0 2px" }}>{etapaAtual.titulo}</p>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--foreground-secondary)", margin: 0 }}>{etapaAtual.ajuda}</p>
            </div>

            {/* O que já foi escolhido — some a dúvida "o que eu já marquei?" */}
            <div style={{ padding: "10px 22px 0", display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
              {etapas.map((e, i) => {
                const resumo = resumoEtapa(e, selecao)
                if (!resumo) return null
                return (
                  <button
                    key={e.tipo}
                    onClick={() => setEtapaVisivel(i)}
                    style={{ ...btn, height: 28, padding: "0 10px", fontSize: 11.5, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--foreground-secondary)" }}
                  >
                    {e.titulo}: {resumo} ✎
                  </button>
                )
              })}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 22px", display: "grid", gap: 10, alignContent: "start" }}>
              {etapaAtual.opcoes.map((o) => {
                const sel = estaEscolhida(o.valor)
                return (
                  <label
                    key={o.valor || "__sem__"}
                    className={`pm-select-card${sel ? " pm-selected" : ""}`}
                    style={{
                      ...card,
                      padding: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      cursor: o.esgotado ? "not-allowed" : "pointer",
                      opacity: o.esgotado ? 0.45 : 1,
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>
                        {o.label}
                        {o.esgotado ? " · esgotado" : ""}
                      </span>
                      {o.extra ? <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--brand-text)" }}>+{money(o.extra)}</span> : null}
                    </span>
                    <input
                      type={tipoControleEtapa}
                      name="pm-opcao-etapa"
                      checked={sel}
                      disabled={o.esgotado}
                      onChange={() => !o.esgotado && escolher(o.valor)}
                      aria-label={o.label}
                      style={{ width: 20, height: 20, accentColor: "var(--primary)", flexShrink: 0, cursor: o.esgotado ? "not-allowed" : "pointer" }}
                    />
                  </label>
                )
              })}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", padding: "16px 22px calc(16px + env(safe-area-inset-bottom))", flexShrink: 0, display: "grid", gap: 10 }}>
              {bloqueio && (
                <p role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: 0, textAlign: "center" }}>
                  {bloqueio}
                </p>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={voltarEtapa} style={{ ...btnSecondary, flex: 1 }}>
                  {etapaVisivel > 0 ? "Voltar" : "Cancelar item"}
                </button>
                {indiceEtapaPendente(etapas, selecao) === -1 ? (
                  <button onClick={confirmarMontagem} className="pm-cta" style={{ ...btnPrimary, flex: 2 }}>
                    Adicionar ao pedido
                  </button>
                ) : (
                  <button
                    onClick={avancarEtapa}
                    disabled={!!bloqueio}
                    className="pm-cta"
                    style={{ ...btnPrimary, flex: 2 }}
                  >
                    {etapaVisivel < etapas.length - 1 ? `Continuar para ${etapas[etapaVisivel + 1].titulo.toLowerCase()}` : "Continuar"} <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de descarte: diálogo compacto, ação destrutiva à
          direita e "continuar" como secundária (ver @/components/ConfirmDialog). */}
      <ConfirmDialog
        aberto={confirmarSaida}
        titulo="Descartar este pedido?"
        descricao="O que já foi montado será perdido. O pedido ainda não foi criado."
        confirmarLabel="Descartar"
        cancelarLabel="Continuar montando"
        tom="perigo"
        onConfirmar={onFechar}
        onCancelar={() => setConfirmarSaida(false)}
      />

      <style jsx>{`
        .pm-input { transition: border-color .15s ease, box-shadow .15s ease; }
        .pm-input:focus-visible, .pm-input:focus { border-color: var(--primary) !important; box-shadow: 0 0 0 3px var(--primary-soft); }
        .pm-close:hover { background: var(--surface-secondary); }
        .pm-steps-row { display: flex; }
        .pm-step-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; }
        .pm-step-col:not(:last-child)::after {
          content: "";
          position: absolute;
          top: 17px;
          left: 50%;
          width: 100%;
          height: 2px;
          background: var(--border);
          z-index: 0;
        }
        .pm-step-col.pm-step-done:not(:last-child)::after { background: var(--success); }
        .pm-step-circle { position: relative; z-index: 1; }
        .pm-select-card { transition: border-color .15s ease, background .15s ease; }
        .pm-select-card:hover:not(:disabled) { border-color: var(--border-strong); }
        .pm-select-card.pm-selected { border-color: var(--primary) !important; background: var(--primary-soft) !important; }
        .pm-cta:disabled { opacity: .5; cursor: not-allowed; }
        .pm-cta:not(:disabled):hover { background: var(--primary-hover); }
        .pm-spin { animation: pm-spin .8s linear infinite; }
        @keyframes pm-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .pm-spin { animation: none; }
        }
      `}</style>
    </div>
  )
}

function CardRevisao({ titulo, onEditar, children }: { titulo: string; onEditar: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onEditar}
      aria-label={`Editar ${titulo}`}
      style={{ ...card, display: "grid", gap: 6, textAlign: "left", cursor: "pointer", width: "100%" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={rotulo}>{titulo}</span>
        <Pencil size={14} aria-hidden="true" style={{ color: "var(--brand-text)", flexShrink: 0 }} />
      </div>
      {children}
    </button>
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

// Ícone oficial do WhatsApp (cor de marca do próprio WhatsApp, `var(--whatsapp)`
// — nunca da pizzaria) — usado só para identificar visualmente o canal do
// cliente reconhecido, nunca como cor de destaque geral da tela.
function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--whatsapp)" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.42-1.42a9.87 9.87 0 004.62 1.18h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.3-1.93 1.35-.5.05-.99.24-3.32-.69-2.81-1.12-4.62-3.99-4.76-4.18-.14-.19-1.14-1.52-1.14-2.9 0-1.38.72-2.06.98-2.34.26-.28.56-.35.75-.35.19 0 .38 0 .54.01.18.01.41-.07.64.49.24.58.81 2 .88 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.47-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.28.37-.23.63-.14.26.09 1.66.78 1.94.93.28.14.47.21.54.33.07.12.07.68-.17 1.36z" />
    </svg>
  )
}
