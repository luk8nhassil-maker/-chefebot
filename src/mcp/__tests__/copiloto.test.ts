import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockRpush, mockLtrim, mockExpire, mockLrange, mockDel } = vi.hoisted(() => ({
  mockRpush:  vi.fn().mockResolvedValue(1),
  mockLtrim:  vi.fn().mockResolvedValue('OK'),
  mockExpire: vi.fn().mockResolvedValue(1),
  mockLrange: vi.fn().mockResolvedValue([]),
  mockDel:    vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/redis', () => ({
  redis: {
    rpush:  mockRpush,
    ltrim:  mockLtrim,
    expire: mockExpire,
    lrange: mockLrange,
    del:    mockDel,
  },
}));

import {
  filtrarPorPeriodo,
  agregarPorStep,
  gerarSugestoesCandidatas,
} from '../modes/copiloto';
import type { McpLogEntryObs } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function obs(overrides: Partial<McpLogEntryObs> = {}): McpLogEntryObs {
  return {
    ts:                Date.now(),
    phoneHash:         '***0001',
    stepAntes:         'flavor',
    stepDepois:        'flavor',
    houveMudancaStep:  false,
    cartLength:        1,
    precisouIA:        false,
    escalou:           false,
    foiFallbackSeco:   false,
    padraoObservado:   'avanco_normal',
    confiancaEstrutura: 0.9,
    ...overrides,
  };
}

function lote(
  step: string,
  padrao: McpLogEntryObs['padraoObservado'],
  confianca: number,
  n: number,
  tsBase = Date.now(),
): McpLogEntryObs[] {
  return Array.from({ length: n }, (_, i) =>
    obs({ stepAntes: step, padraoObservado: padrao, confiancaEstrutura: confianca, ts: tsBase + i }),
  );
}

beforeEach(() => {
  mockRpush.mockClear();
  mockLtrim.mockClear();
  mockExpire.mockClear();
  mockLrange.mockClear();
  mockDel.mockClear();
});

// ── filtrarPorPeriodo ────────────────────────────────────────────────────────

describe('filtrarPorPeriodo', () => {
  it('exclui entradas além do período', () => {
    const agora = Date.now();
    const dentro = obs({ ts: agora - 12 * 3600 * 1000 });
    const fora   = obs({ ts: agora - 25 * 3600 * 1000 });
    expect(filtrarPorPeriodo([dentro, fora], '24h', agora)).toStrictEqual([dentro]);
  });

  it('inclui entrada exatamente no limite', () => {
    const agora = Date.now();
    const noLimite = obs({ ts: agora - 7 * 24 * 3600 * 1000 + 1 });
    expect(filtrarPorPeriodo([noLimite], '7d', agora)).toHaveLength(1);
  });

  it('retorna vazio quando todas as entradas estão fora do período', () => {
    const agora = Date.now();
    const velha = obs({ ts: agora - 31 * 24 * 3600 * 1000 });
    expect(filtrarPorPeriodo([velha], '24h', agora)).toHaveLength(0);
  });
});

// ── agregarPorStep ───────────────────────────────────────────────────────────

describe('agregarPorStep', () => {
  it('agrupa corretamente por stepAntes', () => {
    const entradas = [
      ...lote('flavor', 'avanco_normal', 0.9, 3),
      ...lote('size',   'confusao_simples', 0.85, 2),
    ];
    const mapa = agregarPorStep(entradas);
    expect(mapa.has('flavor')).toBe(true);
    expect(mapa.has('size')).toBe(true);
    expect(mapa.get('flavor')!.totalEventos).toBe(3);
    expect(mapa.get('size')!.totalEventos).toBe(2);
  });

  it('retorna mapa vazio para lista vazia', () => {
    expect(agregarPorStep([])).toEqual(new Map());
  });

  it('totalEventos bate com o número de entradas', () => {
    const entradas = lote('welcome', 'avanco_normal', 0.9, 7);
    const mapa = agregarPorStep(entradas);
    expect(mapa.get('welcome')!.totalEventos).toBe(7);
    expect(mapa.get('welcome')!.entradas).toHaveLength(7);
  });
});

// ── gerarSugestoesCandidatas — thresholds ───────────────────────────────────

describe('gerarSugestoesCandidatas — volume baixo não gera sugestão', () => {
  it('não gera quando totalEventos < 20', () => {
    // 15 eventos total, 6 confusoes — volume insuficiente
    const entradas = [
      ...lote('flavor', 'avanco_normal',   0.9,  9),
      ...lote('flavor', 'confusao_simples', 0.85, 6),
    ];
    const agregados = agregarPorStep(entradas);
    expect(gerarSugestoesCandidatas(agregados, '7d')).toHaveLength(0);
  });

  it('não gera quando problemas < 3', () => {
    // 25 total, mas só 2 confusao_simples
    const entradas = [
      ...lote('flavor', 'avanco_normal',   0.9,  23),
      ...lote('flavor', 'confusao_simples', 0.85,  2),
    ];
    const agregados = agregarPorStep(entradas);
    expect(gerarSugestoesCandidatas(agregados, '7d')).toHaveLength(0);
  });
});

describe('gerarSugestoesCandidatas — confiança baixa não gera sugestão', () => {
  it('não gera quando confiancaMedia < 0.75', () => {
    // 25 total, 8 confusao_simples com confiança 0.5 (abaixo do threshold)
    const entradas = [
      ...lote('flavor', 'avanco_normal',    0.9,  17),
      ...lote('flavor', 'confusao_simples', 0.5,   8),
    ];
    const agregados = agregarPorStep(entradas);
    expect(gerarSugestoesCandidatas(agregados, '7d')).toHaveLength(0);
  });
});

