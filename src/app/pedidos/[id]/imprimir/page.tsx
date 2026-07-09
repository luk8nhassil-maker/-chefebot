'use client'

import { useEffect, useState } from 'react'

type Pedido = {
  id: string
  numero?: number
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: string
  horario: string
  endereco: string
  tipoEntrega?: string
  bairro?: string
  taxaEntrega?: number
  pagamento?: string
  observacao?: string
  referencia?: string
  troco?: string
  pixConfirmado?: boolean
  pix?: { status?: string }
}

interface PageProps {
  params: Promise<{ id: string }>
}

// --- helpers ---

function dataBrasiliaDe(id: string): string {
  const ts = parseInt(id, 10)
  if (isNaN(ts) || ts < 1e12) return ''
  return new Date(ts).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function numeroDiarioCupom(
  pedido: Pedido,
  lista: Pedido[]
): { diario: number | null; idCurto: string } {
  const idCurto = pedido.id.slice(-6).toUpperCase()
  const ts = parseInt(pedido.id, 10)
  if (isNaN(ts) || ts < 1e12) return { diario: null, idCurto }

  const diaBrasilia = new Date(ts).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  const doMesmoDia = lista.filter(p => {
    const tsp = parseInt(p.id, 10)
    if (isNaN(tsp) || tsp < 1e12) return false
    return (
      new Date(tsp).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }) === diaBrasilia
    )
  })

  doMesmoDia.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
  const idx = doMesmoDia.findIndex(p => p.id === pedido.id)
  return { diario: idx >= 0 ? idx + 1 : null, idCurto }
}

function parseHybrid(pagamento: string): { metodo: string; valor: number }[] | null {
  if (!pagamento || !pagamento.includes('+')) return null
  const partes = pagamento.split('+').map(s => s.trim())
  const resultado: { metodo: string; valor: number }[] = []
  for (const parte of partes) {
    const match = parte.match(/^(.+?)\s*\(R\$\s*([\d,.]+)\)$/)
    if (!match) return null
    const metodo = match[1].trim()
    const valor = parseFloat(match[2].replace('.', '').replace(',', '.'))
    resultado.push({ metodo, valor })
  }
  return resultado.length >= 2 ? resultado : null
}

function brl(n: number): string {
  return `R$ ${n.toFixed(2).replace('.', ',')}`
}

// strip "Troco para " / "Troco " prefix so we display just the value
function trocoValor(troco: string): string {
  return troco.replace(/^[Tt]roco\s+(para\s+)?/i, '')
}

// Status da perna Pix dentro do pagamento misto — mesma classificação já usada
// no painel (pixConfirmado / pix.status em_revisao|suspeito), só o texto muda
// para o formato do cupom (STATUS: ...).
function statusPixHibrido(pixConfirmado: boolean, pixStatus?: string): string {
  if (pixConfirmado) return 'PIX CONFIRMADO'
  if (pixStatus === 'em_revisao') return 'PIX EM REVISÃO'
  if (pixStatus === 'suspeito') return 'PIX SUSPEITO'
  return 'AGUARDANDO CONFIRMAÇÃO'
}

// --- component ---

