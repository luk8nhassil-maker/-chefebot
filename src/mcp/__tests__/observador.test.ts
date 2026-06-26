import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockRpush, mockLtrim, mockExpire } = vi.hoisted(() => ({
  mockRpush: vi.fn().mockResolvedValue(1),
  mockLtrim: vi.fn().mockResolvedValue('OK'),
  mockExpire: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/redis', () => ({
  redis: { rpush: mockRpush, ltrim: mockLtrim, expire: mockExpire },
}));

import { classificarPadrao, processarEventoObservador } from '../modes/observador';
import type { McpEventoFila } from '../types';

function evento(overrides: Partial<McpEventoFila> = {}): McpEventoFila {
  return {
    phoneHash: '***4821',
    msgId: 'X',
    stepAntes: 'flavor',
    stepDepois: 'flavor',
    houveMudancaStep: false,
    cartLength: 1,
    precisouIA: false,
    escalou: false,
    foiFallbackSeco: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  mockRpush.mockClear();
  mockLtrim.mockClear();
  mockExpire.mockClear();
});

describe('classificarPadrao — 8 casos da tabela do plano', () => {
  it('avanco_normal: step mudou, sem IA, sem fallback', () => {
    expect(classificarPadrao(evento({
      stepAntes: 'flavor', stepDepois: 'border_escolha',
      houveMudancaStep: true, precisouIA: false, escalou: false, foiFallbackSeco: false,
    }))).toBe('avanco_normal');
  });

  it('interpretacao_ok: step mudou, precisou IA, sem fallback', () => {
    expect(classificarPadrao(evento({
      stepAntes: 'flavor', stepDepois: 'border_escolha',
      houveMudancaStep: true, precisouIA: true, escalou: false, foiFallbackSeco: false,
    }))).toBe('interpretacao_ok');
  });

  it('confusao_simples: fallback seco sem escalação', () => {
    expect(classificarPadrao(evento({
      stepAntes: 'border_escolha', stepDepois: 'border_escolha',
      houveMudancaStep: false, precisouIA: false, escalou: false, foiFallbackSeco: true,
    }))).toBe('confusao_simples');
  });

  it('confusao_com_escalacao: fallback seco E escalação', () => {
    expect(classificarPadrao(evento({
      stepAntes: 'border_escolha', stepDepois: 'escalado',
      houveMudancaStep: true, precisouIA: false, escalou: true, foiFallbackSeco: true,
    }))).toBe('confusao_com_escalacao');
  });

  it('escalacao_direta: escalação sem fallback seco', () => {
    expect(classificarPadrao(evento({
      stepAntes: 'confirm', stepDepois: 'escalado',
      houveMudancaStep: true, precisouIA: false, escalou: true, foiFallbackSeco: false,
    }))).toBe('escalacao_direta');
  });

  it('sem_mudanca: step igual, sem sinal de problema', () => {
    expect(classificarPadrao(evento({
      stepAntes: 'delivery_type', stepDepois: 'delivery_type',
      houveMudancaStep: false, precisouIA: false, escalou: false, foiFallbackSeco: false,
    }))).toBe('sem_mudanca');
  });

  it('sem_mudanca: done sem sinal de problema', () => {
    expect(classificarPadrao(evento({
      stepAntes: 'done', stepDepois: 'done',
      houveMudancaStep: false, precisouIA: false, escalou: false, foiFallbackSeco: false,
    }))).toBe('sem_mudanca');
  });

  it('confusao_simples: welcome + IA + fallback sem mudança (foiFallbackSeco prevalece)', () => {
    // foiFallbackSeco:true + !escalou → confusao_simples independente de precisouIA
    expect(classificarPadrao(evento({
      stepAntes: 'welcome', stepDepois: 'welcome',
      houveMudancaStep: false, precisouIA: true, escalou: false, foiFallbackSeco: true,
    }))).toBe('confusao_simples');
  });

  it('desconhecido: IA chamada mas sem progresso, sem fallback, sem escalação', () => {
    // IA foi usada mas step não mudou e não houve sinal de erro — estado ambíguo
    expect(classificarPadrao(evento({
      stepAntes: 'size', stepDepois: 'size',
      houveMudancaStep: false, precisouIA: true, escalou: false, foiFallbackSeco: false,
    }))).toBe('desconhecido');
  });
});

describe('confiancaEstrutura — valores esperados', () => {
  const casos: Array<[Parameters<typeof evento>[0], number]> = [
    [{ houveMudancaStep: true, escalou: false, foiFallbackSeco: false, precisouIA: false }, 0.9],
    [{ houveMudancaStep: true, precisouIA: true, escalou: false, foiFallbackSeco: false }, 0.8],
    [{ foiFallbackSeco: true, escalou: false, houveMudancaStep: false }, 0.85],
    [{ foiFallbackSeco: true, escalou: true }, 1.0],
    [{ escalou: true, foiFallbackSeco: false }, 0.9],
  ];

  it.each(casos)('padrao correto para %o → confiança %f', async (overrides, confiancaEsperada) => {
    await processarEventoObservador(evento(overrides));
    const entry = JSON.parse(mockRpush.mock.calls[0][1] as string);
    expect(entry.confiancaEstrutura).toBe(confiancaEsperada);
    mockRpush.mockClear();
  });
});

describe('processarEventoObservador — comportamento seguro', () => {
  it('não chama nenhuma API externa (apenas Redis)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    await processarEventoObservador(evento({ houveMudancaStep: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('escreve somente em chaves mcp:', async () => {
    await processarEventoObservador(evento({ houveMudancaStep: true }));
    for (const call of mockRpush.mock.calls) {
      expect((call[0] as string).startsWith('mcp:')).toBe(true);
    }
  });

  it('não propaga erro se Redis falhar', async () => {
    mockRpush.mockRejectedValueOnce(new Error('redis down'));
    await expect(processarEventoObservador(evento({ houveMudancaStep: true }))).resolves.toBeUndefined();
  });

  it('o log não contém phone cru', async () => {
    await processarEventoObservador(evento({ phoneHash: '***4821', houveMudancaStep: true }));
    const entry = JSON.parse(mockRpush.mock.calls[0][1] as string);
    expect(entry.phoneHash).toBe('***4821');
    expect(entry).not.toHaveProperty('phone');
  });
});