describe('gerarSugestoesCandidatas — confusão recorrente gera sugestão', () => {
  it('gera confusao_recorrente quando todos os thresholds são atingidos', () => {
    // 25 total, 6 confusao_simples (0.85) → passa em todos os checks
    const entradas = [
      ...lote('flavor', 'avanco_normal',    0.9,  19),
      ...lote('flavor', 'confusao_simples', 0.85,  6),
    ];
    const agregados = agregarPorStep(entradas);
    const sugestoes = gerarSugestoesCandidatas(agregados, '7d');

    const s = sugestoes.find(x => x.tipo === 'confusao_recorrente');
    expect(s).toBeDefined();
    expect(s!.step).toBe('flavor');
    expect(s!.periodo).toBe('7d');
    expect(s!.confianca).toBeGreaterThanOrEqual(0.75);
    expect(s!.evidencia.problemas).toBe(6);
    expect(s!.evidencia.totalEventos).toBe(25);
    expect(s!.resumo).toContain('flavor');
  });

  it('gera escalacao_frequente para padrão escalacao_direta recorrente', () => {
    const entradas = [
      ...lote('confirm', 'avanco_normal',   0.9,  17),
      ...lote('confirm', 'escalacao_direta', 0.9,   5),
    ];
    const agregados = agregarPorStep(entradas);
    const sugestoes = gerarSugestoesCandidatas(agregados, '24h');

    const s = sugestoes.find(x => x.tipo === 'escalacao_frequente');
    expect(s).toBeDefined();
    expect(s!.step).toBe('confirm');
  });

  it('gera necessidade_ia_frequente para interpretacao_ok recorrente', () => {
    const entradas = [
      ...lote('size', 'avanco_normal',    0.9,  16),
      ...lote('size', 'interpretacao_ok', 0.8,   5),
    ];
    const agregados = agregarPorStep(entradas);
    const sugestoes = gerarSugestoesCandidatas(agregados, '30d');

    const s = sugestoes.find(x => x.tipo === 'necessidade_ia_frequente');
    expect(s).toBeDefined();
    expect(s!.confianca).toBeGreaterThanOrEqual(0.75);
  });

  it('severidade alta quando taxaProblema > 0.5', () => {
    // 15/25 = 0.6 → 'alta'
    const entradas = [
      ...lote('border_escolha', 'avanco_normal',          0.9,  10),
      ...lote('border_escolha', 'confusao_com_escalacao', 1.0,  15),
    ];
    const agregados = agregarPorStep(entradas);
    const sugestoes = gerarSugestoesCandidatas(agregados, '7d');

    const s = sugestoes.find(x => x.tipo === 'confusao_recorrente');
    expect(s!.severidade).toBe('alta');
  });

  it('severidade media quando taxaProblema entre 0.25 e 0.5', () => {
    // 8/25 = 0.32 → 'media'
    const entradas = [
      ...lote('delivery_type', 'avanco_normal',   0.9,  17),
      ...lote('delivery_type', 'confusao_simples', 0.85,  8),
    ];
    const agregados = agregarPorStep(entradas);
    const sugestoes = gerarSugestoesCandidatas(agregados, '7d');

    const s = sugestoes.find(x => x.tipo === 'confusao_recorrente');
    expect(s!.severidade).toBe('media');
  });

  it('ordena por severidade decrescente', () => {
    // stepA: 10/25 = 0.4 → media; stepB: 16/25 = 0.64 → alta
    const entradas = [
      ...lote('stepA', 'avanco_normal',    0.9,  15),
      ...lote('stepA', 'confusao_simples', 0.85, 10),
      ...lote('stepB', 'avanco_normal',    0.9,   9),
      ...lote('stepB', 'confusao_com_escalacao', 1.0, 16),
    ];
    const agregados = agregarPorStep(entradas);
    const sugestoes = gerarSugestoesCandidatas(agregados, '7d');

    expect(sugestoes[0].severidade).toBe('alta');
  });
});

// ── GET /api/cron/mcp-copiloto — flag off ───────────────────────────────────

describe('GET /api/cron/mcp-copiloto', () => {
  it('retorna 401 sem Authorization header', async () => {
    process.env.CRON_SECRET = 'secret-test';
    const { GET } = await import('../../app/api/cron/mcp-copiloto/route');
    const req = new Request('http://localhost/api/cron/mcp-copiloto');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('retorna inativo quando MCP_COPILOTO_MODE e MCP_MODE estão ausentes', async () => {
    process.env.CRON_SECRET = 'secret-test';
    const saved = { mode: process.env.MCP_MODE, copiloto: process.env.MCP_COPILOTO_MODE };
    delete process.env.MCP_MODE;
    delete process.env.MCP_COPILOTO_MODE;

    const { GET } = await import('../../app/api/cron/mcp-copiloto/route');
    const req = new Request('http://localhost/api/cron/mcp-copiloto', {
      headers: { authorization: 'Bearer secret-test' },
    });
    const res = await GET(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.motivo).toBe('mcp copiloto inativo');

    if (saved.mode)     process.env.MCP_MODE           = saved.mode;
    if (saved.copiloto) process.env.MCP_COPILOTO_MODE  = saved.copiloto;
  });
});
