import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { verifyMock, receiverCtorMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(async () => true),
  receiverCtorMock: vi.fn(),
}));

vi.mock("@upstash/qstash", () => ({
  Receiver: class {
    constructor(config: unknown) {
      receiverCtorMock(config);
    }
    verify = verifyMock;
  },
}));

// O endpoint NUNCA deve chamar reconciliarPixMercadoPago diretamente — só
// através do Sentinela (solicitarVerificacaoOficialPix). Mockar apenas o
// Sentinela aqui (e não mercadoPagoReconciliacao) já é uma prova estrutural
// disso: se o endpoint tentasse importar/chamar o conciliador direto, essas
// chamadas passariam batido pelos testes abaixo (não mockadas) e o teste de
// texto-fonte mais abaixo pega a regressão de qualquer forma.
type ResultadoSolicitacaoMock = {
  consultou: boolean;
  motivo: string;
  encerrado: boolean;
  motivoEncerramento?: string;
  proximaConsultaMercadoPagoEm?: number;
};

const { solicitarMock, carregarEstadoMock } = vi.hoisted(() => ({
  solicitarMock: vi.fn<() => Promise<ResultadoSolicitacaoMock>>(async () => ({ consultou: true, motivo: "pendente", encerrado: false, proximaConsultaMercadoPagoEm: Date.now() + 5000 })),
  carregarEstadoMock: vi.fn(async () => ({ pedidoId: "p1", geracao: 1, estadoOperacional: "ativo" as const, criadoEm: Date.now() - 1000, falhasConsecutivas: 0, tentativaAtual: 1 })),
}));

vi.mock("@/lib/pixSentinela", () => ({
  solicitarVerificacaoOficialPix: solicitarMock,
  carregarEstadoSentinela: carregarEstadoMock,
}));

const { agendarMock } = vi.hoisted(() => ({
  agendarMock: vi.fn(async () => true),
}));

vi.mock("@/lib/pixGuardiaoScheduler", () => ({
  agendarProximaVerificacaoPixGuardiao: agendarMock,
}));

function req(body: unknown, headers: Record<string, string> = { "upstash-signature": "sig-valida" }) {
  return new NextRequest("https://chefebot-pjif.vercel.app/api/interno/pix-guardiao/verificar", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("/api/interno/pix-guardiao/verificar", () => {
  beforeEach(() => {
    store.clear();
    verifyMock.mockClear().mockResolvedValue(true);
    solicitarMock.mockClear().mockResolvedValue({ consultou: true, motivo: "pendente", encerrado: false, proximaConsultaMercadoPagoEm: Date.now() + 5000 });
    carregarEstadoMock.mockClear().mockResolvedValue({ pedidoId: "p1", geracao: 1, estadoOperacional: "ativo", criadoEm: Date.now() - 1000, falhasConsecutivas: 0, tentativaAtual: 1 });
    agendarMock.mockClear().mockResolvedValue(true);
    receiverCtorMock.mockClear();
    process.env.QSTASH_CURRENT_SIGNING_KEY = "current-key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "next-key";
  });

  afterEach(() => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  test("o endpoint nunca importa reconciliarPixMercadoPago diretamente — sempre passa pelo Sentinela", () => {
    const codigoFonte = readFileSync(join(__dirname, "route.ts"), "utf8");
    expect(codigoFonte).not.toContain('from "@/lib/mercadoPagoReconciliacao"');
    expect(codigoFonte).not.toMatch(/^\s*await reconciliarPixMercadoPago/m);
    expect(codigoFonte).toContain("solicitarVerificacaoOficialPix");
  });

  test("sem chaves de assinatura configuradas retorna 503 e nao processa", async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 1 }));
    expect(res.status).toBe(503);
    expect(solicitarMock).not.toHaveBeenCalled();
  });

  test("sem header de assinatura retorna 401", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 1 }, {}));
    expect(res.status).toBe(401);
    expect(solicitarMock).not.toHaveBeenCalled();
  });

  test("assinatura invalida retorna 401 e nao consulta o Sentinela", async () => {
    verifyMock.mockResolvedValueOnce(false);
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 1 }));
    expect(res.status).toBe(401);
    expect(solicitarMock).not.toHaveBeenCalled();
  });

  test("payload invalido retorna 200 ignorado (nunca gera retries inuteis do QStash)", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ tentativa: 1 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignorado).toBe(true);
    expect(solicitarMock).not.toHaveBeenCalled();
  });

  test("corpo malformado (JSON invalido) retorna 200 ignorado", async () => {
    const { POST } = await import("./route");
    const reqInvalido = new NextRequest("https://chefebot-pjif.vercel.app/api/interno/pix-guardiao/verificar", {
      method: "POST",
      headers: { "upstash-signature": "sig-valida" },
      body: "{ nao é json",
    });
    const res = await POST(reqInvalido);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignorado).toBe(true);
  });

  test("Sentinela encerra a cadeia (ex.: pagamento já confirmado): endpoint não reagenda", async () => {
    solicitarMock.mockResolvedValueOnce({ consultou: false, motivo: "confirmado", encerrado: true, motivoEncerramento: "confirmado" });
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 2 }));
    const json = await res.json();
    expect(json.encerrado).toBe(true);
    expect(agendarMock).not.toHaveBeenCalled();
  });

  test("mensagem com geração antiga: retorna 200 ignorado, sem reagendar (a cadeia atual segue seu próprio curso)", async () => {
    solicitarMock.mockResolvedValueOnce({ consultou: false, motivo: "geracao_antiga", encerrado: false });
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 2 }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ignorado).toBe(true);
    expect(json.motivo).toBe("geracao_antiga");
    expect(agendarMock).not.toHaveBeenCalled();
  });

  test("cadeia ainda ativa: chama o Sentinela com pedidoId/origem/geração corretos e reagenda o próximo tick", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", geracao: 3, tentativa: 1 }));
    const json = await res.json();

    expect(solicitarMock).toHaveBeenCalledWith(expect.objectContaining({ pedidoId: "p1", origem: "guardiao_qstash", geracaoMensagem: 3 }));
    expect(agendarMock).toHaveBeenCalledWith(expect.objectContaining({ pedidoId: "p1", tentativa: 2 }));
    expect(json.encerrado).toBe(false);
  });

  test("mesmo tick (pedidoId+geracao+tentativa) entregue duas vezes só chama o Sentinela uma vez", async () => {
    const { POST } = await import("./route");
    await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 1 }));
    const res2 = await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 1 }));
    const json2 = await res2.json();
    expect(json2.duplicado).toBe(true);
    expect(json2.ignorado).toBe(true);
    expect(solicitarMock).toHaveBeenCalledTimes(1);
  });

  test("se agendar o próximo tick falhar, o endpoint reporta a cadeia como encerrada (nunca lança)", async () => {
    agendarMock.mockResolvedValueOnce(false);
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", geracao: 1, tentativa: 1 }));
    const json = await res.json();
    expect(json.encerrado).toBe(true);
  });
});
