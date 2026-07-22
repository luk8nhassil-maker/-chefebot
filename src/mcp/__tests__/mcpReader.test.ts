import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mocks devem ser declarados antes de qualquer import que os use
const { mockLrange, mockGet, mockLlen } = vi.hoisted(() => ({
  mockLrange: vi.fn().mockResolvedValue([]),
  mockGet: vi.fn().mockResolvedValue(null),
  mockLlen: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/redis', () => ({
  redis: { lrange: mockLrange, get: mockGet, llen: mockLlen },
}));

import {
  calcularScore,
  agruparGargalos,
  verificarPii,
  calcularStatusEAlertas,
  lerDadosMcp,
} from '../lib/mcpReader';
import type { McpLogEntryObs, McpLogEntryErro } from '../types';

function obsFactory(overrides: Partial<McpLogEntryObs> = {}): McpLogEntryObs {
  return {
    ts: Date.now(),
    phoneHash: '***4821',
    stepAntes: 'inicio',
    stepDepois: 'escolhendo_pizza',
    houveMudancaStep: true,
    cartLength: 0,
    precisouIA: false,
    escalou: false,
    foiFallbackSeco: false,
    padraoObservado: 'avanco_normal',
    confiancaEstrutura: 0.9,
    ...overrides,
  };
}

function erroFactory(overrides: Partial<McpLogEntryErro> = {}): McpLogEntryErro {
  return {
    ts: Date.now(),
    origem: 'test',
    mensagem: 'timeout de conexão',
    ...overrides,
  };
}

beforeEach(() => {
  mockLrange.mockReset().mockResolvedValue([]);
  mockGet.mockReset().mockResolvedValue(null);
  mockLlen.mockReset().mockResolvedValue(0);
});

// ─── calcularScore ───────────────────────────────────────────────────────────

describe('calcularScore — volume', () => {
  it('T2a: lista vazia → 0 pontos de volume', () => {
    const s = calcularScore([], []);
    expect(s.volume).toBe(0);
    expect(s.total).toBe(0);
  });

  it('T2b: 200 obs → 30 pontos de volume', () => {
    const obs = Array.from({ length: 200 }, () => obsFactory());
    const s = calcularScore(obs, []);
    expect(s.volume).toBe(30);
  });

  it('T2c: 100 obs → 15 pontos de volume (proporcional)', () => {
    const obs = Array.from({ length: 100 }, () => obsFactory());
    const s = calcularScore(obs, []);
    expect(s.volume).toBe(15);
  });

  it('T2d: mais de 200 obs → não ultrapassa 30', () => {
    const obs = Array.from({ length: 400 }, () => obsFactory());
    const s = calcularScore(obs, []);
    expect(s.volume).toBe(30);
  });
});

describe('calcularScore — qualidade', () => {
  it('T3a: confiancaEstrutura 1.0 → 30 pontos de qualidade', () => {
    const obs = [obsFactory({ confiancaEstrutura: 1.0 })];
    const s = calcularScore(obs, []);
    expect(s.qualidade).toBe(30);
  });

  it('T3b: confiancaEstrutura 0.0 → 0 pontos de qualidade', () => {
    const obs = [obsFactory({ confiancaEstrutura: 0.0, padraoObservado: 'desconhecido' })];
    const s = calcularScore(obs, []);
    expect(s.qualidade).toBe(0);
  });

  it('T3c: mix de confiancas → média refletida', () => {
    const obs = [
      obsFactory({ confiancaEstrutura: 1.0 }),
      obsFactory({ confiancaEstrutura: 0.0, padraoObservado: 'desconhecido' }),
    ];
    const s = calcularScore(obs, []);
    // Média = 0.5 → 0.5 * 30 = 15
    expect(s.qualidade).toBe(15);
  });
});

describe('calcularScore — diversidade', () => {
  it('T4a: 7 padrões distintos → 20 pontos', () => {
    const padroes = [
      'avanco_normal', 'interpretacao_ok', 'sem_mudanca',
      'confusao_simples', 'confusao_com_escalacao', 'escalacao_direta', 'desconhecido',
    ] as const;
    const obs = padroes.map(p => obsFactory({ padraoObservado: p }));
    const s = calcularScore(obs, []);
    expect(s.diversidade).toBe(20);
  });

  it('T4b: 1 padrão único → ~3 pontos', () => {
    const obs = [obsFactory({ padraoObservado: 'avanco_normal' })];
    const s = calcularScore(obs, []);
    expect(s.diversidade).toBe(Math.round((1 / 7) * 20));
  });

  it('T4c: lista vazia → 0 pontos de diversidade', () => {
    const s = calcularScore([], []);
    expect(s.diversidade).toBe(0);
  });
});

