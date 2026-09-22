'use client'

type Metricas = {
  pedidosValidos: number
  receitaElegivelCents: number
  ticketMedioCents: number
  clientesUnicos: number
  clientesNovos: number
  clientesRecorrentes: number
  percentualClientesRecorrentes: number
  clientesComSegundoPedido: number
  percentualClientesComSegundoPedido: number
  pedidosMediosPorCliente: number
  receitaMediaPorClienteCents: number
  estrelasDistribuidas: number
  percentualReceitaRecorrentes: number
  cohortePorPedidos: Record<string, number>
  serieDiaria: Array<{ data: string; pedidos: number; receitaCents: number; clientesUnicos: number }>
  porCanal: Record<string, { pedidos: number; receitaCents: number }>
}

type Props = { metricas: Metricas; periodo: number }

function reais(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function diaCurto(data: string) {
  const partes = data.split('-')
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : data
}

function canalNome(canal: string) {
  return canal === 'whatsapp' ? 'WhatsApp' : canal === 'salao' ? 'Salão' : canal === 'app' ? 'App/site' : 'Não identificado'
}

const card = { padding: 14, borderRadius: 10, background: 'var(--background)', border: '1px solid var(--border)' }
const label = { fontSize: 10, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase' as const, color: 'var(--foreground-muted)', marginBottom: 5 }

export default function FidelidadeAnalyticsDashboard({ metricas, periodo }: Props) {
  const serie = metricas.serieDiaria ?? []
  const maxReceita = Math.max(1, ...serie.map((item) => item.receitaCents))
  const cohortes = Object.entries(metricas.cohortePorPedidos ?? {})
    .sort(([a], [b]) => Number(a.replace('+', '')) - Number(b.replace('+', '')))
  const canais = Object.entries(metricas.porCanal ?? {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
        {[
          ['Pedidos entregues', String(metricas.pedidosValidos)],
          ['Receita elegível', reais(metricas.receitaElegivelCents)],
          ['Ticket médio', reais(metricas.ticketMedioCents)],
          ['Clientes únicos', String(metricas.clientesUnicos)],
          ['Pedidos por cliente', metricas.pedidosMediosPorCliente.toLocaleString('pt-BR')],
          ['Receita por cliente', reais(metricas.receitaMediaPorClienteCents)],
          ['Estrelas distribuídas', String(metricas.estrelasDistribuidas)],
        ].map(([nome, valor]) => <div key={nome} style={card}>
          <div style={label}>{nome}</div><div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
        </div>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={{ ...label, marginBottom: 7 }}>Retenção observada</div>
          <div style={{ fontSize: 13, color: 'var(--foreground-secondary)', lineHeight: 1.55 }}>
            <div><strong>{metricas.clientesNovos}</strong> clientes foram novos no período.</div>
            <div><strong>{metricas.clientesComSegundoPedido}</strong> clientes fizeram segunda compra no período ({metricas.percentualClientesComSegundoPedido}%).</div>
            <div><strong>{metricas.clientesRecorrentes}</strong> já tinham histórico antes do período ({metricas.percentualClientesRecorrentes}%).</div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--foreground-muted)' }}>Comportamento de pedidos não prova sozinho que a fidelidade causou o retorno.</div>
          </div>
        </div>
        <div style={card}>
          <div style={{ ...label, marginBottom: 7 }}>O que falta para provar ROI</div>
          <div style={{ fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.6 }}>
            <div>• margem por pedido e custo real dos presentes;</div>
            <div>• grupo de comparação ou linha de base anterior;</div>
            <div>• exposição, adesão, desbloqueio e resgate.</div>
            <div style={{ marginTop: 8, color: 'var(--attention, #7c3aed)', fontWeight: 700 }}>ROI, lucro incremental e custo por cliente ainda não são calculáveis.</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ ...label, marginBottom: 4 }}>Ritmo diário de pedidos</div>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 12 }}>Receita elegível por dia nos últimos {periodo} dias.</div>
          {serie.length === 0 ? <div style={{ color: 'var(--foreground-muted)', fontSize: 12 }}>Sem série diária disponível.</div> : <div style={{ display: 'flex', alignItems: 'end', gap: 4, height: 150, overflowX: 'auto', paddingBottom: 22 }} aria-label="Gráfico de receita diária">
            {serie.map((item) => <div key={item.data} title={`${diaCurto(item.data)}: ${reais(item.receitaCents)} — ${item.pedidos} pedido(s)`} style={{ minWidth: 24, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'end', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 18, height: `${Math.max(5, (item.receitaCents / maxReceita) * 112)}px`, borderRadius: '4px 4px 2px 2px', background: 'var(--primary, #facc15)' }} />
              <span style={{ fontSize: 9, color: 'var(--foreground-muted)', whiteSpace: 'nowrap', transform: 'rotate(-45deg)', transformOrigin: 'center' }}>{diaCurto(item.data)}</span>
            </div>)}
          </div>}
        </div>
        <div style={card}>
          <div style={{ ...label, marginBottom: 4 }}>Canais de venda</div>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 10 }}>Participação na receita elegível.</div>
          {canais.map(([nome, dados]) => { const percentual = metricas.receitaElegivelCents ? Math.round((dados.receitaCents / metricas.receitaElegivelCents) * 100) : 0; return <div key={nome} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span>{canalNome(nome)}</span><strong>{percentual}%</strong></div>
            <div style={{ height: 7, borderRadius: 5, background: 'var(--border)' }}><div style={{ width: `${percentual}%`, height: '100%', borderRadius: 5, background: 'var(--primary, #facc15)' }} /></div>
          </div> })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={{ ...label, marginBottom: 8 }}>Funil de comportamento</div>
          {[
            ['Clientes únicos', metricas.clientesUnicos, 100],
            ['Clientes com 1 pedido', metricas.cohortePorPedidos['1'] ?? 0, metricas.clientesUnicos ? ((metricas.cohortePorPedidos['1'] ?? 0) / metricas.clientesUnicos) * 100 : 0],
            ['Clientes com 2+ pedidos', metricas.clientesComSegundoPedido, metricas.percentualClientesComSegundoPedido],
          ].map(([nome, valor, percentual]) => <div key={String(nome)} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span>{nome}</span><strong>{valor}</strong></div>
            <div style={{ height: 8, borderRadius: 6, background: 'var(--border)' }}><div style={{ width: `${Math.min(100, Number(percentual))}%`, height: '100%', borderRadius: 6, background: 'var(--primary, #facc15)' }} /></div>
          </div>)}
        </div>
        <div style={card}>
          <div style={{ ...label, marginBottom: 8 }}>Clientes por quantidade de pedidos</div>
          {cohortes.map(([faixa, quantidade]) => <div key={faixa} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}><span>{faixa} pedido{faixa === '1' ? '' : 's'}</span><strong>{quantidade}</strong></div>)}
          <div style={{ marginTop: 9, fontSize: 11, color: 'var(--foreground-muted)' }}>2+ significa repetição dentro do período selecionado, não adesão comprovada à fidelidade.</div>
        </div>
      </div>
    </div>
  )
}
