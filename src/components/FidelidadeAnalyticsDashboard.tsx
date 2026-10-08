'use client'

type Metricas = {
  pedidosValidos: number
  pedidosSemClienteIdentificado: number
  pedidosComClienteIdentificado: number
  receitaElegivelClientesIdentificadosCents: number
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
  estrelasDistribuidas: number | null
  pedidosComEstrelasRegistradas?: number | null
  percentualReceitaRecorrentes: number
  cohortePorPedidos: Record<string, number>
  serieDiaria: Array<{ data: string; pedidos: number; receitaCents: number; clientesUnicos: number }>
  porCanal: Record<string, { pedidos: number; receitaCents: number; pedidoIds?: string[] }>
}

type Cobertura = {
  historicoEncontradoDesdeIso: string | null
  diasHistoricoEncontrado: number
  possuiDadosAntesDaJanela: boolean
  recorrenciaAnteriorDisponivel?: boolean
  ancoradaNoInicioCampanha?: boolean
  diasCorridosDisponiveis?: number
}

type Props = { metricas: Metricas; periodo: number | 'historico'; cobertura?: Cobertura }

function reais(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function diaCurto(data: string) {
  const partes = data.split('-')
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : data
}

function canalNome(canal: string) {
  return canal === 'painel' ? 'Pedido criado no painel' : canal === 'whatsapp' ? 'WhatsApp' : canal === 'salao' ? 'Salão' : canal === 'app' ? 'App/site' : 'Não identificado'
}

const card = { padding: 14, borderRadius: 10, background: 'var(--background)', border: '1px solid var(--border)' }
const label = { fontSize: 10, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase' as const, color: 'var(--foreground-muted)', marginBottom: 5 }

export default function FidelidadeAnalyticsDashboard({ metricas, periodo, cobertura }: Props) {
  const serie = metricas.serieDiaria ?? []
  const maxReceita = Math.max(1, ...serie.map((item) => item.receitaCents))
  const cohortes = Object.entries(metricas.cohortePorPedidos ?? {})
    .sort(([a], [b]) => Number(a.replace('+', '')) - Number(b.replace('+', '')))
  const canais = Object.entries(metricas.porCanal ?? {})
  const historicoAnteriorDisponivel = cobertura?.recorrenciaAnteriorDisponivel ?? cobertura?.possuiDadosAntesDaJanela ?? false
  const diasCampanhaDisponiveis = typeof periodo === 'number'
    ? (cobertura?.diasCorridosDisponiveis ?? periodo)
    : 0
  const periodoLabel = periodo === 'historico'
    ? 'todo o histórico disponível'
    : cobertura?.ancoradaNoInicioCampanha
      ? diasCampanhaDisponiveis < periodo
        ? `os primeiros ${periodo} dias da campanha (${diasCampanhaDisponiveis} já disponíveis)`
        : `os primeiros ${periodo} dias da campanha`
      : cobertura && !cobertura.possuiDadosAntesDaJanela && cobertura.diasHistoricoEncontrado < periodo
        ? `os ${cobertura.diasHistoricoEncontrado} dias com dados encontrados dentro da janela de ${periodo} dias`
        : `os últimos ${periodo} dias`
  const formatoNumero = (valor: number) => valor.toLocaleString('pt-BR')
  const estrelasLabel = typeof metricas.estrelasDistribuidas === 'number' ? formatoNumero(metricas.estrelasDistribuidas) : 'Indisponível'
  const diasComPedidos = serie.length
  const mediaPedidosDiaAtivo = diasComPedidos ? metricas.pedidosValidos / diasComPedidos : 0
  const mediaReceitaDiaAtivo = diasComPedidos ? metricas.receitaElegivelCents / diasComPedidos : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
        {[
          ['Pedidos entregues', formatoNumero(metricas.pedidosValidos), 'Contagem de pedidos entregues na janela.'],
          ['Receita elegível à fidelidade', reais(metricas.receitaElegivelCents), 'Subtotal dos pedidos menos desconto de fidelidade e taxa de entrega. É a base para regras de Estrelas, não o total bruto recebido.'],
          ['Ticket médio elegível', reais(metricas.ticketMedioCents), `${reais(metricas.receitaElegivelCents)} ÷ ${formatoNumero(metricas.pedidosValidos)} pedidos entregues.`],
          ['Clientes únicos identificados', formatoNumero(metricas.clientesUnicos), 'Cada cliente com telefone ou ID reconhecido aparece uma vez. Pedidos sem identificação ficam fora desta contagem.'],
          ['Pedidos por cliente identificado', metricas.pedidosMediosPorCliente.toLocaleString('pt-BR'), `${formatoNumero(metricas.pedidosComClienteIdentificado)} pedidos com cliente identificado ÷ ${formatoNumero(metricas.clientesUnicos)} clientes.`],
          ['Receita elegível média por cliente', reais(metricas.receitaMediaPorClienteCents), `${reais(metricas.receitaElegivelClientesIdentificadosCents)} ÷ ${formatoNumero(metricas.clientesUnicos)} clientes identificados.`],
          ['Pedidos sem cliente identificado', formatoNumero(metricas.pedidosSemClienteIdentificado), 'Pedidos entregues que entram no total de pedidos e receita, mas não permitem contar ou reconhecer o cliente.'],
          ['Estrelas creditadas', estrelasLabel, typeof metricas.estrelasDistribuidas !== 'number' ? 'Não foi possível ler o extrato de fidelidade.' : `${formatoNumero(metricas.pedidosComEstrelasRegistradas ?? 0)} pedidos com cliente identificado tiveram crédito de Estrelas confirmado.`],
        ].map(([nome, valor, explicacao]) => <div key={nome} style={card} title={explicacao}>
          <div style={label}>{nome}</div><div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
          <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.4, color: 'var(--foreground-muted)' }}>{explicacao}</div>
        </div>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={{ ...label, marginBottom: 7 }}>Retenção observada</div>
          <div style={{ fontSize: 13, color: 'var(--foreground-secondary)', lineHeight: 1.55 }}>
            <div><strong>{formatoNumero(metricas.clientesComSegundoPedido)} de {formatoNumero(metricas.clientesUnicos)} clientes ({metricas.percentualClientesComSegundoPedido}%)</strong> fizeram 2 ou mais pedidos em {periodoLabel}.</div>
            <div style={{ marginTop: 5, fontSize: 11, color: 'var(--foreground-muted)' }}>Cálculo: clientes com 2+ pedidos ÷ clientes únicos. Isso mede recompra observada, sem atribuir a causa à fidelidade.</div>
            {historicoAnteriorDisponivel
              ? <div style={{ marginTop: 8 }}><strong>{formatoNumero(metricas.clientesRecorrentes)} de {formatoNumero(metricas.clientesUnicos)} ({metricas.percentualClientesRecorrentes}%)</strong> já tinham pedido registrado antes do início da janela.</div>
              : <div style={{ marginTop: 8, padding: 9, borderRadius: 7, background: 'var(--surface-muted, rgba(127,127,127,.08))' }}><strong>Histórico anterior ainda desconhecido.</strong> Os registros começam{cobertura?.historicoEncontradoDesdeIso ? ` em ${new Date(cobertura.historicoEncontradoDesdeIso).toLocaleDateString('pt-BR')}` : ' dentro desta janela'}; por isso não dá para chamar os demais clientes de “novos” nem afirmar que não eram recorrentes.</div>}
          </div>
        </div>
        <div style={card}>
          <div style={{ ...label, marginBottom: 7 }}>O que falta para provar o retorno da fidelidade</div>
          <div style={{ fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.55 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>ROI = (lucro adicional − custo da campanha) ÷ custo da campanha.</div>
            <div>Para calcular, ainda precisamos:</div>
            <div>• margem de cada pedido (receita menos custo de ingredientes e operação);</div>
            <div>• custo real de cada presente resgatado e da operação da campanha;</div>
            <div>• comparação com um período ou grupo sem a campanha;</div>
            <div>• quantas pessoas viram, aderiram, desbloquearam e resgataram.</div>
            <div style={{ marginTop: 8, color: 'var(--attention, #7c3aed)', fontWeight: 700 }}>Até esses dados existirem, recompra e receita são observadas; lucro incremental e ROI ficam “não calculados”.</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ ...label, marginBottom: 4 }}>Ritmo diário de pedidos</div>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 8 }}>Cada barra é um dia com pedido entregue em {periodoLabel}. A altura representa a receita; a tabela mostra pedidos, clientes e valores.</div>
          {diasComPedidos > 0 && <div style={{ fontSize: 11, marginBottom: 10 }}>Média nos {diasComPedidos} dias com pedido: <strong>{mediaPedidosDiaAtivo.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} pedidos/dia</strong> · <strong>{reais(Math.round(mediaReceitaDiaAtivo))}/dia</strong>.</div>}
          {serie.length === 0 ? <div style={{ color: 'var(--foreground-muted)', fontSize: 12 }}>Sem série diária disponível.</div> : <div style={{ display: 'flex', alignItems: 'end', gap: 4, height: 150, overflowX: 'auto', paddingBottom: 22 }} aria-label="Gráfico de receita diária">
            {serie.map((item) => <div key={item.data} title={`${diaCurto(item.data)}: ${reais(item.receitaCents)} — ${item.pedidos} pedido(s)`} style={{ minWidth: 24, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'end', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 18, height: `${Math.max(5, (item.receitaCents / maxReceita) * 112)}px`, borderRadius: '4px 4px 2px 2px', background: 'var(--primary, #facc15)' }} />
              <span style={{ fontSize: 9, color: 'var(--foreground-muted)', whiteSpace: 'nowrap', transform: 'rotate(-45deg)', transformOrigin: 'center' }}>{diaCurto(item.data)}</span>
            </div>)}
          </div>}
          {serie.length > 0 && <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Ver detalhe diário ({serie.length} dias)</summary>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr><th style={{ textAlign: 'left', padding: 5 }}>Dia</th><th style={{ textAlign: 'right', padding: 5 }}>Pedidos</th><th style={{ textAlign: 'right', padding: 5 }}>Clientes</th><th style={{ textAlign: 'right', padding: 5 }}>Receita elegível</th></tr></thead>
                <tbody>{serie.map((item) => <tr key={item.data} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: 5 }}>{diaCurto(item.data)}</td><td style={{ textAlign: 'right', padding: 5 }}>{item.pedidos}</td><td style={{ textAlign: 'right', padding: 5 }}>{item.clientesUnicos}</td><td style={{ textAlign: 'right', padding: 5 }}>{reais(item.receitaCents)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>}
        </div>
        <div style={card}>
          <div style={{ ...label, marginBottom: 4 }}>Canais de venda</div>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 10 }}>Pedidos e receita elegível por origem. A porcentagem é da receita total elegível; “Painel” vem da origem gravada pelo servidor.</div>
          {canais.map(([nome, dados]) => { const percentual = metricas.receitaElegivelCents ? Math.round((dados.receitaCents / metricas.receitaElegivelCents) * 100) : 0; const pedidoIds = dados.pedidoIds ?? []; return <div key={nome} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 4 }}><span>{canalNome(nome)} · {dados.pedidos} pedido(s) · {reais(dados.receitaCents)}</span><strong>{percentual}%</strong></div>
            <div style={{ height: 7, borderRadius: 5, background: 'var(--border)' }}><div style={{ width: `${percentual}%`, height: '100%', borderRadius: 5, background: 'var(--primary, #facc15)' }} /></div>
            {nome === 'painel' && pedidoIds.length > 0 && <details style={{ marginTop: 5 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Ver IDs dos pedidos criados no painel ({pedidoIds.length})</summary>
              <div style={{ maxHeight: 150, overflow: 'auto', marginTop: 5, padding: 7, border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{pedidoIds.join(' · ')}</div>
            </details>}
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
          <div style={{ marginTop: 9, fontSize: 11, color: 'var(--foreground-muted)' }}>2+ significa repetição observada em {periodoLabel}, não adesão comprovada à fidelidade.</div>
        </div>
      </div>
    </div>
  )
}
