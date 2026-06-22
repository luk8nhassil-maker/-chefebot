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
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ImprimirPedidoPage({ params }: PageProps) {
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    params.then(async ({ id }) => {
      try {
        const res = await fetch('/api/orders')
        if (!res.ok) { setErro('Erro ao buscar pedidos'); return }
        const lista: Pedido[] = await res.json()
        const encontrado = lista.find(p => p.id === id)
        if (!encontrado) { setErro('Pedido não encontrado'); return }
        setPedido(encontrado)
      } catch {
        setErro('Erro ao carregar pedido')
      }
    })
  }, [params])

  if (erro) {
    return (
      <div style={{ fontFamily: "'Courier New', monospace", padding: 16 }}>{erro}</div>
    )
  }

  if (!pedido) {
    return (
      <div style={{ fontFamily: "'Courier New', monospace", padding: 16 }}>Carregando...</div>
    )
  }

  const isDineIn = pedido.tipoEntrega === 'dine_in' || pedido.endereco === 'Consumo no local'
  const isRetirada =
    !isDineIn &&
    (pedido.tipoEntrega === 'retirada' ||
      pedido.tipoEntrega === 'pickup' ||
      pedido.endereco === 'Retirada na loja')
  const isDelivery = !isDineIn && !isRetirada

  const tipoLabel = isDineIn ? 'CONSUMO NO LOCAL' : isRetirada ? 'RETIRADA' : 'DELIVERY'
  const numeroLabel =
    pedido.numero != null ? `#${pedido.numero}` : `#${pedido.id.slice(-6).toUpperCase()}`

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #fff; }
        .cupom {
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px;
          line-height: 1.6;
          width: 72mm;
          max-width: 72mm;
          padding: 4mm 3mm;
          background: #fff;
          color: #000;
        }
        .centro { text-align: center; }
        .negrito { font-weight: bold; }
        .grande { font-size: 14px; font-weight: bold; text-align: center; margin: 3px 0; }
        .total-linha { font-size: 14px; font-weight: bold; text-align: right; margin-top: 4px; }
        .linha { border: none; border-top: 1px dashed #000; margin: 6px 0; }
        .secao { margin: 2px 0; }
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
          .cupom { padding: 2mm; }
        }
      `}</style>

      <div className="cupom">
        <div className="centro negrito">====== CHEFE DA PIZZA ======</div>
        <div className="grande">PEDIDO {numeroLabel}</div>
        <hr className="linha" />

        <div className="secao">
          <span className="negrito">Cliente: </span>{pedido.cliente}
        </div>
        {pedido.telefone && pedido.telefone !== 'App' && (
          <div className="secao">
            <span className="negrito">Telefone: </span>{pedido.telefone}
          </div>
        )}
        <div className="secao">
          <span className="negrito">Horário: </span>{pedido.horario}
        </div>

        <hr className="linha" />
        <div className="secao negrito">Tipo: {tipoLabel}</div>

        <hr className="linha" />
        <div className="secao negrito">Itens:</div>
        {pedido.itens.map((item, i) => (
          <div key={i} className="secao">1x {item}</div>
        ))}

        {pedido.observacao && (
          <>
            <hr className="linha" />
            <div className="secao"><span className="negrito">Obs: </span>{pedido.observacao}</div>
          </>
        )}

        {isDelivery && (
          <>
            <hr className="linha" />
            <div className="secao negrito">Entrega:</div>
            <div className="secao">Rua: {pedido.endereco}</div>
            {pedido.bairro && <div className="secao">Bairro: {pedido.bairro}</div>}
            {pedido.referencia && <div className="secao">Ref: {pedido.referencia}</div>}
            {pedido.taxaEntrega != null && pedido.taxaEntrega > 0 && (
              <div className="secao">
                Taxa: R$ {pedido.taxaEntrega.toFixed(2).replace('.', ',')}
              </div>
            )}
          </>
        )}

        <hr className="linha" />
        <div className="secao negrito">Pagamento:</div>
        <div className="secao">{pedido.pagamento || 'Não informado'}</div>
        {pedido.troco && pedido.troco !== 'Sem troco' && (
          <div className="secao">Troco: {pedido.troco}</div>
        )}

        <hr className="linha" />
        <div className="total-linha">TOTAL: R$ {pedido.total.toFixed(2).replace('.', ',')}</div>
        <div className="centro">============================</div>
      </div>

      <button className="btn-imprimir" onClick={() => window.print()}>
        Imprimir agora
      </button>
    </>
  )
}
