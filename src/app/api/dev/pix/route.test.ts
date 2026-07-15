import { vi, describe, it, expect, beforeEach } from 'vitest';

const painelFixture = {
  geradoEm: new Date().toISOString(),
  metricasTemporaisDesde: 'As métricas temporais começaram a ser coletadas a partir da implantação desta versão. Dados anteriores não foram reconstruídos.',
  resumo: { encontrados: 3, confirmados: 2, pendentes: 1, expirados: 0, taxaConfirmacao: 0.667 },
  origem: { webhook: 1, manual: 1, conciliador_mercadopago: 0, identificadasPeloSentinelaUltimos30Dias: 0 },
  latencia: { amostras: 2, mediaMs: 4000, p50Ms: 4000, p95Ms: 5000, p99Ms: 5000, faixas: { ate5s: 2, de5a10s: 0, de10a30s: 0, de30sa2min: 0, acimaDe2min: 0 } },
  eficiencia: {
    mensagensQstashPublicadas: 10, consultasRealizadas: 4, consultasEvitadas: 6, mensagensAntigasIgnoradas: 0,
    mensagensDuplicadasIgnoradas: 0, consultasCoalescidas: 0, bloqueiosCooldownUltimos30Dias: 0, bloqueiosRateLimitUltimos30Dias: 0,
    bloqueiosProximaConsultaUltimos30Dias: 0, bloqueiosLockUltimos30Dias: 0, proporcaoConsultaPorMensagem: 0.4,
  },
  saude: { timeout: 0, rateLimited: 0, locksRecuperados: 0, ultimoEvento: null, ultimaConfirmacaoAutomatica: null },
  series: [],
};

const { montarPainelMock } = vi.hoisted(() => ({
  montarPainelMock: vi.fn(),
}));

vi.mock('@/lib/pixDashboardMetricas', () => ({
  montarPainelPixDashboard: montarPainelMock,
}));

import { GET } from './route';
import { createToken } from '@/lib/auth';

function makeReq(token?: string | null, method = 'GET') {
  return {
    method,
    cookies: {
      get: (name: string) => (name === 'auth-token' && token ? { value: token } : undefined),
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  montarPainelMock.mockResolvedValue(painelFixture);
});

describe('GET /api/dev/pix — autorização', () => {
  it('sem cookie auth-token → 401', async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    expect(montarPainelMock).not.toHaveBeenCalled();
  });

  it('token com assinatura inválida → 401', async () => {
    const res = await GET(makeReq('token.invalido.qualquer'));
    expect(res.status).toBe(401);
    expect(montarPainelMock).not.toHaveBeenCalled();
  });

  it('role admin → 403', async () => {
    const token = await createToken({ username: 'brito', name: 'Brito', role: 'admin' });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(403);
    expect(montarPainelMock).not.toHaveBeenCalled();
  });

  it('role atendente → 403', async () => {
    const token = await createToken({ username: 'kellyne', name: 'Kellyne', role: 'atendente' });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(403);
    expect(montarPainelMock).not.toHaveBeenCalled();
  });

  it('role dev → 200 com o painel', async () => {
    const token = await createToken({ username: 'ominix', name: 'Ominix Dev', role: 'dev' });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(200);
    expect(montarPainelMock).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body).toHaveProperty('resumo');
    expect(body).toHaveProperty('metricasTemporaisDesde');
  });
});

describe('GET /api/dev/pix — somente leitura', () => {
  it('exporta apenas GET (sem POST/PUT/DELETE/PATCH)', async () => {
    const routeModule = await import('./route');
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined();
    expect((routeModule as Record<string, unknown>).PUT).toBeUndefined();
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined();
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined();
  });
});

describe('GET /api/dev/pix — ausência de PII e dados financeiros sensíveis', () => {
  it('o payload de resposta nunca contém identificadores de pedido, telefone, token, chave Pix, QR code ou copia-e-cola', async () => {
    montarPainelMock.mockResolvedValue({
      ...painelFixture,
      saude: { ...painelFixture.saude, ultimoEvento: { tipo: 'sentinela_confirmou', ts: Date.now() } },
    });
    const token = await createToken({ username: 'ominix', name: 'Ominix Dev', role: 'dev' });
    const res = await GET(makeReq(token));
    const texto = JSON.stringify(await res.json());

    const camposProibidos = [
      'pedidoId', 'paymentId', 'telefone', 'chavePix', 'qrCode', 'qrCodeBase64',
      'copiaECola', 'token', 'accessToken', 'cpf', 'cnpj', 'endereco', 'nomeCliente',
    ];
    for (const campo of camposProibidos) {
      expect(texto.toLowerCase()).not.toContain(campo.toLowerCase());
    }
  });
});
