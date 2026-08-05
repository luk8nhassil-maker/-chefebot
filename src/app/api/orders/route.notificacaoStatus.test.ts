import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regressão: a notificação de "saiu_entrega" mandava sempre "seu pedido
// saiu pra entrega! 🛵" pro cliente, mesmo quando o tipo de recebimento era
// retirada no balcão ou consumo no local — onde "saiu pra entrega" não faz
// sentido nenhum (ninguém está levando nada pra lugar nenhum).

const redisStore = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => (token === "token-admin" ? { username: "kellyne", name: "Kellyne", role: "admin" } : null)),
  };
});

vi.mock("@/lib/evolutionApi", () => ({
  obterConfigEvolution: vi.fn(() => ({
    baseUrl: "https://evolution.test",
    apiKey: "key",
    instanceName: "chefebot",
    webhookUrl: "https://x.test/api/whatsapp",
  })),
}));

const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => ({ ok: true, json: async () => ({}) }));
vi.stubGlobal("fetch", fetchMock);

import { PATCH } from "./route";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_notif_1",
    numero: 10,
    cliente: "Wesley Dutra",
    telefone: "86999998888",
    itens: ["1x Pizza G Calabresa"],
    total: 50,
    status: "em_preparo",
    horario: "20:00",
    endereco: "Rua 1",
    ...overrides,
  };
  redisStore.set("pedidos", [pedido]);
  return pedido;
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

function textoEnviado(): string | undefined {
  const chamada = fetchMock.mock.calls.find(([url]) => String(url).includes("/message/sendText/"));
  if (!chamada) return undefined;
  const opts = chamada[1] as RequestInit;
  return JSON.parse(String(opts.body)).text;
}

beforeEach(() => {
  redisStore.clear();
  fetchMock.mockClear();
});

describe("PATCH /api/orders — mensagem de 'saiu_entrega' varia por tipo de recebimento", () => {
  test("delivery continua com a mensagem de sempre (comportamento inalterado)", async () => {
    seedPedido({ tipoEntrega: "delivery", endereco: "Rua das Flores, 123" });
    const res = await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(res.status).toBe(200);
    expect(textoEnviado()).toContain("saiu pra entrega");
    expect(textoEnviado()).toContain("🛵");
  });

  test("retirada recebe mensagem de pronto pra buscar, nunca 'saiu pra entrega'", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    const texto = textoEnviado();
    expect(texto).not.toContain("saiu pra entrega");
    expect(texto).toContain("pronto");
    expect(texto).toContain("buscar");
  });

  test("retirada também funciona com tipoEntrega legado 'pickup'", async () => {
    seedPedido({ tipoEntrega: "pickup", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toContain("buscar");
  });

  test("retirada é reconhecida pelo endereco mesmo sem tipoEntrega (pedidos antigos)", async () => {
    seedPedido({ endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toContain("buscar");
  });

  test("consumo no local recebe mensagem de pronto, nunca 'saiu pra entrega'", async () => {
    seedPedido({ tipoEntrega: "dine_in", endereco: "Consumo no local" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    const texto = textoEnviado();
    expect(texto).not.toContain("saiu pra entrega");
    expect(texto).toContain("pronto");
  });

  test("consumo no local é reconhecido pelo endereco mesmo sem tipoEntrega", async () => {
    seedPedido({ endereco: "Consumo no local" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).not.toContain("saiu pra entrega");
  });

  test("mensagens de em_preparo, entregue e cancelado continuam iguais para qualquer tipo (não mudou)", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja", status: "novo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "em_preparo" }));
    expect(textoEnviado()).toContain("sendo preparado");

    fetchMock.mockClear();
    await PATCH(patchRequest({ id: "ped_notif_1", status: "cancelado" }));
    expect(textoEnviado()).toContain("cancelado");
  });

  test("silent:true não notifica ninguém, independente do tipo", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega", silent: true }));
    expect(fetchMock.mock.calls.find(([url]) => String(url).includes("/message/sendText/"))).toBeUndefined();
  });
});
