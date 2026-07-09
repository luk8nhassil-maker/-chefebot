import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockLerDadosMcp } = vi.hoisted(() => ({
  mockLerDadosMcp: vi.fn().mockResolvedValue({ scoreMaturidade: { total: 0 }, obsCount: 0 }),
}));

vi.mock('@/mcp/lib/mcpReader', () => ({
  lerDadosMcp: mockLerDadosMcp,
}));

import { GET } from './route';
import { createToken } from '@/lib/auth';

function makeReq(token?: string | null, method = 'GET') {
  return {
    method,
    cookies: {
      get: (name: string) =>
        name === 'auth-token' && token ? { value: token } : undefined,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── T11: sem token → 401 ────────────────────────────────────────────────────

describe('GET /api/dev/mcp — sem token', () => {
  it('T11: retorna 401 quando cookie auth-token ausente', async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(mockLerDadosMcp).not.toHaveBeenCalled();
  });
});

// ─── T12: role admin → 403 ───────────────────────────────────────────────────

describe('GET /api/dev/mcp — role admin', () => {
  it('T12: retorna 403 para role admin', async () => {
    const token = await createToken({ username: 'brito', name: 'Brito', role: 'admin' });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(403);
    expect(mockLerDadosMcp).not.toHaveBeenCalled();
  });
});

// ─── T13: role atendente → 403 ───────────────────────────────────────────────

describe('GET /api/dev/mcp — role atendente', () => {
  it('T13: retorna 403 para role atendente', async () => {
    const token = await createToken({ username: 'kellyne', name: 'Kellyne', role: 'atendente' });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(403);
    expect(mockLerDadosMcp).not.toHaveBeenCalled();
  });
});

// ─── T14: role dev → 200 ─────────────────────────────────────────────────────

describe('GET /api/dev/mcp — role dev', () => {
  it('T14: retorna 200 com dados para role dev', async () => {
    const token = await createToken({ username: 'ominix', name: 'Ominix Dev', role: 'dev' });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(200);
    expect(mockLerDadosMcp).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body).toHaveProperty('scoreMaturidade');
  });
});

// ─── T15: token expirado → 401 ───────────────────────────────────────────────

describe('GET /api/dev/mcp — token expirado', () => {
  it('T15: retorna 401 para token com assinatura inválida', async () => {
    const res = await GET(makeReq('token.invalido.qualquer'));
    expect(res.status).toBe(401);
    expect(mockLerDadosMcp).not.toHaveBeenCalled();
  });
});

// ─── T16: POST → 405 ─────────────────────────────────────────────────────────

describe('GET /api/dev/mcp — método POST', () => {
  it('T16: POST não existe — Next.js retorna 405', async () => {
    // O handler não exporta POST. Verificamos que GET não é chamado para POST.
    // Em runtime o Next.js retornaria 405; aqui validamos que o export está ausente.
    const routeModule = await import('./route');
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined();
  });
});
