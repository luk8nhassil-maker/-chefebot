// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FidelidadeAnalyticsDashboard from './FidelidadeAnalyticsDashboard';

describe('FidelidadeAnalyticsDashboard', () => {
  it('mostra métricas comerciais e deixa ROI indisponível sem regra de margem', () => {
    render(<FidelidadeAnalyticsDashboard
      periodo={30}
      metricas={{
        pedidosValidos: 4,
        receitaElegivelCents: 20000,
        ticketMedioCents: 5000,
        clientesUnicos: 3,
        clientesNovos: 2,
        clientesRecorrentes: 1,
        percentualClientesRecorrentes: 33,
        clientesComSegundoPedido: 1,
        percentualClientesComSegundoPedido: 33,
        pedidosMediosPorCliente: 1.33,
        receitaMediaPorClienteCents: 6667,
        estrelasDistribuidas: 12,
        percentualReceitaRecorrentes: 50,
        cohortePorPedidos: { '1': 2, '2': 1 },
        serieDiaria: [{ data: '2026-09-22', pedidos: 4, receitaCents: 20000, clientesUnicos: 3 }],
        porCanal: { app: { pedidos: 4, receitaCents: 20000 }, whatsapp: { pedidos: 0, receitaCents: 0 }, salao: { pedidos: 0, receitaCents: 0 }, desconhecido: { pedidos: 0, receitaCents: 0 } },
      }}
    />);

    expect(screen.getByText('Receita elegível')).toBeInTheDocument();
    expect(screen.getByText('Retenção observada')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === '1 clientes fizeram segunda compra no período (33%).')).toBeInTheDocument();
    expect(screen.getByText('ROI, lucro incremental e custo por cliente ainda não são calculáveis.')).toBeInTheDocument();
    expect(screen.getByLabelText('Gráfico de receita diária')).toBeInTheDocument();
  });
});
