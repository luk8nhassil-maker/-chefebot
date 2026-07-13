import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Teste de integração real (Nível 6.6.1): usa o `@/lib/fidelidade` de
// verdade (não mockado) contra um Redis fake em memória, para provar de
// ponta a ponta que salvar a config de pontos pelo admin nunca apaga campos
// que o formulário não edita — em especial `valorPizzaFamiliaReferencia`,
// usado pelo resgate para calcular `valorDescontoMaximo`.
const store = new Map<string, unknown>();

function realGet(key: string) {
  if (!store.has(key) && key.startsWith("cliente:")) {
    const telefone = key.slice("cliente:".length);
    if (telefone.replace(/\D/g, "").length >= 10) {
      return {
        clienteId: `cli_${telefone}`,
        telefone,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        lastLoginAt: "2020-01-01T00:00:00.000Z",
        pontosAtivos: true,
        pontosAtivadoEm: "2020-01-01T00:00:00.000Z",
      };
    }
  }
  return store.has(key) ? store.get(key) : null;
}
function realSet(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
  if (opts?.nx && store.has(key)) return null;
  store.set(key, value);
  return "OK";
}
function realDel(key: string) {
  store.delete(key);
  return 1;
}
function realEval(_script: string, keys: string[], args: string[]) {
  if (keys.length === 1) {
    const [key] = keys;
    const [token] = args;
    if (store.get(key) === token) {
      store.delete(key);
      return 1;
    }
    return 0;
  }
  const [lockKey, estadoKey] = keys;
  const [token, estadoJson] = args;
  if (store.get(lockKey) === token) {
    store.set(estadoKey, JSON.parse(estadoJson as unknown as string));
    return 1;
  }
  return 0;
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => realGet(key)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => realSet(key, value, opts)),
    del: vi.fn(async (key: string) => realDel(key)),
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => realEval(script, keys, args)),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) =>
      token === "token-admin" ? { username: "dev-admin", name: "Admin", role: "admin" } : null
    ),
  };
});

import {
  obterConfigFidelidadePontos,
  salvarConfigFidelidadePontos,
  creditarPontosPedidoEntregue,
  obterRecompensasPontos,
  reservarResgatePontos,
} from "@/lib/fidelidade";
import { POST } from "./route";

function postRequest(token: string | undefined, body: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest("http://localhost/api/fidelidade/config/pontos", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  store.clear();
});

describe("POST /api/fidelidade/config/pontos — preserva campos não editados pelo admin", () => {
  test("preserva valorPizzaFamiliaReferencia, metaPizzasFamilia e validadeDias ao salvar só ativo/metaPontos/descricaoRecompensa", async () => {
    await salvarConfigFidelidadePontos({
      ativo: false,
      metaPontos: 500,
      valorPizzaFamiliaReferencia: 75,
      metaPizzasFamilia: 15,
      validadeDias: 30,
      descricaoRecompensa: "Pizza Família",
    });

    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: 300, descricaoRecompensa: "Pizza Grande" }));
    expect(res.status).toBe(200);

    const salva = await obterConfigFidelidadePontos();
    expect(salva.valorPizzaFamiliaReferencia).toBe(75);
    expect(salva.metaPizzasFamilia).toBe(15);
    expect(salva.validadeDias).toBe(30);
    expect(salva.ativo).toBe(true);
    expect(salva.metaPontos).toBe(300);
    expect(salva.descricaoRecompensa).toBe("Pizza Grande");
  });

  test("salvar duas vezes seguidas não perde valorPizzaFamiliaReferencia na segunda vez", async () => {
    await salvarConfigFidelidadePontos({
      ativo: false,
      metaPontos: 720,
      valorPizzaFamiliaReferencia: 60,
      descricaoRecompensa: "1 Pizza Família",
    });

    await POST(postRequest("token-admin", { ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" }));
    await POST(postRequest("token-admin", { ativo: true, metaPontos: 800, descricaoRecompensa: "1 Pizza Família" }));

    const salva = await obterConfigFidelidadePontos();
    expect(salva.valorPizzaFamiliaReferencia).toBe(60);
    expect(salva.metaPontos).toBe(800);
  });

  test("body sem metaPontos/descricaoRecompensa preserva os valores atuais, nunca reseta para o padrão hardcoded", async () => {
    await salvarConfigFidelidadePontos({
      ativo: false,
      metaPontos: 333,
      valorPizzaFamiliaReferencia: 60,
      descricaoRecompensa: "Recompensa Customizada",
    });

    await POST(postRequest("token-admin", { ativo: true }));

    const salva = await obterConfigFidelidadePontos();
    expect(salva.metaPontos).toBe(333); // nunca vira 720 (padrao)
    expect(salva.descricaoRecompensa).toBe("Recompensa Customizada"); // nunca vira "1 Pizza Família" (padrao)
  });

  test("resgate continua calculando valorDescontoMaximo > 0 depois do admin salvar a config", async () => {
    await salvarConfigFidelidadePontos({
      ativo: true,
      metaPontos: 100,
      valorPizzaFamiliaReferencia: 60,
      descricaoRecompensa: "1 Pizza Família",
    });

    // Admin salva pelo formulário (só os 3 campos editáveis na UI).
    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: 100, descricaoRecompensa: "1 Pizza Família" }));
    expect(res.status).toBe(200);

    const clienteId = "cli_86999990001";
    await creditarPontosPedidoEntregue({ id: "ped_1", status: "entregue", telefone: "86999990001", total: 100 });
    const [recompensa] = await obterRecompensasPontos(clienteId);
    const reserva = await reservarResgatePontos(clienteId, recompensa.recompensaId);

    expect(reserva.valorDescontoMaximo).toBeGreaterThan(0);
    expect(reserva.valorDescontoMaximo).toBe(60);
  });
});