describe('calcularScore — saúde', () => {
  it('T5a: zero erros → 20 pontos', () => {
    const obs = [obsFactory()];
    const s = calcularScore(obs, []);
    expect(s.saude).toBe(20);
  });

  it('T5b: 1 erro em 2 obs (50%) → 10 pontos', () => {
    const obs = [obsFactory(), obsFactory()];
    const erros = [erroFactory()];
    const s = calcularScore(obs, erros);
    expect(s.saude).toBe(10);
  });

  it('T5c: 100% de erros → 0 pontos de saúde', () => {
    const obs = [obsFactory()];
    const erros = [erroFactory(), erroFactory()];
    const s = calcularScore(obs, erros);
    expect(s.saude).toBe(0);
  });

  it('T5d: zero obs com erros → 20 pontos (não penaliza vazio)', () => {
    const s = calcularScore([], [erroFactory()]);
    expect(s.saude).toBe(20);
  });
});

describe('calcularScore — total', () => {
  it('T6a: score não ultrapassa 100', () => {
    const obs = Array.from({ length: 500 }, (_, i) => obsFactory({
      confiancaEstrutura: 1.0,
      padraoObservado: (['avanco_normal', 'interpretacao_ok', 'sem_mudanca',
        'confusao_simples', 'confusao_com_escalacao', 'escalacao_direta', 'desconhecido'] as const)[i % 7],
    }));
    const s = calcularScore(obs, []);
    expect(s.total).toBeLessThanOrEqual(100);
  });

  it('T6b: estado completamente vazio → total 0', () => {
    const s = calcularScore([], []);
    expect(s.total).toBe(0);
  });
});

// ─── agruparGargalos ─────────────────────────────────────────────────────────

describe('agruparGargalos', () => {
  it('T9a: step com escalou=true é contado como problema', () => {
    const obs = [
      obsFactory({ stepAntes: 'checkout', escalou: true }),
      obsFactory({ stepAntes: 'checkout', escalou: true }),
      obsFactory({ stepAntes: 'checkout', escalou: false }),
    ];
    const g = agruparGargalos(obs);
    expect(g).toHaveLength(1);
    expect(g[0].step).toBe('checkout');
    expect(g[0].problemasCount).toBe(2);
    expect(g[0].taxaProblema).toBeCloseTo(2 / 3);
  });

  it('T9b: step com foiFallbackSeco=true é contado como problema', () => {
    const obs = [
      obsFactory({ stepAntes: 'flavor', foiFallbackSeco: true }),
      obsFactory({ stepAntes: 'flavor', foiFallbackSeco: false }),
      obsFactory({ stepAntes: 'flavor', foiFallbackSeco: false }),
    ];
    const g = agruparGargalos(obs);
    expect(g[0].problemasCount).toBe(1);
  });

  it('T9c: step com menos de 3 eventos é filtrado', () => {
    const obs = [
      obsFactory({ stepAntes: 'raro', escalou: true }),
      obsFactory({ stepAntes: 'raro', escalou: true }),
    ];
    const g = agruparGargalos(obs);
    expect(g).toHaveLength(0);
  });

  it('T9d: resultado ordenado por taxaProblema decrescente', () => {
    const obs = [
      ...Array.from({ length: 3 }, () => obsFactory({ stepAntes: 'A', escalou: true })),
      ...Array.from({ length: 3 }, () => obsFactory({ stepAntes: 'B', escalou: false })),
    ];
    const g = agruparGargalos(obs);
    expect(g[0].step).toBe('A');
    expect(g[0].taxaProblema).toBeGreaterThan(g[1]?.taxaProblema ?? -1);
  });

  it('T9e: lista vazia retorna array vazio', () => {
    expect(agruparGargalos([])).toEqual([]);
  });
});

// ─── verificarPii ─────────────────────────────────────────────────────────────

