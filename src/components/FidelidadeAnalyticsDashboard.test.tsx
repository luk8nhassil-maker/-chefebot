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
        pedidosSemClienteIdentificado: 0,
        pedidosComClienteIdentificado: 4,
        receitaElegivelClientesIdentificadosCents: 20000,
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
        pedidosComEstrelasRegistradas: 3,
        percentualReceitaRecorrentes: 50,
        cohortePorPedidos: { '1': 2, '2': 1 },
        serieDiaria: [{ data: '2026-09-22', pedidos: 4, receitaCents: 20000, clientesUnicos: 3 }],
        porCanal: { painel: { pedidos: 1, receitaCents: 5000, pedidoIds: ['P-100'] }, app: { pedidos: 3, receitaCents: 15000 }, whatsapp: { pedidos: 0, receitaCents: 0 }, salao: { pedidos: 0, receitaCents: 0 }, desconhecido: { pedidos: 0, receitaCents: 0 } },
      }}
    />);

    expect(screen.getByText('Receita elegível à fidelidade')).toBeInTheDocument();
    expect(screen.getByText('Retenção observada')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === '1 de 3 clientes (33%)')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Até esses dados existirem, registre também a data e o custo real do prêmio. Sem isso o ROI fica indisponível.')).toBeInTheDocument();
    expect(screen.getByLabelText('Gráfico de receita diária')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Pedido criado no painel · 1 pedido(s) · R$ 50,00 · 25% da receita elegível')).toBeInTheDocument();
    expect(screen.getByText('Ver IDs dos pedidos criados no painel (1)')).toBeInTheDocument();
    expect(screen.getByText('Histórico anterior ainda desconhecido.')).toBeInTheDocument();
  });
});
