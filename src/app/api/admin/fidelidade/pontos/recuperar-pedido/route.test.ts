import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
const auditoria: string[] = [];

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}
function defaultEvalImpl(_script: string, keys: string[], args: unknown[]) {
  if (keys.length === 1) {
    const [key] = keys;
    const [token] = args;
    if (redisStore.get(key) === token) {
      redisStore.delete(key);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  }
  const [lockKey, estadoKey] = keys;
  const [token, estadoJson] = args;
  if (redisStore.get(lockKey) === token) {
    redisStore.set(estadoKey, JSON.parse(String(estadoJson)));
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    eval: vi.fn(defaultEvalImpl),
    rpush: vi.fn((key: string, value: string) => {
      auditoria.push(value);
      return Promise.resolve(auditoria.length);
    }),
    ltrim: vi.fn(() => Promise.resolve("OK")),
    expire: vi.fn(() => Promise.resolve(1)),
    lrange: vi.fn(() => Promise.resolve([...auditoria])),
  },
}));

import { createToken } from "@/lib/auth";
import { GET, POST } from "./route";
import type { ConfigFidelidadePontos, PedidoParaCreditoPontos } from "@/lib/fidelidade";

const TELEFONE_SESSAO = "99974000691";
const CLIENTE_ID_SESSAO = `cli_${TELEFONE_SESSAO}`;

const pedido14Real: PedidoParaCreditoPontos = {
  id: "1783967630709",
  numero: 14,
  origem: "site",
  clienteId: CLIENTE_ID_SESSAO,
  telefone: "86999999999",
  criadoEm: "2026-07-13T18:33:50.709Z",
  status: "novo",
  pixConfirmado: false,
  pix: { provider: "mercadopago", status: "approved" },
  total: 68,
  taxaEntrega: 5,
};

const configAtiva: ConfigFidelidadePontos = { ativo: true, metaPontos: 60, descricaoRecompensa: "1 Pizza Familia" };

const clienteSessao = {
  clienteId: CLIENTE_ID_SESSAO,
  telefone: TELEFONE_SESSAO,
  nome: "Cliente 0691",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T19:00:00.000Z",
  lastLoginAt: "2026-07-13T19:00:00.000Z",
  pontosAtivos: true,
  pontosAtivadoEm: "2026-07-13T19:00:00.000Z",
};

function getReq(pedidoId: string, token?: string) {
  const url = `http://localhost/api/admin/fidelidade/pontos/recuperar-pedido?pedidoId=${encodeURIComponent(pedidoId)}`;
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : {};
  return new NextRequest(url, init);
}

function postReq(body: unknown, token?: string) {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { cookie: `auth-token=${token}` } : {}) },
    body: JSON.stringify(body),
  };
  return new NextRequest("http://localhost/api/admin/fidelidade/pontos/recuperar-pedido", init);
}

beforeEach(() => {
  redisStore.clear();
  auditoria.length = 0;
  redisStore.set("config:fidelidade:pontos", configAtiva);
  redisStore.set(`cliente:${TELEFONE_SESSAO}`, clienteSessao);
  redisStore.set("pedidos", [pedido14Real]);
});

describe("GET /api/admin/fidelidade/pontos/recuperar-pedido — autorizacao e previa", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(getReq(pedido14Real.id));
    expect(res.status).toBe(401);
  });

  test("role sem permissao (atendente) retorna 403", async () => {
    const token = await createToken({ username: "ana", name: "Ana", role: "atendente" });
    const res = await GET(getReq(pedido14Real.id, token));
    expect(res.status).toBe(403);
  });

  test("admin autenticado ve a previa com motivo real de recusa, sem creditar nada", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });
    const res = await GET(getReq(pedido14Real.id, token));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.numero).toBe(14);
    expect(body.pontosCalculados).toBe(63);
    expect(body.motivoRecusaAutomatica).toBe("PEDIDO_ANTERIOR_ATIVACAO");
    expect(auditoria).toHaveLength(0);
  });
});

describe("POST /api/admin/fidelidade/pontos/recuperar-pedido — autorizacao e execucao", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(postReq({ pedidoId: pedido14Real.id, motivo: "teste" }));
    expect(res.status).toBe(401);
  });

  test("role sem permissao (atendente) retorna 403", async () => {
    const token = await createToken({ username: "ana", name: "Ana", role: "atendente" });
    const res = await POST(postReq({ pedidoId: pedido14Real.id, motivo: "teste" }, token));
    expect(res.status).toBe(403);
  });

  test("body sem motivo retorna 400", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });
    const res = await POST(postReq({ pedidoId: pedido14Real.id }, token));
    expect(res.status).toBe(400);
  });

  test("recupera o pedido #14 e retorna a resposta de sucesso exata do contrato", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });
    const res = await POST(postReq({ pedidoId: pedido14Real.id, motivo: "RECUPERACAO_VALIDACAO_ATIVACAO_NAO_PERSISTIDA" }, token));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      pedidoId: pedido14Real.id,
      numero: 14,
      pontosCreditados: 63,
      eventoId: "confirmado:1783967630709",
      jaExistia: false,
    });
    // nunca expõe PII (telefone/clienteId completos) na resposta
    expect(JSON.stringify(body)).not.toContain(TELEFONE_SESSAO);
  });

  test("segunda chamada retorna jaExistia true e pontosCreditados 0, nunca duplica", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });
    await POST(postReq({ pedidoId: pedido14Real.id, motivo: "primeira" }, token));
    const res = await POST(postReq({ pedidoId: pedido14Real.id, motivo: "segunda" }, token));
    const body = await res.json();

    expect(body).toMatchObject({ ok: true, pedidoId: pedido14Real.id, numero: 14, pontosCreditados: 0, jaExistia: true });
  });

  test("ignora pontos/clienteId/telefone/saldo/status enviados no corpo", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });
    const res = await POST(
      postReq(
        {
          pedidoId: pedido14Real.id,
          motivo: "teste",
          pontos: 999999,
          clienteId: "cli_outro",
          telefone: "11999999999",
          saldo: 1,
          status: "ok",
        },
        token
      )
    );
    const body = await res.json();
    expect(body.pontosCreditados).toBe(63);
  });

  test("pedido inexistente retorna 404", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "admin" });
    const res = await POST(postReq({ pedidoId: "nao-existe", motivo: "teste" }, token));
    expect(res.status).toBe(404);
  });
});