describe('verificarPii', () => {
  it('T10a: phoneHash no formato correto → phoneHashOk=true', () => {
    const obs = [obsFactory({ phoneHash: '***4821' })];
    const r = verificarPii(obs, []);
    expect(r.phoneHashOk).toBe(true);
  });

  it('T10b: phoneHash cru (sem ***) → phoneHashOk=false, ok=false', () => {
    const obs = [obsFactory({ phoneHash: '5511999887766' })];
    const r = verificarPii(obs, []);
    expect(r.phoneHashOk).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('T10c: step com sequência de dígitos → semDadosCrus=false', () => {
    const obs = [obsFactory({ stepAntes: '55119988776600' })];
    const r = verificarPii(obs, []);
    expect(r.semDadosCrus).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('T10d: erro com telefone cru → semDadosCrus=false', () => {
    const erros = [erroFactory({ mensagem: 'erro com 55119988776600' })];
    const r = verificarPii([], erros);
    expect(r.semDadosCrus).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('T10e: erro com valor monetário → semValorMonetario=false', () => {
    const erros = [erroFactory({ mensagem: 'falha ao processar R$ 49,90' })];
    const r = verificarPii([], erros);
    expect(r.semValorMonetario).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('T10f: dados limpos → ok=true', () => {
    const obs = [obsFactory({ phoneHash: '***7702' })];
    const erros = [erroFactory({ mensagem: 'timeout de conexão' })];
    const r = verificarPii(obs, erros);
    expect(r.ok).toBe(true);
  });
});

// ─── lerDadosMcp ─────────────────────────────────────────────────────────────

describe('lerDadosMcp — estado vazio', () => {
  it('T1: retorna score 0, arrays vazios e piiCheck.ok=true quando Redis vazio', async () => {
    const d = await lerDadosMcp();
    expect(d.obsCount).toBe(0);
    expect(d.filaCount).toBe(0);
    expect(d.errosCount).toBe(0);
    expect(d.scoreMaturidade.total).toBe(0);
    expect(d.gargalos).toEqual([]);
    expect(d.ultimasObs).toEqual([]);
    expect(d.ultimosErros).toEqual([]);
    expect(d.cronMeta).toBeNull();
    expect(d.piiCheck.ok).toBe(true);
    expect(d.prontoParaFase2).toBe(false);
  });
});

describe('lerDadosMcp — Redis indisponível', () => {
  it('T17: erro no Redis (env ausente/timeout/credenciais inválidas) não propaga — retorna estado vazio seguro', async () => {
    mockLrange.mockRejectedValue(new Error('ECONNREFUSED: Redis indisponível'));
    mockGet.mockRejectedValue(new Error('ECONNREFUSED: Redis indisponível'));
    mockLlen.mockRejectedValue(new Error('ECONNREFUSED: Redis indisponível'));

    const d = await lerDadosMcp();

    expect(d.obsCount).toBe(0);
    expect(d.filaCount).toBe(0);
    expect(d.errosCount).toBe(0);
    expect(d.scoreMaturidade).toEqual({ total: 0, volume: 0, qualidade: 0, diversidade: 0, saude: 0 });
    expect(d.gargalos).toEqual([]);
    expect(d.ultimasObs).toEqual([]);
    expect(d.ultimosErros).toEqual([]);
    expect(d.cronMeta).toBeNull();
    expect(d.piiCheck.ok).toBe(true);
    expect(d.prontoParaFase2).toBe(false);
  });
});

describe('lerDadosMcp — com dados', () => {
  it('T7: retorna no máximo 50 ultimas observações', async () => {
    const obs = Array.from({ length: 100 }, () => obsFactory());
    mockLrange.mockImplementation((key: string) => {
      if (key === 'mcp:log:obs') return Promise.resolve(obs.map(o => JSON.stringify(o)));
      return Promise.resolve([]);
    });
    const d = await lerDadosMcp();
    expect(d.ultimasObs.length).toBeLessThanOrEqual(50);
  });

  it('T8: filaCount reflete comprimento da fila sem expor conteúdo de eventos', async () => {
    const filaItens = Array.from({ length: 5 }, (_, i) => JSON.stringify({
      phoneHash: `***000${i}`,
      msgId: `msg${i}`,
      stepAntes: 'inicio',
      stepDepois: 'inicio',
      houveMudancaStep: false,
      cartLength: 0,
      precisouIA: false,
      escalou: false,
      foiFallbackSeco: false,
      timestamp: Date.now(),
    }));
    mockLrange.mockImplementation((key: string) => {
      if (key === 'mcp:fila:eventos') return Promise.resolve(filaItens.slice(0, 1)); // só o peek do mais antigo
      return Promise.resolve([]);
    });
    mockLlen.mockImplementation((key: string) => (key === 'mcp:fila:eventos' ? Promise.resolve(5) : Promise.resolve(0)));
    const d = await lerDadosMcp();
    // filaCount vem de LLEN — o conteúdo dos eventos não é retornado em ultimasObs
    expect(d.filaCount).toBe(5);
    // ultimasObs vem de mcp:log:obs, não da fila crua
    expect(d.ultimasObs).toEqual([]);
  });
});

// ─── calcularStatusEAlertas ─────────────────────────────────────────────────

describe('calcularStatusEAlertas', () => {
  const base = {
    filaAtual: 0,
    idadeEventoMaisAntigoMin: null as number | null,
    ultimaExecucaoFinishedAt: Date.now(),
    agora: Date.now(),
    dentroPeriodoPico: false,
  };

  it('fila baixa e execução recente → saudavel, sem alertas', () => {
    const r = calcularStatusEAlertas(base);
    expect(r.status).toBe('saudavel');
    expect(r.alertas).toEqual([]);
  });

  it('fila acima de 500 → atencao', () => {
    const r = calcularStatusEAlertas({ ...base, filaAtual: 600 });
    expect(r.status).toBe('atrasado');
    expect(r.alertas.some(a => a.nivel === 'atencao')).toBe(true);
  });

  it('evento esperando mais de 20min → atencao', () => {
    const r = calcularStatusEAlertas({ ...base, idadeEventoMaisAntigoMin: 25 });
    expect(r.alertas.some(a => a.nivel === 'atencao')).toBe(true);
  });

  it('fila acima de 2000 → critico (não duplica atencao)', () => {
    const r = calcularStatusEAlertas({ ...base, filaAtual: 2500 });
    expect(r.status).toBe('atrasado');
    expect(r.alertas.filter(a => a.nivel === 'critico')).toHaveLength(1);
    expect(r.alertas.some(a => a.nivel === 'atencao')).toBe(false);
  });

  it('evento esperando mais de 60min → critico', () => {
    const r = calcularStatusEAlertas({ ...base, idadeEventoMaisAntigoMin: 65 });
    expect(r.alertas.some(a => a.nivel === 'critico')).toBe(true);
  });

  it('fila próxima do limite (>=9000 de 10000) → saturado', () => {
    const r = calcularStatusEAlertas({ ...base, filaAtual: 9500 });
    expect(r.status).toBe('saturado');
    expect(r.alertas.some(a => a.nivel === 'saturado')).toBe(true);
  });

  it('sem execução há mais de 20min durante período de pico → ausencia_execucao', () => {
    const agora = Date.now();
    const r = calcularStatusEAlertas({
      ...base,
      agora,
      dentroPeriodoPico: true,
      ultimaExecucaoFinishedAt: agora - 30 * 60_000,
    });
    expect(r.alertas.some(a => a.nivel === 'ausencia_execucao')).toBe(true);
    expect(r.status).toBe('atrasado');
  });

  it('nunca executou e está em período de pico → ausencia_execucao', () => {
    const r = calcularStatusEAlertas({ ...base, dentroPeriodoPico: true, ultimaExecucaoFinishedAt: null });
    expect(r.alertas.some(a => a.nivel === 'ausencia_execucao')).toBe(true);
  });

  it('fora do período de pico, sem execução recente → não alerta ausência', () => {
    const agora = Date.now();
    const r = calcularStatusEAlertas({
      ...base,
      agora,
      dentroPeriodoPico: false,
      ultimaExecucaoFinishedAt: agora - 10 * 60 * 60_000,
    });
    expect(r.alertas.some(a => a.nivel === 'ausencia_execucao')).toBe(false);
  });
});

// ─── capacidade e elegibilidade (via lerDadosMcp) ───────────────────────────

describe('lerDadosMcp — capacidade', () => {
  it('idade do evento mais antigo calculada a partir do timestamp do 1º item da fila', async () => {
    const agora = Date.now();
    const antigo = { ...obsFactory(), timestamp: agora - 30 * 60_000 } as unknown as Record<string, unknown>;
    mockLrange.mockImplementation((key: string) => {
      if (key === 'mcp:fila:eventos') return Promise.resolve([JSON.stringify(antigo)]);
      return Promise.resolve([]);
    });
    mockLlen.mockResolvedValue(3);
    const d = await lerDadosMcp();
    expect(d.capacidade.idadeEventoMaisAntigoMin).toBeGreaterThanOrEqual(29);
    expect(d.capacidade.idadeEventoMaisAntigoMin).toBeLessThanOrEqual(31);
  });

  it('fila vazia → idade do evento mais antigo é null', async () => {
    mockLlen.mockResolvedValue(0);
    const d = await lerDadosMcp();
    expect(d.capacidade.idadeEventoMaisAntigoMin).toBeNull();
  });

  it('cobertura estimada combina processados24h e descartados', async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'mcp:meta:fila:descartados') return Promise.resolve(10);
      return Promise.resolve(null);
    });
    mockLrange.mockImplementation((key: string) => {
      if (key === 'mcp:meta:cron:historico') {
        return Promise.resolve([JSON.stringify({ ts: Date.now(), processed: 90, errors: 0 })]);
      }
      return Promise.resolve([]);
    });
    const d = await lerDadosMcp();
    expect(d.capacidade.coberturaEstimada).toBeCloseTo(90 / 100, 5);
  });

  it('sem processados nem descartados → cobertura null (dado insuficiente)', async () => {
    const d = await lerDadosMcp();
    expect(d.capacidade.coberturaEstimada).toBeNull();
  });

  it('backlog e erros das últimas 24h somam apenas execuções dentro da janela', async () => {
    const agora = Date.now();
    mockLrange.mockImplementation((key: string) => {
      if (key === 'mcp:meta:cron:historico') {
        return Promise.resolve([
          JSON.stringify({ ts: agora - 2 * 60 * 60_000, processed: 40, errors: 1 }), // dentro de 24h
          JSON.stringify({ ts: agora - 30 * 60 * 60_000, processed: 999, errors: 999 }), // fora da janela
        ]);
      }
      return Promise.resolve([]);
    });
    const d = await lerDadosMcp();
    expect(d.capacidade.processados24h).toBe(40);
    expect(d.capacidade.erros24h).toBe(1);
  });

  it('Redis indisponível → status indisponivel', async () => {
    mockLrange.mockRejectedValue(new Error('down'));
    mockGet.mockRejectedValue(new Error('down'));
    mockLlen.mockRejectedValue(new Error('down'));
    const d = await lerDadosMcp();
    expect(d.capacidade.status).toBe('indisponivel');
  });
});

describe('lerDadosMcp — elegibilidade para Modo de Sugestões', () => {
  it('sem nenhum critério atendido → não elegível', async () => {
    const d = await lerDadosMcp();
    expect(d.elegibilidade.elegivel).toBe(false);
  });

  it('todos os critérios atendidos → elegível', async () => {
    const agora = Date.now();
    mockGet.mockImplementation((key: string) => {
      if (key === 'mcp:meta:fila:descartados') return Promise.resolve(0);
      if (key === 'mcp:meta:fds:historico') return Promise.resolve(['2026-01-03', '2026-01-10', '2026-01-17']);
      if (key === 'mcp:meta:processados:total') return Promise.resolve(600);
      return Promise.resolve(null);
    });
    mockLrange.mockImplementation((key: string) => {
      if (key === 'mcp:meta:cron:historico') {
        return Promise.resolve([JSON.stringify({ ts: agora, processed: 100, errors: 0 })]);
      }
      return Promise.resolve([]);
    });
    mockLlen.mockResolvedValue(10); // fila normalizada (< 500)
    const d = await lerDadosMcp();
    expect(d.elegibilidade.elegivel).toBe(true);
    expect(d.elegibilidade.criterios.every(c => c.ok)).toBe(true);
  });

  it('fila ainda alta (não normalizou depois do pico) bloqueia elegibilidade mesmo com resto ok', async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'mcp:meta:fds:historico') return Promise.resolve(['a', 'b', 'c']);
      if (key === 'mcp:meta:processados:total') return Promise.resolve(600);
      return Promise.resolve(null);
    });
    mockLlen.mockResolvedValue(800); // acima do limiar de 500
    const d = await lerDadosMcp();
    const criterioFila = d.elegibilidade.criterios.find(c => c.chave === 'fila_normalizada');
    expect(criterioFila?.ok).toBe(false);
    expect(d.elegibilidade.elegivel).toBe(false);
  });
});
