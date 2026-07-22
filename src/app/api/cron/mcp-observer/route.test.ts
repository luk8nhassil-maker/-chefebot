import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  function getList(key: string): string[] {
    const v = store.get(key);
    return Array.isArray(v) ? (v as string[]) : [];
  }
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return 'OK';
    }),
    llen: vi.fn(async (key: string) => getList(key).length),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const list = getList(key);
      const end = stop === -1 ? list.length : stop + 1;
      return list.slice(start, end);
    }),
    ltrim: vi.fn(async (key: string, start: number, stop: number) => {
      const list = getList(key);
      const end = stop === -1 ? list.length : stop + 1;
      store.set(key, list.slice(start, end));
      return 'OK';
    }),
    rpush: vi.fn(async (key: string, ...vals: string[]) => {
      const list = getList(key);
      list.push(...vals);
      store.set(key, list);
      return list.length;
    }),
    expire: vi.fn(async () => 1),
    incrby: vi.fn(async (key: string, by: number) => {
      const atual = Number(store.get(key) ?? 0);
      const novo = atual + by;
      store.set(key, novo);
      return novo;
    }),
  };
  return { store, redisMock };
});

vi.mock('@/lib/redis', () => ({ redis: redisMock }));

const { mockProcessarLote } = vi.hoisted(() => ({
  mockProcessarLote: vi.fn(async (eventos: unknown[]) => ({ sucesso: true, quantidade: eventos.length })),
}));
vi.mock('@/mcp/modes/observador', () => ({ processarLoteObservador: mockProcessarLote }));

import { GET } from './route';
import type { McpEventoFila } from '@/mcp/types';

const CRON_SECRET = 'segredo-teste';
const CHAVE_FILA = 'mcp:fila:eventos';

function req(auth?: string) {
  return new Request('http://localhost/api/cron/mcp-observer', {
    headers: auth ? { authorization: auth } : {},
  });
}

function evento(i: number): McpEventoFila {
  return {
    phoneHash: '***0000',
    msgId: `M${i}`,
    stepAntes: 'a',
    stepDepois: 'b',
    houveMudancaStep: true,
    cartLength: 1,
    precisouIA: false,
    escalou: false,
    foiFallbackSeco: false,
    timestamp: Date.now(),
  };
}

function popularFila(n: number) {
  store.set(CHAVE_FILA, Array.from({ length: n }, (_, i) => JSON.stringify(evento(i))));
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mockProcessarLote.mockImplementation(async (eventos: unknown[]) => ({ sucesso: true, quantidade: eventos.length }));
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.MCP_MODE = 'observador';
});

describe('GET /api/cron/mcp-observer — auth e modo', () => {
  it('sem Authorization correto retorna 401', async () => {
    const res = await GET(req('Bearer errado'));
    expect(res.status).toBe(401);
  });

  it('sem CRON_SECRET configurado no ambiente, nenhum Bearer bate — 401', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer qualquercoisa'));
    expect(res.status).toBe(401);
  });

  it('MCP_MODE != observador retorna ok sem processar nem tocar a fila', async () => {
    process.env.MCP_MODE = 'off';
    popularFila(5);
    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.motivo).toBe('mcp inativo');
    expect(store.get(CHAVE_FILA)).toHaveLength(5);
    expect(mockProcessarLote).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/mcp-observer — processamento por tamanho de fila', () => {
  it('fila vazia: processa 0, sem erro, reason fila_vazia', async () => {
    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBe(0);
    expect(body.erros).toBe(0);
  });

  it('1 evento: processa 1 e remove da fila', async () => {
    popularFila(1);
    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBe(1);
    expect(store.get(CHAVE_FILA)).toHaveLength(0);
  });

  it('50 eventos: processa todos em um único chunk', async () => {
    popularFila(50);
    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBe(50);
    expect(store.get(CHAVE_FILA)).toHaveLength(0);
    expect(mockProcessarLote).toHaveBeenCalledTimes(1);
  });

  it('500 eventos: processa todos em 5 chunks de 100', async () => {
    popularFila(500);
    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBe(500);
    expect(store.get(CHAVE_FILA)).toHaveLength(0);
    expect(mockProcessarLote).toHaveBeenCalledTimes(5);
  });

  it('mais de 500 eventos: processa só até o limite de 500 por execução, resto fica na fila', async () => {
    popularFila(650);
    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBe(500);
    expect(store.get(CHAVE_FILA)).toHaveLength(150);
  });
});

describe('GET /api/cron/mcp-observer — falha no meio do lote', () => {
  it('chunk que falha não remove nada da fila; chunk anterior já persistido continua removido', async () => {
    popularFila(150); // 2 chunks: 100 + 50
    mockProcessarLote
      .mockImplementationOnce(async (eventos: unknown[]) => ({ sucesso: true, quantidade: eventos.length }))
      .mockImplementationOnce(async () => ({ sucesso: false, quantidade: 0 }));

    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBe(100);
    expect(body.motivoParada).toBe('falha_persistencia_lote');
    expect(store.get(CHAVE_FILA)).toHaveLength(50);
  });

  it('item malformado é contado como erro e descartado, sem vazar conteúdo no log', async () => {
    store.set(CHAVE_FILA, ['{ json invalido', JSON.stringify(evento(1))]);
    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBe(1);
    expect(body.erros).toBeGreaterThanOrEqual(1);

    const logErros = (store.get('mcp:log:erros') as string[] | undefined) ?? [];
    for (const raw of logErros) {
      const entry = JSON.parse(raw);
      expect(entry.mensagem).not.toContain('json invalido');
    }
  });
});

describe('GET /api/cron/mcp-observer — orçamento de tempo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('para de processar quando o orçamento de tempo acaba, deixando o resto na fila', async () => {
    popularFila(300); // 3 chunks de 100
    let chamadas = 0;
    const inicio = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => inicio + chamadas * 26_000);
    mockProcessarLote.mockImplementation(async (eventos: unknown[]) => {
      chamadas++;
      return { sucesso: true, quantidade: eventos.length };
    });

    const res = await GET(req(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.processados).toBeLessThan(300);
    expect(body.motivoParada).toBe('orcamento_tempo');
  });
});

describe('GET /api/cron/mcp-observer — contador vitalício de processados', () => {
  it('incrementa mcp:meta:processados:total quando processa eventos', async () => {
    popularFila(10);
    await GET(req(`Bearer ${CRON_SECRET}`));
    expect(store.get('mcp:meta:processados:total')).toBe(10);
  });

  it('não incrementa quando a fila está vazia', async () => {
    await GET(req(`Bearer ${CRON_SECRET}`));
    expect(store.get('mcp:meta:processados:total')).toBeUndefined();
  });

  it('acumula entre execuções', async () => {
    popularFila(5);
    await GET(req(`Bearer ${CRON_SECRET}`));
    popularFila(3);
    await GET(req(`Bearer ${CRON_SECRET}`));
    expect(store.get('mcp:meta:processados:total')).toBe(8);
  });
});

describe('GET /api/cron/mcp-observer — constantes de capacidade do eventTap', () => {
  it('TTL de 72h e limite de 10.000 eventos', async () => {
    const { TTL_FILA_S, MAX_FILA } = await import('@/mcp/eventTap');
    expect(TTL_FILA_S).toBe(72 * 60 * 60);
    expect(MAX_FILA).toBe(10_000);
  });
});