export default function ImprimirPedidoPage({ params }: PageProps) {
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [lista, setLista] = useState<Pedido[]>([])
  const [erro, setErro] = useState('')
  const [autoPrint, setAutoPrint] = useState(false)
  const [embedded, setEmbedded] = useState(false)

  useEffect(() => {
    params.then(async ({ id }) => {
      try {
        const res = await fetch('/api/orders')
        if (!res.ok) { setErro('Erro ao buscar pedidos'); return }
        const todos: Pedido[] = await res.json()
        const encontrado = todos.find(p => p.id === id)
        if (!encontrado) { setErro('Pedido não encontrado'); return }
        setLista(todos)
        setPedido(encontrado)
        const sp = new URLSearchParams(window.location.search)
        if (sp.get('auto') === '1') setAutoPrint(true)
        if (sp.get('embedded') === '1') setEmbedded(true)
      } catch {
        setErro('Erro ao carregar pedido')
      }
    })
  }, [params])

  useEffect(() => {
    if (!pedido || !autoPrint) return
    let t: ReturnType<typeof setTimeout>
    const raf = requestAnimationFrame(() => {
      t = setTimeout(() => window.print(), 150)
    })
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [pedido, autoPrint])

  if (erro) return <div style={{ fontFamily: "'Courier New', monospace", padding: 16 }}>{erro}</div>
  if (!pedido) return <div style={{ fontFamily: "'Courier New', monospace", padding: 16 }}>Carregando...</div>

  const isDineIn = pedido.tipoEntrega === 'dine_in' || pedido.endereco === 'Consumo no local'
  const isRetirada =
    !isDineIn &&
    (pedido.tipoEntrega === 'retirada' ||
      pedido.tipoEntrega === 'pickup' ||
      pedido.endereco === 'Retirada na loja')
  const isDelivery = !isDineIn && !isRetirada

  const tipoLabel = isDineIn ? 'CONSUMO NO LOCAL' : isRetirada ? 'RETIRADA' : 'DELIVERY'

  const { diario, idCurto } = numeroDiarioCupom(pedido, lista)
  const numeroCupom =
    diario != null ? `#${diario}` : pedido.numero != null ? `#${pedido.numero}` : `#${idCurto}`

  const dataBrasilia = dataBrasiliaDe(pedido.id)

  const pagamento = pedido.pagamento || ''
  const hibrido = parseHybrid(pagamento)
  const temPix = /\bpix\b/i.test(pagamento)
  const temDinheiro = /dinheiro/i.test(pagamento)
  const temCartao = /cart[aã]o/i.test(pagamento)
  const pixConfirmado = pedido.pixConfirmado === true

  const trocoStr = pedido.troco && pedido.troco !== 'Sem troco' ? pedido.troco : null
  const semTroco = pedido.troco === 'Sem troco'

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #fff; }
        .cupom {
          font-family: 'Courier New', Courier, monospace;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.7;
          width: 72mm;
          max-width: 72mm;
          padding: 4mm 3mm;
          background: #fff;
          color: #000;
        }
        .centro { text-align: center; }
        .negrito { font-weight: 800; }
        .grande { font-size: 16px; font-weight: 800; text-align: center; margin: 4px 0; }
        .total-linha { font-size: 17px; font-weight: 800; text-align: center; margin-top: 6px; }
        .alerta { font-weight: 800; text-align: center; }
        .linha { border: none; border-top: 1px dashed #000; margin: 7px 0; }
        .secao { margin: 3px 0; }
        .secao-titulo { font-weight: 800; text-align: center; margin: 5px 0 3px; }
        .btn-imprimir {
          display: block;
          margin: 16px auto;
          padding: 10px 28px;
          background: #000;
          color: #fff;
          border: none;
          font-family: 'Courier New', monospace;
          font-size: 14px;
          cursor: pointer;
          border-radius: 4px;
        }
        @media print {
          @page { size: 80mm auto; margin: 0; }
          html, body { margin: 0; }
          .btn-imprimir { display: none !important; }
          .cupom {
            padding: 2mm;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color: #000 !important;
          }
        }
      `}</style>

      <div className="cupom">

        {/* Cabeçalho */}
        <div className="centro negrito">====== CHEFE DA PIZZA ======</div>
        <div className="grande">PEDIDO {numeroCupom}</div>
        {diario != null && (
          <div className="centro" style={{ fontSize: 10 }}>ID interno: {idCurto}</div>
        )}

        <hr className="linha" />

        {dataBrasilia && (
          <div className="secao"><span className="negrito">Data: </span>{dataBrasilia}</div>
        )}
        <div className="secao"><span className="negrito">Horário: </span>{pedido.horario}</div>
        <div className="secao"><span className="negrito">Cliente: </span>{pedido.cliente}</div>
        {pedido.telefone && pedido.telefone !== 'App' && (
          <div className="secao"><span className="negrito">Telefone: </span>{pedido.telefone}</div>
        )}

        <hr className="linha" />
        <div className="negrito centro">Tipo: {tipoLabel}</div>

        {/* Itens */}
        <hr className="linha" />
        <div className="secao-titulo">---------- ITENS ----------</div>
        {pedido.itens.map((item, i) => (
          <div key={i} className="secao">1x {item}</div>
        ))}
        {pedido.observacao && (
          <div className="secao" style={{ marginTop: 4 }}>
            <span className="negrito">Obs: </span>{pedido.observacao}
          </div>
        )}

        {/* Entrega */}
        <hr className="linha" />
        <div className="secao-titulo">-------- ENTREGA --------</div>

        {isDelivery && (
          <>
            {pedido.endereco && pedido.endereco.trim()
              ? <div className="secao"><span className="negrito">Rua: </span>{pedido.endereco}</div>
              : <div className="secao negrito">ENDEREÇO NÃO INFORMADO</div>
            }
            {pedido.bairro && (
              <div className="secao"><span className="negrito">Bairro: </span>{pedido.bairro}</div>
            )}
            {pedido.referencia && (
              <div className="secao"><span className="negrito">Referência: </span>{pedido.referencia}</div>
            )}
            <div className="secao">
              <span className="negrito">Taxa: </span>
              {pedido.taxaEntrega && pedido.taxaEntrega > 0 ? brl(pedido.taxaEntrega) : 'R$ 0,00'}
            </div>
          </>
        )}

        {isRetirada && (
          <>
            <div className="secao negrito">RETIRADA NO BALCÃO</div>
            <div className="secao"><span className="negrito">Taxa: </span>R$ 0,00</div>
          </>
        )}

        {isDineIn && (
          <>
            <div className="secao negrito">CONSUMO NO LOCAL</div>
            <div className="secao"><span className="negrito">Taxa: </span>R$ 0,00</div>
          </>
        )}

        {/* Pagamento */}
        <hr className="linha" />
        <div className="secao-titulo">------- PAGAMENTO -------</div>

        {hibrido ? (
          <>
            <div className="secao negrito">PAGAMENTO: HÍBRIDO</div>
            {hibrido.map((h, i) => (
              <div key={i}>
                <div className="secao">
                  <span className="negrito">{h.metodo.toUpperCase()}: </span>{brl(h.valor)}
                </div>
                {/pix/i.test(h.metodo) && (
                  <div className="secao">
                    <span className="negrito">STATUS: </span>{statusPixHibrido(pixConfirmado, pedido.pix?.status)}
                  </div>
                )}
              </div>
            ))}
            {trocoStr && (
              <div className="secao">
                <span className="negrito">TROCO PARA: </span>{trocoValor(trocoStr)}
              </div>
            )}
            {semTroco && <div className="secao negrito">TROCO: NÃO PRECISA</div>}
          </>
        ) : temPix ? (
          <>
            <div className="secao negrito">PAGAMENTO: PIX</div>
            <div className="secao">
              <span className="negrito">STATUS: </span>
              {pixConfirmado ? 'PIX PAGO' : 'AGUARDANDO'}
            </div>
            <div className="secao">
              <span className="negrito">TOTAL NO PIX: </span>{brl(pedido.total)}
            </div>
          </>
        ) : temDinheiro ? (
          <>
            <div className="secao negrito">PAGAMENTO: DINHEIRO</div>
            <div className="secao"><span className="negrito">TOTAL: </span>{brl(pedido.total)}</div>
            {trocoStr && (
              <div className="secao">
                <span className="negrito">TROCO PARA: </span>{trocoValor(trocoStr)}
              </div>
            )}
            {semTroco && <div className="secao negrito">TROCO: NÃO PRECISA</div>}
          </>
        ) : temCartao ? (
          <>
            <div className="secao negrito">PAGAMENTO: CARTÃO</div>
            <div className="secao">
              <span className="negrito">TOTAL NO CARTÃO: </span>{brl(pedido.total)}
            </div>
          </>
        ) : pagamento ? (
          <div className="secao negrito">PAGAMENTO: {pagamento.toUpperCase()}</div>
        ) : (
          <div className="secao">Pagamento não informado</div>
        )}

        {/* Alerta Pix */}
        {temPix && (
          <div style={{ marginTop: 6 }}>
            {pixConfirmado ? (
              <div className="alerta">*** PIX CONFIRMADO ***</div>
            ) : (
              <>
                <div className="alerta">*** ATENÇÃO: TEM PIX ***</div>
                <div className="alerta">CONFIRMAR PAGAMENTO PIX</div>
              </>
            )}
          </div>
        )}

        <hr className="linha" />
        <div className="total-linha">TOTAL: {brl(pedido.total)}</div>
        <div className="centro">============================</div>

      </div>

      {!embedded && (
        <button className="btn-imprimir" onClick={() => window.print()}>
          Imprimir agora
        </button>
      )}
    </>
  )
}
