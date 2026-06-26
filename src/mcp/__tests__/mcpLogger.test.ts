import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockRpush, mockLtrim, mockExpire } = vi.hoisted(() => ({
  mockRpush: vi.fn().mockResolvedValue(1),
  mockLtrim: vi.fn().mockResolvedValue('OK'),
  mockExpire: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/redis', () => ({
  redis: { rpush: mockRpush, ltrim: mockLtrim, expire: mockExpire },
}));

import { logObservacaoMcp, logErroMcp, sanitizarMensagemErro } from '../logger/mcpLogger';
import type { McpLogEntryObs } from '../types';

const obsValida: McpLogEntryObs = {
  ts: 1700000000000,
  phoneHash: '***4821',
  stepAntes: 'flavor',
  stepDepois: 'border_escolha',
  houveMudancaStep: true,
  cartLength: 1,
  precisouIA: false,
  escalou: false,
  foiFallbackSeco: false,
  padraoObservado: 'avanco_normal',
  confiancaEstrutura: 0.9,
};

beforeEach(() => {
  mockRpush.mockClear();
  mockLtrim.mockClear();
  mockExpire.mockClear();
});

describe('sanitizarMensagemErro', () => {
  it('remove sequências longas de dígitos', () => {
    expect(sanitizarMensagemErro('telefone 55119988776655')).toBe('telefone [numero]');
  });

  it('remove valores monetários com R$', () => {
    expect(sanitizarMensagemErro('pagamento R$ 50,00 falhou')).toBe('pagamento [valor] falhou');
  });

  it('remove R$ sem espaço', () => {
    expect(sanitizarMensagemErro('R$50 recusado')).toBe('[valor] recusado');
  });

  it('trunka em 200 caracteres', () => {
    const longo = 'x'.repeat(300);
    expect(sanitizarMensagemErro(longo).length).toBe(200);
  });

  it('converte Error em string', () => {
    const result = sanitizarMensagemErro(new Error('timeout conectando'));
    expect(result).toBe('timeout conectando');
  });

  it('mantém texto sem PII intacto', () => {
    expect(sanitizarMensagemErro('timeout de conexão')).toBe('timeout de conexão');
  });
});

describe('logObservacaoMcp', () => {
  it('escreve em mcp:log:obs', async () => {
    await logObservacaoMcp(obsValida);
    expect(mockRpush).toHaveBeenCalledWith('mcp:log:obs', expect.any(String));
  });

  it('não escreve em nenhuma chave fora de mcp:', async () => {
    await logObservacaoMcp(obsValida);
    for (const call of mockRpush.mock.calls) {
      expect((call[0] as string).startsWith('mcp:')).toBe(true);
    }
  });

  it('aplica ltrim com limite de 500 entradas', async () => {
    await logObservacaoMcp(obsValida);
    expect(mockLtrim).toHaveBeenCalledWith('mcp:log:obs', -500, -1);
  });

  it('aplica TTL de 30 dias', async () => {
    await logObservacaoMcp(obsValida);
    expect(mockExpire).toHaveBeenCalledWith('mcp:log:obs', 30 * 24 * 60 * 60);
  });

  it('não propaga erro se Redis falhar', async () => {
    mockRpush.mockRejectedValueOnce(new Error('redis down'));
    await expect(logObservacaoMcp(obsValida)).resolves.toBeUndefined();
  });
});

describe('logErroMcp', () => {
  it('escreve em mcp:log:erros', async () => {
    await logErroMcp('teste', new Error('falha'));
    expect(mockRpush).toHaveBeenCalledWith('mcp:log:erros', expect.any(String));
  });

  it('sanitiza telefone no campo mensagem', async () => {
    await logErroMcp('teste', new Error('phone 5511999887766 inválido'));
    const entry = JSON.parse(mockRpush.mock.calls[0][1] as string);
    expect(entry.mensagem).not.toMatch(/\d{10,}/);
    expect(entry.mensagem).toContain('[numero]');
  });

  it('aplica ltrim com limite de 200 entradas', async () => {
    await logErroMcp('teste', 'erro qualquer');
    expect(mockLtrim).toHaveBeenCalledWith('mcp:log:erros', -200, -1);
  });

  it('não propaga erro se Redis falhar', async () => {
    mockRpush.mockRejectedValueOnce(new Error('redis down'));
    await expect(logErroMcp('teste', 'qualquer')).resolves.toBeUndefined();
  });
});
